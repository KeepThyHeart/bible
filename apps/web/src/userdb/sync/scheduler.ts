/**
 * The sync engine's scheduler inside the user-DB worker (task 0150 M3, design §6): `every(ms)` is a chain of timeouts
 * over the injected `SyncTimers` (so tests drive it by hand), `onOnline` listens for the worker's `online` event. The
 * main thread adds `visibilitychange` itself (it sends `syncNow` when the page becomes visible).
 * No side effects at module load.
 */
import type { Sync } from '@bible/core/browser';

export interface WorkerSchedulerOptions {
  timers?: Sync.SyncTimers;
  /** Where `online` events arrive. Default: the global scope (`self` in the worker), when it is an EventTarget. */
  online?: EventTarget | null;
}

export const defaultTimers: Sync.SyncTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

function globalTarget(): EventTarget | null {
  const g = globalThis as unknown as Partial<EventTarget>;
  return typeof g.addEventListener === 'function' && typeof g.removeEventListener === 'function' ? (g as EventTarget) : null;
}

export function createWorkerScheduler(o: WorkerSchedulerOptions = {}): Sync.SyncScheduler {
  const timers = o.timers ?? defaultTimers;
  return {
    every(ms, fn) {
      let stopped = false;
      let handle: unknown;
      const arm = (): void => {
        handle = timers.setTimeout(() => {
          if (stopped) return;
          try { fn(); } catch { /* the engine's own errors land in its status */ }
          if (!stopped) arm();
        }, ms);
      };
      arm();
      return () => {
        stopped = true;
        timers.clearTimeout(handle);
      };
    },
    onOnline(fn) {
      const target = o.online === undefined ? globalTarget() : o.online;
      if (!target) return () => undefined;
      const listener = (): void => {
        try { fn(); } catch { /* see above */ }
      };
      target.addEventListener('online', listener);
      return () => target.removeEventListener('online', listener);
    },
  };
}
