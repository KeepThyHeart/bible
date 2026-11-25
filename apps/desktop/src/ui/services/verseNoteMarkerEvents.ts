/**
 * "The set of verse notes that deserve a marker may have changed."
 *
 * The Bible pane's note markers (`useVersesWithNotes`) count only verse notes
 * with real content. That set changes when a verse note is deleted, moved, or
 * saved into / out of the empty state - none of which touches the DB notes
 * store or Recent files, the other triggers the hook already listens to. The
 * main process only pushes saves to OTHER windows, so this renderer-local
 * channel covers the window that made the change.
 */
import { noteHasContent } from '../../../electron/utils/noteHasContent';

const VERSE_NOTES_ROOT = 'Verse Notes';
const listeners = new Set<() => void>();

export function onVerseNotesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function notifyVerseNotesChanged(): void {
  for (const cb of Array.from(listeners)) {
    try { cb(); } catch (err) { console.error('verse note change listener failed:', err); }
  }
}

/** Is this (notes-dir relative or absolute) path a file inside the Verse Notes tree? */
export function isVerseNotePath(path: string): boolean {
  const norm = path.replace(/\\/g, '/');
  return norm === VERSE_NOTES_ROOT || norm.startsWith(`${VERSE_NOTES_ROOT}/`) || norm.includes(`/${VERSE_NOTES_ROOT}/`);
}

/**
 * Call after a successful save. A save that leaves content (or clears it, so a
 * marker must go) notifies; plain edits of an already-marked note do not need to,
 * but a first-content save does - tracked per path.
 */
const lastHadContent = new Map<string, boolean>();
export function noteVerseNoteSaved(path: string, content: unknown): void {
  if (!isVerseNotePath(path)) return;
  const has = noteHasContent(content);
  const prev = lastHadContent.get(path);
  lastHadContent.set(path, has);
  if (!has || prev !== has) notifyVerseNotesChanged();
}

/** Call after a successful delete/rename of an entry. */
export function noteVerseNoteRemoved(path: string): void {
  if (!isVerseNotePath(path)) return;
  for (const key of Array.from(lastHadContent.keys())) {
    if (key === path || key.startsWith(path.replace(/\\/g, '/') + '/')) lastHadContent.delete(key);
  }
  notifyVerseNotesChanged();
}
