/**
 * Same-window "a note was saved" bus. The main process tells every window
 * EXCEPT the saver (`file-notes:note-saved`), so two panes of one window
 * (single view in one, chapter mode in the other) would never hear each other.
 * `fileNotesAPI` announces each successful save here; listeners skip their own
 * `origin`.
 */
export interface LocalNoteSavedEvent {
  /** Path as passed to the save call (relative to the notes folder, or absolute). */
  path: string;
  /** The `updated` the main process wrote. */
  updated: string;
  /** Who saved; a listener ignores events carrying its own origin. */
  origin?: string;
}

const listeners = new Set<(e: LocalNoteSavedEvent) => void>();

/**
 * Announce a save on a macrotask, so the saver has stored the returned
 * `updated` before anyone hears about it.
 */
export function announceLocalNoteSaved(e: LocalNoteSavedEvent): void {
  setTimeout(() => {
    for (const cb of [...listeners]) {
      try { cb(e); } catch { /* one bad listener must not block the rest */ }
    }
  }, 0);
}

/** Subscribe; returns the unsubscribe function. */
export function onLocalNoteSaved(cb: (e: LocalNoteSavedEvent) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
