/**
 * In the tab that is playing, the verse the reader clicks is the verse to read: clicking a verse of
 * the chapter being read moves the reading there, so the clicked verse and the verse being read are
 * one and the same (one highlight). To study elsewhere while listening, the reader opens another tab.
 */
import { bibleStore } from '../../stores/bibleStore';
import { audioStore } from './audioStore';

/** Watches each tab's study verse (the clicked verse). Returns the unsubscribe. */
export function watchVerseClicks(): () => void {
  const seen = new Map<string, number | null>();
  for (const t of bibleStore.tabs) seen.set(t.id, t.studyVerse);
  return bibleStore.subscribe(() => {
    for (const t of bibleStore.tabs) {
      const prev = seen.get(t.id);
      seen.set(t.id, t.studyVerse);
      if (prev === undefined || t.studyVerse === prev || t.studyVerse == null) continue;
      if (t.id !== audioStore.playingTabId || audioStore.status === 'idle') continue;
      const reading = audioStore.follow.verseId;
      if (reading === null || t.studyVerse === reading) continue;
      // Only within the chapter being read (verse ids are book*1e6 + chapter*1e3 + verse).
      if (Math.floor(t.studyVerse / 1000) !== Math.floor(reading / 1000)) continue;
      audioStore.jumpToVerse(t.studyVerse % 1000);
    }
  });
}
