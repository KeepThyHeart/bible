/**
 * The verse being read aloud, drawn on the Bible text through the host's `verseDecorators`
 * slot: a highlight only (a tint and a rule), never the selection.
 */
import type { VerseDecoration, VerseDecorator } from '../../host/slots';
import { audioStore } from './audioStore';

/** Stable object: the reader compares nothing, but there is no reason to allocate per verse. */
export const PLAYING_VERSE: VerseDecoration = { classes: ['verse--playing'] };

export const playingVerseDecorator: VerseDecorator = (ctx) => {
  const { tabId, verseId } = audioStore.follow;
  if (verseId === null || tabId !== ctx.tabId || verseId !== ctx.verseId) return undefined;
  return audioStore.prefs.followAlong ? PLAYING_VERSE : undefined;
};

/** What the decorator's output depends on; compared before asking the reader to re-render. */
export function followKey(): string {
  const { tabId, verseId } = audioStore.follow;
  return `${audioStore.prefs.followAlong ? 1 : 0}:${tabId ?? ''}:${verseId ?? ''}`;
}

/** Calls `invalidate` whenever the verse being read, its tab or the follow-along preference changes. Returns the unsubscribe. */
export function watchFollow(invalidate: () => void): () => void {
  let last = followKey();
  const check = () => {
    const next = followKey();
    if (next === last) return;
    last = next;
    invalidate();
  };
  const offFollow = audioStore.follow.subscribe(check);
  const offStore = audioStore.subscribe(check);
  return () => {
    offFollow();
    offStore();
  };
}
