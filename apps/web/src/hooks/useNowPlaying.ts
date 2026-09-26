/**
 * What the audio UI shows about the verse being read: which chapter, which verse,
 * how far through the chapter. Derived from the audio store's follow state and
 * the playing tab's verse list, so the player, the mini-player and the transport
 * bar all say the same thing.
 */

import { audioStore } from '../stores/audioStore';
import { bibleStore } from '../stores/bibleStore';
import type { BibleTab } from '../stores/bibleStore';
import { moduleStore } from '../stores/moduleStore';
import { useStore } from './useStore';

export interface NowPlaying {
  active: boolean;
  tab: BibleTab | undefined;
  moduleAbbr: string | null;
  book: number | null;
  chapter: number | null;
  verse: number | null;
  /** "John 3" */
  chapterLabel: string;
  /** "John 3:17", or the chapter alone before the first verse is known. */
  refLabel: string;
  /** Verse numbers of the chapter being read, ascending (from the tab's text). */
  verses: number[];
  /** Zero-based position of the current verse in `verses`, or -1. */
  verseIndex: number;
}

const EMPTY: NowPlaying = {
  active: false, tab: undefined, moduleAbbr: null, book: null, chapter: null, verse: null,
  chapterLabel: '', refLabel: '', verses: [], verseIndex: -1,
};

export function useNowPlaying(): NowPlaying {
  const playingTabId = useStore(audioStore, () => audioStore.playingTabId);
  const status = useStore(audioStore, () => audioStore.status);
  const module = useStore(audioStore, () => audioStore.playingModule);
  const followId = useStore(audioStore.follow, () => audioStore.follow.verseId);
  const tab = useStore(bibleStore, () => (playingTabId ? bibleStore.tabs.find(t => t.id === playingTabId) : undefined));
  if (!playingTabId || status === 'idle' || !tab) return EMPTY;

  // The verse being read names the chapter; the tab follows a moment later, on a page turn.
  const book = followId ? Math.floor(followId / 1_000_000) : tab.book;
  const chapter = followId ? Math.floor(followId / 1_000) % 1_000 : tab.chapter;
  const verse = followId ? followId % 1_000 : null;
  const chapterLabel = book && chapter ? `${moduleStore.getBookName(book)} ${chapter}` : '';
  const sameChapter = tab.book === book && tab.chapter === chapter;
  const verses = sameChapter ? tab.verses.map(v => v.verse).filter(v => v >= 1) : [];
  return {
    active: true,
    tab,
    moduleAbbr: module ?? tab.moduleAbbr,
    book,
    chapter,
    verse,
    chapterLabel,
    refLabel: chapterLabel && verse ? `${chapterLabel}:${verse}` : chapterLabel,
    verses,
    verseIndex: verse !== null ? verses.indexOf(verse) : -1,
  };
}
