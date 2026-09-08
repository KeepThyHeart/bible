/**
 * Cross-cutting registry for flushing the active `.bn` note editor to disk.
 *
 * The active note and its path live in `UserNotesPane` component state (not in a
 * store), so the window-close / teardown paths can't reach them directly. In
 * particular the main-process close handler `destroy()`s the renderer right after
 * the `session:save-requested` IPC replies, which is before React effect cleanup
 * (the normal save-on-unmount) ever runs - so a just-typed paragraph can be lost.
 *
 * The notes pane registers a flush callback here while an editor is mounted; the
 * shutdown paths (`registerSaveBeforeCloseHandler` and a `beforeunload` listener)
 * invoke {@link flushActiveNote} to guarantee an in-progress edit is persisted
 * before the renderer goes away.
 */

type ActiveNoteFlush = () => Promise<void>;

let activeNoteFlush: ActiveNoteFlush | null = null;

/** Register the flush callback for the currently-mounted note editor. */
export function registerActiveNoteFlush(flush: ActiveNoteFlush): void {
  activeNoteFlush = flush;
}

/**
 * Clear the registered flush, but only if `flush` is still the active
 * registration. This prevents a remount that registers before the previous
 * effect's cleanup runs from being clobbered by that stale cleanup.
 */
export function clearActiveNoteFlush(flush: ActiveNoteFlush): void {
  if (activeNoteFlush === flush) {
    activeNoteFlush = null;
  }
}

/**
 * Flush the active note to disk if one is registered. Never throws - a failed
 * note flush must not abort the session save that follows it on close.
 */
export async function flushActiveNote(): Promise<void> {
  if (!activeNoteFlush) return;
  try {
    await activeNoteFlush();
  } catch (err) {
    console.error('Failed to flush active note before close:', err);
  }
}
