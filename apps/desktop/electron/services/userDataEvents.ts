/**
 * Main-process notifications about the user database as a whole (task 0114).
 *
 * A restore replaces or merges rows under every feature that keeps state over
 * them. Features that cache ids or run sessions (the memory module) listen
 * here and drop that state after a restore.
 */

export interface UserDataRestoredEvent {
  readonly mode: 'replace' | 'merge';
  /** Registry tables the restore wrote (the `user.<table>` sections chosen). */
  readonly tables: readonly string[];
  /** The restore failed and changed nothing (after a `restoring` event). */
  readonly failed?: boolean;
}

type Listener = (event: UserDataRestoredEvent) => void;
const listeners = new Set<Listener>();

type RestoringListener = (event: UserDataRestoredEvent) => void | Promise<void>;
const restoringListeners = new Set<RestoringListener>();

/**
 * Before a restore writes anything: stop work over the rows (sessions, caches) and take what
 * must be compared afterwards. The restore waits for every listener (a failure is logged, not fatal).
 */
export function onUserDataRestoring(listener: RestoringListener): () => void {
  restoringListeners.add(listener);
  return () => void restoringListeners.delete(listener);
}

export async function notifyUserDataRestoring(event: UserDataRestoredEvent, onError?: (err: unknown) => void): Promise<void> {
  await Promise.all(
    [...restoringListeners].map(async (l) => {
      try {
        await l(event);
      } catch (err) {
        onError?.(err);
      }
    }),
  );
}

export function onUserDataRestored(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Called by the backup service after a restore has been applied. A failing listener is logged by the caller's log, never thrown. */
export function notifyUserDataRestored(event: UserDataRestoredEvent, onError?: (err: unknown) => void): void {
  for (const l of [...listeners]) {
    try {
      l(event);
    } catch (err) {
      onError?.(err);
    }
  }
}
