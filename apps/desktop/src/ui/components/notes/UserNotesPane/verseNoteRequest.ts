/**
 * Requests that the Notes pane open (creating if needed) a verse's note.
 *
 * Dispatching a window event alone loses the request when the Notes pane is
 * created by the same gesture and has not mounted its listener yet, so the
 * most recent request is also remembered for a few seconds; a pane that mounts
 * late claims it with `claimRecentVerseNoteRequest`.
 */
const RECENT_MS = 8000;
let recent: { verseId: number; at: number } | null = null;

export function requestVerseNote(verseId: number): void {
  recent = { verseId, at: Date.now() };
  window.dispatchEvent(new CustomEvent('open-verse-note', { detail: { verseId } }));
}

/** Marks the request as handled so a later pane mount does not repeat it. */
export function consumeVerseNoteRequest(): void {
  recent = null;
}

/** Returns the unhandled recent request (and clears it), if any. */
export function claimRecentVerseNoteRequest(): number | undefined {
  if (!recent || Date.now() - recent.at > RECENT_MS) {
    recent = null;
    return undefined;
  }
  const { verseId } = recent;
  recent = null;
  return verseId;
}
