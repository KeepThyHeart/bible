/**
 * Session persistence for the app host (task 0080): the active app and routes are
 * saved next to `dockviewState` in the session blob, and restored after the session
 * loaded (`restoreActiveApp`). `appHost.restore()` ignores garbage, so older
 * sessions need nothing.
 *
 * **Pending restore.** The session is marked loaded (and autosave may run: the
 * interval, `beforeunload`, save-before-close) before the saved app is shown, and
 * extension apps register over IPC later still. Until the restore settles, the
 * `appHost` serializer hands back the blob read from the session, so an early save
 * cannot overwrite the user's saved app with the boot-time Study.
 */
import { STUDY_APP_ID } from '@bible/core/browser';
import type { AppId } from '@bible/core/browser';
import { registerSessionSerializer } from '../stores/helpers/sessionRegistry';
import { markSessionDirty } from '../stores/helpers/sessionNotifier';
import { appHost, appHostStore, appRegistry, openApp } from './appHost';

/** How long a restore waits for an app that registers late (extension apps arrive over IPC). */
export const RESTORE_WAIT_MS = 10_000;

let installed = false;
let pending: { readonly blob: unknown } | null = null;

export function installAppSession(): void {
  if (installed) return;
  installed = true;
  registerSessionSerializer('appHost', () =>
    pending && pending.blob !== undefined ? pending.blob : appHost.serialize(),
  );
  let last = JSON.stringify(appHost.serialize());
  appHostStore.subscribe(() => {
    const json = JSON.stringify(appHost.serialize());
    if (json === last) return;
    last = json;
    markSessionDirty();
  });
}

/** Called by `initializeApp` as soon as it has read `sessionData.appHost`. */
export function setPendingAppRestore(blob: unknown): void {
  pending = { blob };
}

export function hasPendingAppRestore(): boolean {
  return pending !== null;
}

/** The restore settled: the live host state is the truth again, and it needs saving. */
export function clearPendingAppRestore(): void {
  if (!pending) return;
  pending = null;
  markSessionDirty();
}

function persistedActiveId(persisted: unknown): AppId | null {
  if (!persisted || typeof persisted !== 'object') return null;
  const id = (persisted as { activeId?: unknown }).activeId;
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * Show the app the session was saved with, once the session has loaded. Study is
 * mounted first at boot, so only another app needs an activation. An app that is
 * not registered yet (an extension app) is waited for up to `timeoutMs`; the wait
 * ends early when the user opens another app first (their choice wins).
 * Resolves when the restore has settled; the pending blob is cleared either way.
 */
export function restoreActiveApp(
  persisted: unknown,
  opts: { readonly timeoutMs?: number } = {},
): Promise<void> {
  const open = async (id: AppId): Promise<void> => {
    try {
      await openApp(id, { source: 'restore' });
    } finally {
      clearPendingAppRestore();
    }
  };

  const id = appHost.restore(persisted);
  if (id !== STUDY_APP_ID) return open(id);

  const wanted = persistedActiveId(persisted);
  if (wanted === null || wanted === STUDY_APP_ID || appRegistry.has(wanted)) {
    clearPendingAppRestore();
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let done = false;
    let unsubscribeRegistry: () => void = () => undefined;
    let unsubscribeHost: () => void = () => undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (next?: AppId): void => {
      if (done) return;
      done = true;
      unsubscribeRegistry();
      unsubscribeHost();
      if (timer !== undefined) clearTimeout(timer);
      if (next !== undefined) {
        // A microtask later: the registration's binding may be added right after the descriptor.
        void Promise.resolve()
          .then(() => open(next))
          .then(resolve, resolve);
      } else {
        clearPendingAppRestore();
        resolve();
      }
    };
    unsubscribeRegistry = appRegistry.state.subscribe(() => {
      if (!appRegistry.has(wanted)) return;
      const again = appHost.restore(persisted);
      settle(again !== STUDY_APP_ID ? again : undefined);
    });
    unsubscribeHost = appHostStore.subscribe(() => {
      const active = appHost.getSnapshot().activeId;
      if (active !== null && active !== STUDY_APP_ID) settle();
    });
    timer = setTimeout(() => settle(), opts.timeoutMs ?? RESTORE_WAIT_MS);
  });
}

/** Test helper. */
export function resetAppSessionForTest(): void {
  pending = null;
}
