/**
 * Requests that the Notes pane open a note by its relative path (for example
 * the note the compile dialog just created).
 *
 * Like `verseNoteRequest.ts`: the event alone is lost when the pane is created
 * by the same gesture and has not mounted its listener yet, so the latest
 * request is also remembered for a few seconds and claimed by a late mount.
 */
import { useEffect, useRef } from 'react';

export const OPEN_NOTE_PATH_EVENT = 'open-note-path';
const RECENT_MS = 8000;
let recent: { path: string; at: number } | null = null;

export function requestOpenNote(path: string): void {
  recent = { path, at: Date.now() };
  window.dispatchEvent(new CustomEvent(OPEN_NOTE_PATH_EVENT, { detail: { path } }));
}

/** Marks the request as handled so a later pane mount does not repeat it. */
export function consumeOpenNoteRequest(): void {
  recent = null;
}

/** Returns the unhandled recent request (and clears it), if any. */
export function claimRecentOpenNoteRequest(): string | undefined {
  if (!recent || Date.now() - recent.at > RECENT_MS) {
    recent = null;
    return undefined;
  }
  const { path } = recent;
  recent = null;
  return path;
}

/**
 * Calls `handler(path)` for each open-note request, including one made just
 * before this pane mounted. The latest `handler` is always used.
 */
export function useNoteOpenRequest(handler: (path: string) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onEvent = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (typeof path !== 'string' || !path) return;
      consumeOpenNoteRequest();
      ref.current(path);
    };
    window.addEventListener(OPEN_NOTE_PATH_EVENT, onEvent);
    const pending = claimRecentOpenNoteRequest();
    if (pending) ref.current(pending);
    return () => window.removeEventListener(OPEN_NOTE_PATH_EVENT, onEvent);
  }, []);
}
