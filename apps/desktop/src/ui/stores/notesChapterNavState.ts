import { MAX_CHAPTERS } from '../constants/bibleBooks';

/**
 * Where a notes pane in Chapter mode is sitting: which chapter, which
 * translation, and the small view options. Persisted inside
 * `NotesPanelNavState.chapter` and handed over on pop-out.
 */
export interface ChapterModeNavState {
  book: number;
  chapter: number;
  /** Abbreviation; undefined = follow the Bible pane's translation. */
  translation?: string;
  /** Follow the Bible pane (default true). */
  follow: boolean;
  /** Show only verses that have a note (plus the active row). */
  onlyWithNotes: boolean;
  /** Verse number whose editor is open. */
  activeVerse?: number;
  /** First visible verse (scroll restore). */
  anchorVerse?: number;
}

export const DEFAULT_CHAPTER_STATE = (book = 1, chapter = 1): ChapterModeNavState => ({
  book,
  chapter,
  follow: true,
  onlyWithNotes: false,
});

function intInRange(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

/** Coerce a persisted / handed-over value into a valid state, or undefined when the position makes no sense. */
export function sanitizeChapterModeNavState(raw: unknown): ChapterModeNavState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const book = intInRange(value.book, 1, 66);
  if (book === undefined) return undefined;
  const chapter = intInRange(value.chapter, 1, MAX_CHAPTERS[book] ?? 0);
  if (chapter === undefined) return undefined;
  const state: ChapterModeNavState = {
    book,
    chapter,
    follow: typeof value.follow === 'boolean' ? value.follow : true,
    onlyWithNotes: typeof value.onlyWithNotes === 'boolean' ? value.onlyWithNotes : false,
  };
  if (typeof value.translation === 'string' && value.translation.length > 0 && value.translation.length <= 64) {
    state.translation = value.translation;
  }
  const activeVerse = intInRange(value.activeVerse, 1, 999);
  if (activeVerse !== undefined) state.activeVerse = activeVerse;
  const anchorVerse = intInRange(value.anchorVerse, 1, 999);
  if (anchorVerse !== undefined) state.anchorVerse = anchorVerse;
  return state;
}

export function chapterStatesEqual(a: ChapterModeNavState | undefined, b: ChapterModeNavState | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.book === b.book &&
    a.chapter === b.chapter &&
    a.translation === b.translation &&
    a.follow === b.follow &&
    a.onlyWithNotes === b.onlyWithNotes &&
    a.activeVerse === b.activeVerse &&
    a.anchorVerse === b.anchorVerse
  );
}
