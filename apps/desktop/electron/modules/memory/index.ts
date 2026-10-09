/**
 * Scripture memory, desktop main half (task 0114).
 *
 * Registers one `module:memory:<method>` handler per `MemoryApi` method and
 * pushes `MemoryPush` messages on `module:memory:event:push`. The renderer
 * calls `createModuleClient<MemoryApi, MemoryEvents>('memory')`.
 *
 * Cheap at startup. What runs at registration:
 *   - the handlers (nothing behind them loads yet);
 *   - the `app:memory` reminder source, so push cards restored by the
 *     scheduler keep their click target (`reminderSource.ts`);
 *   - a restore listener (drops the running core after a backup restore);
 *   - one deferred check: if the user has push cards switched on, the core
 *     starts a little after launch so it keeps planning them.
 * The core, the one-time import and everything else load on the first call
 * (`start.ts`). `getStatus` (the app badge) is answered with two COUNTs while
 * the core is not running, so the badge never starts it.
 */

import type { ISql } from '@bible/core';
import { MEMORY_API_METHODS, type MemoryPush } from '@bible/memory/api';
import { MEMORY_MODULE_ID } from '@bible/memory/manifest';
import { readMemoryStatus } from '@bible/memory/status';
import { deletedPassageActivity, pushCardsEnabled, reviveMergedPassages } from '@bible/memory/maintenance';
import type { IRemindersApi } from '@bible/memory/core';
import { IpcKnownError } from '../../ipc/result';
import type { UserDataRestoredEvent } from '../../services/userDataEvents';
import type { FeatureMainModule, MainModuleDeps, ModuleIpc } from '../FeatureMainModule';
import { createMemoryReminderBridge, type MemoryReminderBridge } from './reminderSource';
import type { MemoryRuntime } from './runtime';

export type StartMemory = (
  deps: MainModuleDeps,
  emit: (push: MemoryPush) => void,
  extras: { reminders?: IRemindersApi },
) => Promise<MemoryRuntime>;

export interface MemoryMainEnv {
  start: StartMemory;
  /** The shared user database (opened by the app; this only waits for it). */
  getUserDb(): Promise<ISql>;
  onUserDataRestoring(listener: (event: UserDataRestoredEvent) => void | Promise<void>): () => void;
  onUserDataRestored(listener: (event: UserDataRestoredEvent) => void): () => void;
  /** Delay before the push-card check at startup. Default 15 s. */
  readonly autoStartDelayMs?: number;
  now?(): number;
}

/** Subscribe through the (lazily imported) user-data event bus. */
function lazyEvents(subscribe: (m: typeof import('../../services/userDataEvents')) => () => void): () => void {
  let off: (() => void) | null = null;
  let cancelled = false;
  void import('../../services/userDataEvents').then((m) => {
    if (!cancelled) off = subscribe(m);
  });
  return () => {
    cancelled = true;
    off?.();
  };
}

const defaultEnv: MemoryMainEnv = {
  start: async (deps, emit, extras) => (await import('./start')).startDesktopMemory(deps, emit, extras),
  getUserDb: async () => (await import('../../services/sharedUserDb')).getSharedUserDb(),
  onUserDataRestoring: (listener) => lazyEvents((m) => m.onUserDataRestoring(listener)),
  onUserDataRestored: (listener) => lazyEvents((m) => m.onUserDataRestored(listener)),
};

/**
 * The core's errors carry messages meant for the user ("That passage is no
 * longer in your plan."), so a plain `Error` becomes a known failure the UI
 * shows. Anything else (a SQLite error, a bug) stays `internal`.
 */
export function toModuleError(err: unknown): unknown {
  if (err instanceof IpcKnownError) return err;
  // The core's own errors are plain `Error`s (or subclasses that set no name, like reference.ts's
  // `ReferenceError`) with text for the user. Storage failures arrive as `MemoryStorageError`
  // (sqlPort.ts marks every database error), TypeErrors and the like keep their names: internal.
  if (err instanceof Error && err.name === 'Error') return new IpcKnownError('invalid_input', err.message);
  return err;
}

const MEMORY_TABLE_PREFIX = 'memory_';
const DRAIN_TIMEOUT_MS = 10_000;

/** One restore: its gate (calls wait on it) and what it noted before writing. */
interface RestoreToken {
  readonly promise: Promise<void>;
  open(): void;
  activityBefore: Map<number, number> | null;
}

export function createMemoryMainModule(envOverrides: Partial<MemoryMainEnv> = {}): FeatureMainModule {
  const env: MemoryMainEnv = { ...defaultEnv, ...envOverrides };
  const now = () => (env.now ? env.now() : Date.now());
  let runtime: Promise<MemoryRuntime> | null = null;
  /** Set once the runtime has started (so `getStatus` can tell without awaiting a pending start). */
  let running: MemoryRuntime | null = null;
  let generation = 0;
  let reminders: MemoryReminderBridge | null = null;
  /** While a restore runs: calls wait for it, so nothing writes onto restored ids. */
  let restoreGate: RestoreToken | null = null;
  /** Service calls in progress (that already hold the core), drained before a restore writes. */
  let inFlight = 0;
  const drained: Array<() => void> = [];
  const callDone = (): void => {
    inFlight--;
    if (inFlight === 0) for (const d of drained.splice(0)) d();
  };
  const drain = (): Promise<void> =>
    inFlight === 0
      ? Promise.resolve()
      : Promise.race([
          new Promise<void>((resolve) => drained.push(resolve)),
          // A call stuck on something outside the database must not hold a restore forever.
          new Promise<void>((resolve) => setTimeout(resolve, DRAIN_TIMEOUT_MS)),
        ]);
  const cleanups: Array<() => void> = [];

  const shutdown = async () => {
    generation++;
    const current = runtime;
    runtime = null;
    running = null;
    if (current) (await current.catch(() => null))?.dispose();
  };

  const register = (ipc: ModuleIpc, deps: MainModuleDeps) => {
    const emit = (push: MemoryPush) => ipc.send('push', push);

    const host = deps.getReminderHost?.() ?? null;
    if (host) {
      try {
        reminders = createMemoryReminderBridge(host);
      } catch (err) {
        deps.log.warn('[memory] could not register the push-card reminder source:', err);
      }
    }

    const get = (): Promise<MemoryRuntime> => {
      if (!runtime) {
        const mine = ++generation;
        const gate = restoreGate?.promise ?? Promise.resolve();
        runtime = gate
          .then(() => env.start(deps, emit, reminders ? { reminders: reminders.api } : {}))
          .then((rt) => {
            if (mine !== generation) {
              // Reset (a restore) while starting: this runtime is stale.
              rt.dispose();
              throw new IpcKnownError('unavailable', 'Scripture memory is restarting. Try again.');
            }
            running = rt;
            return rt;
          })
          .catch((err: unknown) => {
            if (mine === generation) runtime = null; // a failed start is retried on the next call
            if (err instanceof IpcKnownError) throw err;
            deps.log.error('[memory] could not start:', err);
            const message =
              err instanceof Error && err.name === 'MemoryImportPendingError'
                ? err.message
                : 'Scripture memory could not start. Try again, or restart the app.';
            throw new IpcKnownError('unavailable', message);
          });
      }
      return runtime;
    };

    for (const method of MEMORY_API_METHODS) {
      ipc.handle(method, async (...args: unknown[]) => {
        if (method === 'getStatus' && !running) {
          // The badge: never start the core for it.
          try {
            return readMemoryStatus(await env.getUserDb(), now());
          } catch (err) {
            deps.log.warn('[memory] status unavailable:', err);
            throw new IpcKnownError('unavailable', 'Scripture memory is not available right now.');
          }
        }
        const { service } = await get();
        inFlight++;
        try {
          return await (service[method] as (...a: unknown[]) => Promise<unknown>)(...args);
        } catch (err) {
          throw toModuleError(err);
        } finally {
          callDone();
        }
      });
    }

    // A restore rewrites rows under the core's caches and sessions. Before it writes: stop the core
    // and hold new calls; for a merge, note which removed passages already have newer history.
    // After: repair what a merge can leave behind, tell the UI to redraw, let calls through, and
    // start the core again for push-card users. Restores that touch no memory table change nothing.
    const touches = (event: UserDataRestoredEvent) => event.tables.some((t) => t.startsWith(MEMORY_TABLE_PREFIX));
    const afterRestore = async (db: ISql): Promise<void> => {
      emit({ type: 'planChanged' });
      emit({ type: 'status', status: readMemoryStatus(db, now()) });
      if (pushCardsEnabled(db)) void get().catch(() => undefined);
    };
    cleanups.push(
      env.onUserDataRestoring(async (event) => {
        if (!touches(event)) return;
        // Restores run one at a time, but a later one may begin while an earlier "restored" handler
        // is still finishing: each restore has its own token, chained after the previous gate.
        const previous = restoreGate?.promise ?? Promise.resolve();
        let open!: () => void;
        const own = new Promise<void>((resolve) => (open = resolve));
        const token: RestoreToken = { promise: previous.then(() => own), open, activityBefore: null };
        restoreGate = token;
        await drain();
        await shutdown();
        try {
          token.activityBefore = event.mode === 'merge' ? deletedPassageActivity(await env.getUserDb()) : null;
        } catch (err) {
          deps.log.warn('[memory] before-restore snapshot failed:', err);
        }
      }),
      env.onUserDataRestored((event) => {
        if (!touches(event)) return;
        const token = restoreGate;
        void (async () => {
          try {
            // Without a "restoring" event first, drop the core now. With one, it is already down and
            // calls made since are waiting on the gate (shutting them down here would wait for them).
            if (!token) await shutdown();
            const db = await env.getUserDb();
            if (!event.failed && event.mode === 'merge' && token?.activityBefore) {
              const revived = reviveMergedPassages(db, token.activityBefore);
              if (revived > 0) deps.log.info(`[memory] restored ${revived} removed passage(s) that the merged backup still practised`);
            }
            if (token) token.open();
            if (restoreGate === token) restoreGate = null;
            await afterRestore(db);
          } catch (err) {
            deps.log.warn('[memory] after-restore repair failed:', err);
          } finally {
            token?.open();
            if (restoreGate === token) restoreGate = null;
          }
        })();
      }),
    );

    // Push cards keep planning only while the core runs: start it for users who switched them on.
    const timer = setTimeout(() => {
      void env
        .getUserDb()
        .then((db) => (pushCardsEnabled(db) ? get().then(() => undefined) : undefined))
        .catch((err: unknown) => deps.log.warn('[memory] push-card startup check failed:', err));
    }, env.autoStartDelayMs ?? 15_000);
    (timer as { unref?: () => void }).unref?.();
    cleanups.push(() => clearTimeout(timer));
  };

  const close = async () => {
    for (const c of cleanups.splice(0)) c();
    // Never leave calls waiting on a restore that this module will no longer hear about.
    restoreGate?.open();
    restoreGate = null;
    reminders?.dispose();
    reminders = null;
    await shutdown();
  };

  return {
    id: MEMORY_MODULE_ID,
    registerIpc(ipc, deps) {
      register(ipc, deps);
      return { dispose: () => void close() };
    },
    close,
  };
}

export default createMemoryMainModule();
