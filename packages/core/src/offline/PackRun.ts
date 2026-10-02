/**
 * PackRun (task 0075): executes a PackPlan through per-kind installers with
 * dependency gating, bounded concurrency, cancellation and throttled progress.
 * Pure TypeScript, platform-free; the clock is injectable.
 *
 * `getSnapshot()` keeps a stable object identity until something observable
 * changes, so it can back React's useSyncExternalStore directly.
 */

import { isAssetError } from '../assets';
import type { IPackInstaller, PackItemKind, PackPlan, PackPlanStep, PackRunSnapshot } from './PackTypes';

export interface PackRunOptions {
  /** Steps running at once (default 1). */
  concurrency?: number;
  /** Clock used to throttle byte-progress notifications (default Date.now). */
  now?: () => number;
  /** Minimum gap between byte-progress notifications (default 100). */
  throttleMs?: number;
}

type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export class PackRun {
  private readonly steps: PackPlanStep[];
  private readonly status = new Map<string, StepStatus>();
  private readonly loaded = new Map<string, { loaded: number; total: number }>();
  private readonly errors: { key: string; code: string; message: string }[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly ctl = new AbortController();
  private readonly concurrency: number;
  private readonly now: () => number;
  private readonly throttleMs: number;

  private state: PackRunSnapshot['state'] = 'idle';
  private cancelled = false;
  private running = 0;
  private finished = false;
  private lastProgressNotify = -Infinity;
  private snapshot: PackRunSnapshot;
  private promise: Promise<PackRunSnapshot> | null = null;
  private resolveRun: ((s: PackRunSnapshot) => void) | null = null;

  constructor(
    plan: PackPlan,
    private readonly installers: Partial<Record<PackItemKind, IPackInstaller>>,
    opts: PackRunOptions = {},
  ) {
    this.steps = plan.steps;
    this.concurrency = Math.max(1, Math.floor(opts.concurrency ?? 1));
    this.now = opts.now ?? Date.now;
    this.throttleMs = opts.throttleMs ?? 100;
    for (const s of this.steps) this.status.set(s.key, 'pending');
    this.snapshot = this.build();
  }

  getSnapshot(): PackRunSnapshot {
    return this.snapshot;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  start(): Promise<PackRunSnapshot> {
    if (this.promise) return this.promise;
    this.promise = new Promise<PackRunSnapshot>((resolve) => {
      this.resolveRun = resolve;
    });
    if (!this.cancelled) this.state = 'running';
    this.publish();
    this.pump();
    return this.promise;
  }

  cancel(): void {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    this.ctl.abort();
    if (!this.promise) {
      this.state = 'cancelled';
    }
    this.publish();
    if (this.promise) this.pump();
  }

  // ---------------------------------------------------------------------

  private pump(): void {
    if (this.finished || !this.promise) return;
    if (!this.cancelled) {
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const step of this.steps) {
          if (this.status.get(step.key) !== 'pending') continue;
          const deps = step.after.map((k) => this.status.get(k)).filter((v): v is StepStatus => v !== undefined);
          if (deps.some((d) => d === 'failed' || d === 'skipped')) {
            this.status.set(step.key, 'skipped');
            progressed = true;
            this.publish();
          } else if (deps.every((d) => d === 'success') && this.running < this.concurrency) {
            this.launch(step);
            progressed = true;
          }
        }
      }
    }
    if (this.running > 0) return;
    if (!this.cancelled) {
      // Anything still pending can never run (dependency cycle).
      for (const step of this.steps) if (this.status.get(step.key) === 'pending') this.status.set(step.key, 'skipped');
    }
    this.finish();
  }

  private launch(step: PackPlanStep): void {
    this.status.set(step.key, 'running');
    this.running++;
    this.loaded.set(step.key, { loaded: 0, total: step.offer.downloadBytes });
    this.publish();
    const installer = this.installers[step.offer.ref.kind];
    const run: Promise<void> = installer
      ? Promise.resolve().then(() =>
          installer.install(step, {
            signal: this.ctl.signal,
            onBytes: (loaded, total) => this.onBytes(step.key, loaded, total),
          }),
        )
      : Promise.reject(Object.assign(new Error(`No installer for kind '${step.offer.ref.kind}'`), { packCode: 'no-installer' }));
    run.then(
      () => this.settle(step, 'success'),
      (e: unknown) => {
        const isAbort = isAssetError(e) && e.code === 'aborted';
        if (isAbort || this.cancelled) {
          this.settle(step, 'skipped', undefined, true);
          return;
        }
        const code = isAssetError(e)
          ? e.code
          : (e as { packCode?: string } | null)?.packCode ?? 'error';
        const message = e instanceof Error ? e.message : String(e);
        this.settle(step, 'failed', { key: step.key, code, message });
      },
    );
  }

  private settle(
    step: PackPlanStep,
    result: StepStatus,
    error?: { key: string; code: string; message: string },
    cancelledStep = false,
  ): void {
    this.running--;
    this.loaded.delete(step.key);
    // A step interrupted by cancel is left pending-equivalent: it is neither done, failed nor skipped.
    this.status.set(step.key, cancelledStep ? 'pending' : result);
    if (error) this.errors.push(error);
    this.publish();
    this.pump();
  }

  private onBytes(key: string, loaded: number, total: number): void {
    if (this.status.get(key) !== 'running') return;
    this.loaded.set(key, { loaded: Math.max(0, Number.isFinite(loaded) ? loaded : 0), total });
    const t = this.now();
    if (t - this.lastProgressNotify >= this.throttleMs) {
      this.lastProgressNotify = t;
      this.publish();
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    let ok = 0;
    for (const s of this.status.values()) if (s === 'success') ok++;
    if (this.cancelled) this.state = 'cancelled';
    else if (ok === this.steps.length) this.state = 'done';
    else if (ok > 0) this.state = 'partial';
    else this.state = 'failed';
    this.publish();
    const resolve = this.resolveRun;
    this.resolveRun = null;
    resolve?.(this.snapshot);
  }

  private publish(): void {
    this.snapshot = this.build();
    this.lastProgressNotify = this.now();
    for (const cb of [...this.listeners]) {
      try {
        cb();
      } catch {
        // a subscriber error must not break the run
      }
    }
  }

  private build(): PackRunSnapshot {
    let done = 0;
    let failed = 0;
    let skipped = 0;
    let loadedBytes = 0;
    let totalBytes = 0;
    for (const s of this.steps) {
      const st = this.status.get(s.key);
      totalBytes += s.offer.downloadBytes;
      if (st === 'success') {
        done++;
        loadedBytes += s.offer.downloadBytes;
      } else if (st === 'failed') failed++;
      else if (st === 'skipped') skipped++;
    }
    const active: PackRunSnapshot['active'] = [];
    for (const [key, v] of this.loaded) {
      const l = Math.max(0, v.loaded);
      loadedBytes += l;
      active.push({ key, loaded: l, total: v.total });
    }
    return {
      state: this.state,
      total: this.steps.length,
      done,
      failed,
      skipped,
      loadedBytes,
      totalBytes,
      active,
      errors: [...this.errors],
    };
  }
}
