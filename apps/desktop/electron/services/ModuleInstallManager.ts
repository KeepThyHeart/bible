/**
 * Background install queue for the Module Manager.
 *
 * `module:install` used to run a whole download-and-install inside one awaited
 * IPC call, one per click, with nothing limiting how many ran at once and
 * nothing the UI could ask "where is it up to?". This manager owns that work
 * instead: a click enqueues a job and returns at once; jobs run in the
 * background (at most {@link MAX_CONCURRENT_INSTALLS} at a time) and the UI
 * polls {@link ModuleInstallManager.list} for each job's stage, percent and
 * bytes, and can cancel or retry it.
 *
 * Heavy steps are not done here: the download streams to disk with
 * backpressure, unpacking and hashing are streams, the conformance gate runs in
 * a worker thread, and keyword indexing is a serialized background queue.
 */
import type { CatalogModule, InstallationResult, InstallHooks, DownloadProgress } from '@bible/core';

/** At most this many modules download/install at once; the rest wait their turn. */
export const MAX_CONCURRENT_INSTALLS = 2;

/** How long a finished (done/cancelled) job stays listed so the UI can see it. */
const FINISHED_JOB_TTL_MS = 30_000;

export type InstallJobStage =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface InstallJob {
  jobId: number;
  /** Catalog module id (the key `module:install` takes). */
  moduleId: string;
  catalogId?: number;
  name: string;
  abbreviation: string;
  stage: InstallJobStage;
  /** 0-100 while downloading with a known size; undefined when indeterminate. */
  percent?: number;
  bytesDone: number;
  bytesTotal?: number;
  speedBps?: number;
  error?: string;
  /** Registered module id once the install succeeded. */
  installedModuleId?: number;
  updatedAt: number;
}

/** The slice of `ModuleController` the manager needs (a seam for tests). */
export interface InstallController {
  installModule(moduleId: string, catalogId?: number, hooks?: InstallHooks): Promise<InstallationResult>;
  cancelDownload(queueId: number): void;
  getDownloadProgress(queueId: number): DownloadProgress | undefined;
  getAvailableModules(): CatalogModule[];
}

interface JobState {
  job: InstallJob;
  queueId?: number;
  cancelRequested: boolean;
}

export class ModuleInstallManager {
  private readonly jobs = new Map<number, JobState>();
  private nextJobId = 1;
  private running = 0;

  constructor(
    private readonly getController: () => InstallController,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Queue a module install. A module that already has a queued or running job
   * returns that job (a double click must not start two installs of one
   * module); a failed or cancelled job for it is replaced.
   */
  enqueue(moduleId: string, catalogId?: number): InstallJob {
    for (const state of this.jobs.values()) {
      if (state.job.moduleId !== moduleId) continue;
      if (this.isActive(state.job)) return { ...state.job };
    }
    // Replace any finished job of the same module (retry).
    for (const [id, state] of this.jobs) {
      if (state.job.moduleId === moduleId) this.jobs.delete(id);
    }

    const catalogEntry = this.safeCatalog().find((m) => m.module_id === moduleId);
    const job: InstallJob = {
      jobId: this.nextJobId++,
      moduleId,
      catalogId,
      name: catalogEntry?.name ?? moduleId,
      abbreviation: catalogEntry?.abbreviation ?? moduleId,
      stage: 'queued',
      bytesDone: 0,
      bytesTotal: catalogEntry?.download_size_bytes || undefined,
      updatedAt: this.now(),
    };
    this.jobs.set(job.jobId, { job, cancelRequested: false });
    this.pump();
    return { ...job };
  }

  /** Retry a failed or cancelled job: queue its module again. */
  retry(jobId: number): InstallJob | undefined {
    const state = this.jobs.get(jobId);
    if (!state || (state.job.stage !== 'failed' && state.job.stage !== 'cancelled')) return undefined;
    return this.enqueue(state.job.moduleId, state.job.catalogId);
  }

  /**
   * Cancel a queued or downloading job. Past the download (verifying, installing)
   * the install is committing files and cannot be stopped safely: returns false.
   */
  cancel(jobId: number): boolean {
    const state = this.jobs.get(jobId);
    if (!state) return false;
    const { job } = state;
    if (job.stage === 'queued') {
      this.finish(state, 'cancelled');
      return true;
    }
    if (job.stage === 'downloading') {
      state.cancelRequested = true;
      if (state.queueId !== undefined) {
        try {
          this.getController().cancelDownload(state.queueId);
        } catch {
          /* the install promise reports the outcome */
        }
      }
      return true;
    }
    return false;
  }

  /** Drop a finished job from the list. */
  dismiss(jobId: number): void {
    const state = this.jobs.get(jobId);
    if (state && !this.isActive(state.job)) this.jobs.delete(jobId);
  }

  /** All jobs, with live download progress folded in. */
  list(): InstallJob[] {
    const t = this.now();
    for (const [id, state] of this.jobs) {
      if ((state.job.stage === 'done' || state.job.stage === 'cancelled') && t - state.job.updatedAt > FINISHED_JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }
    for (const state of this.jobs.values()) this.refreshProgress(state);
    return [...this.jobs.values()].map((s) => ({ ...s.job }));
  }

  private isActive(job: InstallJob): boolean {
    return job.stage === 'queued' || job.stage === 'downloading' || job.stage === 'verifying' || job.stage === 'installing';
  }

  private safeCatalog(): CatalogModule[] {
    try {
      return this.getController().getAvailableModules();
    } catch {
      return [];
    }
  }

  private refreshProgress(state: JobState): void {
    if (state.job.stage !== 'downloading' || state.queueId === undefined) return;
    let progress: DownloadProgress | undefined;
    try {
      progress = this.getController().getDownloadProgress(state.queueId);
    } catch {
      return;
    }
    if (!progress) return;
    const job = state.job;
    job.bytesDone = progress.progressBytes;
    if (progress.totalBytes) job.bytesTotal = progress.totalBytes;
    job.speedBps = progress.speedBps;
    job.percent = job.bytesTotal ? Math.min(100, Math.round((job.bytesDone / job.bytesTotal) * 100)) : undefined;
  }

  private setStage(state: JobState, stage: InstallJobStage): void {
    state.job.stage = stage;
    state.job.updatedAt = this.now();
  }

  private finish(state: JobState, stage: 'done' | 'failed' | 'cancelled', error?: string): void {
    this.setStage(state, stage);
    state.job.error = error;
    if (stage === 'done') state.job.percent = 100;
  }

  private pump(): void {
    for (const state of this.jobs.values()) {
      if (this.running >= MAX_CONCURRENT_INSTALLS) return;
      if (state.job.stage !== 'queued') continue;
      this.running += 1;
      this.setStage(state, 'downloading');
      void this.run(state).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async run(state: JobState): Promise<void> {
    const { job } = state;
    try {
      const result = await this.getController().installModule(job.moduleId, job.catalogId, {
        onQueued: (queueId) => {
          state.queueId = queueId;
          // A cancel that arrived before the queue entry existed.
          if (state.cancelRequested) this.getController().cancelDownload(queueId);
        },
        onStage: (stage) => {
          if (!state.cancelRequested) this.setStage(state, stage);
        },
      });
      if (result.success) {
        // Installed and registered: report it even if a cancel arrived too late to stop it.
        job.installedModuleId = result.moduleId;
        this.finish(state, 'done');
      } else if (state.cancelRequested) {
        this.finish(state, 'cancelled');
      } else {
        this.finish(state, 'failed', result.error ?? 'Installation failed');
      }
    } catch (error) {
      if (state.cancelRequested) this.finish(state, 'cancelled');
      else this.finish(state, 'failed', error instanceof Error ? error.message : String(error));
    }
  }
}
