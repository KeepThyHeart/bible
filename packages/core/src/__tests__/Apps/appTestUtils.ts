/** Test helpers shared by the Apps and Modules tests (not exported from any barrel). */
import type { AppDescriptor, AppKeepAlive, AppRestorePolicy } from '../../Apps/AppDescriptor';
import type { TimerPort } from '../../Apps/AppHostState';

export function app(
  id: string,
  keepAlive: AppKeepAlive = 'always',
  restore: AppRestorePolicy = 'reopen',
  extra: Partial<AppDescriptor> = {},
): AppDescriptor {
  return {
    id,
    title: { key: `apps.${id}`, fallback: id },
    icon: { kind: 'builtin', name: id },
    lifecycle: { keepAlive, restore },
    ...extra,
  };
}

/** A manual timer port: `advance(ms)` runs due callbacks. */
export function fakeTimers(): TimerPort & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(id)) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

/** A promise you resolve or reject from outside. */
export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let pending microtasks run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
