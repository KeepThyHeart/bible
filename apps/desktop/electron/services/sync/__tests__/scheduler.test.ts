// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDesktopScheduler, createLocalChangePoller, type SchedulerTimers } from '../scheduler';

function fakeTimers() {
  const tasks = new Map<number, { fn: () => void; ms: number }>();
  let n = 0;
  const timers: SchedulerTimers = {
    setInterval: (fn, ms) => { tasks.set(++n, { fn, ms }); return n; },
    clearInterval: (h) => { tasks.delete(h as number); },
  };
  const tick = (ms?: number) => { for (const t of [...tasks.values()]) if (ms === undefined || t.ms === ms) t.fn(); };
  return { timers, tick, tasks };
}

describe('createDesktopScheduler', () => {
  it('every() runs on an interval until stopped', () => {
    const t = fakeTimers();
    const fn = vi.fn();
    const stop = createDesktopScheduler({ timers: t.timers }).every(300_000, fn);
    t.tick(300_000);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
    t.tick(300_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('onOnline fires on resume / unlock-screen and on a connectivity edge, and unsubscribes', () => {
    const t = fakeTimers();
    const handlers = new Map<string, Set<() => void>>();
    const pm = {
      on: (e: string, l: () => void) => { (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(l); },
      removeListener: (e: string, l: () => void) => { handlers.get(e)?.delete(l); },
    };
    let connected = true;
    const fn = vi.fn();
    const off = createDesktopScheduler({ timers: t.timers, powerMonitor: pm as never, isConnected: () => connected }).onOnline(fn);
    handlers.get('resume')!.forEach((h) => h());
    handlers.get('unlock-screen')!.forEach((h) => h());
    expect(fn).toHaveBeenCalledTimes(2);
    t.tick(30_000); // still connected: no edge
    expect(fn).toHaveBeenCalledTimes(2);
    connected = false;
    t.tick(30_000);
    connected = true;
    t.tick(30_000);
    expect(fn).toHaveBeenCalledTimes(3);
    off();
    expect(handlers.get('resume')!.size).toBe(0);
    expect(t.tasks.size).toBe(0);
  });
});

describe('createLocalChangePoller', () => {
  it('notifies only when the pending count grew since the last poll', () => {
    const t = fakeTimers();
    let count = 2;
    const notify = vi.fn();
    const stop = createLocalChangePoller({ pendingCount: () => count, notify, timers: t.timers });
    t.tick(10_000);
    expect(notify).not.toHaveBeenCalled();
    count = 5;
    t.tick(10_000);
    expect(notify).toHaveBeenCalledTimes(1);
    t.tick(10_000);
    expect(notify).toHaveBeenCalledTimes(1);
    count = 1; // synced
    t.tick(10_000);
    count = 3;
    t.tick(10_000);
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
    expect(t.tasks.size).toBe(0);
  });
});
