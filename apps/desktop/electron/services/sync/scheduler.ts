/**
 * Desktop timers for the sync engine (task 0150 M3). Pure over injected parts so tests drive them by hand.
 *
 * - `createDesktopScheduler` is the engine's `Sync.SyncScheduler`: `every` is an unref'd interval; `onOnline` fires on
 *   OS resume / screen unlock, and when connectivity comes back (a 30 s check of `isConnected()`, false then true).
 * - `createLocalChangePoller` is a 10 s poll of the tracker's dirty count: when it grew, the engine is told (it then
 *   debounces and syncs). Row triggers cannot call into the engine, so this is how a local edit reaches it.
 */
import type { Sync } from '@bible/core';

export interface SchedulerTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const realTimers: SchedulerTimers = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
};

function unref(handle: unknown): void {
  (handle as { unref?: () => void } | null)?.unref?.();
}

/** The slice of Electron's `powerMonitor` used here. */
export interface PowerMonitorLike {
  on(event: 'resume' | 'unlock-screen', listener: () => void): unknown;
  removeListener(event: 'resume' | 'unlock-screen', listener: () => void): unknown;
}

export interface DesktopSchedulerOptions {
  powerMonitor?: PowerMonitorLike | null;
  isConnected?(): boolean;
  timers?: SchedulerTimers;
  connectivityPollMs?: number;
}

export const CONNECTIVITY_POLL_MS = 30_000;
export const LOCAL_CHANGE_POLL_MS = 10_000;

export function createDesktopScheduler(o: DesktopSchedulerOptions = {}): Sync.SyncScheduler {
  const timers = o.timers ?? realTimers;
  return {
    every(ms, fn) {
      const h = timers.setInterval(fn, ms);
      unref(h);
      return () => timers.clearInterval(h);
    },
    onOnline(fn) {
      const offs: Array<() => void> = [];
      const pm = o.powerMonitor;
      if (pm) {
        for (const ev of ['resume', 'unlock-screen'] as const) {
          pm.on(ev, fn);
          offs.push(() => { pm.removeListener(ev, fn); });
        }
      }
      if (o.isConnected) {
        const isConnected = o.isConnected;
        let was = safe(isConnected);
        const h = timers.setInterval(() => {
          const now = safe(isConnected);
          if (now && !was) fn();
          was = now;
        }, o.connectivityPollMs ?? CONNECTIVITY_POLL_MS);
        unref(h);
        offs.push(() => timers.clearInterval(h));
      }
      return () => { for (const off of offs.splice(0)) off(); };
    },
  };
}

function safe(fn: () => boolean): boolean {
  try { return fn(); } catch { return true; }
}

export interface LocalChangePollerOptions {
  pendingCount(): number;
  notify(): void;
  timers?: SchedulerTimers;
  intervalMs?: number;
}

/** Returns a stop function. */
export function createLocalChangePoller(o: LocalChangePollerOptions): () => void {
  const timers = o.timers ?? realTimers;
  let last = readCount(o.pendingCount);
  const h = timers.setInterval(() => {
    const n = readCount(o.pendingCount);
    const grew = n > last;
    last = n;
    if (grew) o.notify();
  }, o.intervalMs ?? LOCAL_CHANGE_POLL_MS);
  unref(h);
  return () => timers.clearInterval(h);
}

function readCount(fn: () => number): number {
  try { return fn(); } catch { return 0; }
}
