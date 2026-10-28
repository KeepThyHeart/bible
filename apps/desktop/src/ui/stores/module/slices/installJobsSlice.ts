import type { StateCreator } from 'zustand';
import { moduleAPI, type InstallJob } from '../moduleAPI';
import type { ModuleState } from '../types';

const POLL_MS = 500;

export interface InstallJobsSlice {
  /** Background install jobs (queued, running, or failed and awaiting a retry). */
  installJobs: InstallJob[];
  installJobsTimer: number | null;

  /** Queue an install; returns at once. Progress arrives through polling. */
  startInstall: (moduleId: string, catalogId?: number) => Promise<void>;
  refreshInstallJobs: () => Promise<void>;
  cancelInstall: (jobId: number) => Promise<void>;
  retryInstall: (jobId: number) => Promise<void>;
  dismissInstall: (jobId: number) => Promise<void>;
  startInstallPolling: () => void;
  stopInstallPolling: () => void;
}

const isActive = (job: InstallJob): boolean =>
  job.stage === 'queued' || job.stage === 'downloading' || job.stage === 'verifying' || job.stage === 'installing';

let refreshing = false;

export const createInstallJobsSlice: StateCreator<ModuleState, [], [], InstallJobsSlice> = (set, get) => ({
  installJobs: [],
  installJobsTimer: null,

  startInstall: async (moduleId, catalogId) => {
    set({ error: null });
    try {
      const job = await moduleAPI.startInstall(moduleId, catalogId);
      set((state) => ({ installJobs: [...state.installJobs.filter((j) => j.jobId !== job.jobId && j.moduleId !== job.moduleId), job] }));
      get().startInstallPolling();
    } catch (error) {
      console.error('[ModuleStore] Error starting install:', error);
      set({ error: error instanceof Error ? error.message : 'Installation failed' });
    }
  },

  refreshInstallJobs: async () => {
    // Never overlap two refreshes: a second would see the same finished job
    // before the first has reloaded the installed list, and drop it early.
    if (refreshing) return;
    refreshing = true;
    try {
      let jobs: InstallJob[];
      try {
        jobs = await moduleAPI.getInstallJobs();
      } catch (error) {
        console.error('[ModuleStore] Error loading install jobs:', error);
        return;
      }
      const before = get().installJobs;
      const finishedNow = jobs.filter(
        (job) => job.stage === 'done' && before.find((b) => b.jobId === job.jobId)?.stage !== 'done'
      );
      // A job started while this list was in flight is not in it yet: keep it.
      const serverIds = new Set(jobs.map((j) => j.jobId));
      const startedMeanwhile = get().installJobs.filter((j) => !serverIds.has(j.jobId) && isActive(j));
      // A cancelled job has nothing to show: drop it. A done job stays listed
      // (its row keeps the progress cell) until the installed list has been
      // reloaded, so the row never flashes back to "Install" in between.
      const cancelled = jobs.filter((job) => job.stage === 'cancelled');
      set({ installJobs: [...jobs.filter((job) => job.stage !== 'cancelled'), ...startedMeanwhile] });

      if (finishedNow.length > 0) {
        await get().loadInstalledModules();
      }
      const done = jobs.filter((job) => job.stage === 'done');
      if (done.length > 0) {
        const doneIds = new Set(done.map((j) => j.jobId));
        set({ installJobs: get().installJobs.filter((j) => !doneIds.has(j.jobId)) });
      }
      for (const job of [...cancelled, ...done]) {
        void moduleAPI.dismissInstall(job.jobId).catch(() => undefined);
      }
      if (!get().installJobs.some(isActive)) get().stopInstallPolling();
    } finally {
      refreshing = false;
    }
  },

  cancelInstall: async (jobId) => {
    try {
      await moduleAPI.cancelInstall(jobId);
    } catch (error) {
      console.error('[ModuleStore] Error cancelling install:', error);
    }
    await get().refreshInstallJobs();
  },

  retryInstall: async (jobId) => {
    try {
      const job = await moduleAPI.retryInstall(jobId);
      if (job) {
        set((state) => ({ installJobs: [...state.installJobs.filter((j) => j.moduleId !== job.moduleId), job] }));
        get().startInstallPolling();
      }
    } catch (error) {
      console.error('[ModuleStore] Error retrying install:', error);
    }
  },

  dismissInstall: async (jobId) => {
    set((state) => ({ installJobs: state.installJobs.filter((j) => j.jobId !== jobId) }));
    try {
      await moduleAPI.dismissInstall(jobId);
    } catch {
      /* the job simply stays listed server-side until it expires */
    }
  },

  startInstallPolling: () => {
    if (get().installJobsTimer !== null) return;
    const timer = window.setInterval(() => {
      void get().refreshInstallJobs();
    }, POLL_MS);
    set({ installJobsTimer: timer });
  },

  stopInstallPolling: () => {
    const timer = get().installJobsTimer;
    if (timer !== null) {
      window.clearInterval(timer);
      set({ installJobsTimer: null });
    }
  },
});
