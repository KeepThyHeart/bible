/**
 * What the audio UI shows about the verse being read: the chapter, the verse, how far through the chapter.
 * Derived from the audio store's follow state and the playing pane's text, so the bar, the pop-up and the
 * live region all say the same thing. A "tab" for audio is a Bible pane (its panel id).
 */
import { useAudio, useFollow } from '../audioState';
import { useBibleStore } from '../../../stores/useBibleStore';
import type { BibleVerse } from '../../../stores/useBibleStore';
import { useI18n } from '../../../contexts/useI18n';
import { localizedBookNames } from '../../../constants/bibleBooks';

export interface NowPlaying {
  active: boolean;
  panelId: string | null;
  moduleAbbr: string | null;
  book: number | null;
  chapter: number | null;
  verse: number | null;
  /** "John 3" */
  chapterLabel: string;
  /** "John 3:17", or the chapter alone before the first verse is known. */
  refLabel: string;
  /** The chapter being read, from the pane's text (empty until it has loaded, or while the pane turns the page). */
  verseList: readonly BibleVerse[];
  /** Verse numbers of that chapter, ascending (no verse 0 preface). */
  verses: number[];
  /** Zero-based position of the current verse in `verses`, or -1. */
  verseIndex: number;
  /** The pane's own selected verse id (for "Read from"). */
  selectedVerseId: number | null;
  /** True while the pane has the chapter being read on screen. */
  ready: boolean;
}

const EMPTY: NowPlaying = {
  active: false, panelId: null, moduleAbbr: null, book: null, chapter: null, verse: null, chapterLabel: '', refLabel: '',
  verseList: [], verses: [], verseIndex: -1, selectedVerseId: null, ready: false,
};
const NO_VERSES: readonly BibleVerse[] = [];

export function useNowPlaying(): NowPlaying {
  const { localizer } = useI18n();
  const panelId = useAudio(s => s.playingTabId);
  const status = useAudio(s => s.status);
  const module = useAudio(s => s.playingModule);
  const { verseId } = useFollow();
  const panel = useBibleStore(s => (panelId ? s.panels.get(panelId) : undefined));
  if (!panelId || status === 'idle') return EMPTY;

  const tab = panel?.openTabs[0];
  // The verse being read names the chapter; the pane follows a moment later, on a page turn.
  const book = verseId ? Math.floor(verseId / 1_000_000) : (tab?.book ?? null);
  const chapter = verseId ? Math.floor(verseId / 1_000) % 1_000 : (tab?.chapter ?? null);
  const verse = verseId ? verseId % 1_000 : null;
  const name = book ? (localizedBookNames(localizer)[book] ?? tab?.bookName ?? '') : '';
  const chapterLabel = book && chapter ? `${name} ${chapter}` : '';
  const sameChapter = !!tab && tab.book === book && tab.chapter === chapter;
  const all = tab && sameChapter && !panel?.loadingByTab.get(tab.tabId) ? (panel?.versesByTab.get(tab.tabId) ?? NO_VERSES) : NO_VERSES;
  const verseList = all.filter(v => v.verse >= 1);
  const verses = verseList.map(v => v.verse);
  return {
    active: true,
    panelId,
    moduleAbbr: module ?? tab?.abbreviation ?? null,
    book,
    chapter,
    verse,
    chapterLabel,
    refLabel: chapterLabel && verse ? `${chapterLabel}:${verse}` : chapterLabel,
    verseList,
    verses,
    verseIndex: verse !== null ? verses.indexOf(verse) : -1,
    selectedVerseId: panel?.selectedVerseId ?? null,
    ready: verseList.length > 0,
  };
}
