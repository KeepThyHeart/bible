/**
 * Session dirty notifier - decouples stores from useSessionStore.
 *
 * Instead of each store importing useSessionStore (creating circular deps),
 * stores call `markSessionDirty()` from this module.  useSessionStore
 * registers itself as the callback at init time via `setSessionDirtyCallback`.
 */

let dirtyCallback: (() => void) | null = null;

/**
 * Called once by useSessionStore at creation time to wire up the notification.
 */
export function setSessionDirtyCallback(cb: () => void): void {
  dirtyCallback = cb;
}

/**
 * Mark the current session as dirty (needs saving).
 * Safe to call before the session store has initialised - it's a no-op.
 */
export function markSessionDirty(): void {
  dirtyCallback?.();
}
