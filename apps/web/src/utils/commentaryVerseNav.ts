import { MAX_CHAPTERS } from '../constants';

export interface VerseStep {
  book: number;
  chapter: number;
  /** Verse number to land on; `null` = "first verse of the chapter" (resolved once its text has loaded). */
  verse: number | null;
  /** True when the step leaves the current chapter, so the Bible pane has to load the new one. */
  crossesChapter: boolean;
}

/**
 * Where the commentary's Next/Previous verse buttons go from `verse`.
 *
 * `chapterVerses` are the verse numbers of the chapter being read (when known).
 * Stepping forward from its last verse goes to verse 1 of the next chapter, and
 * from a book's last chapter to the next book; John 3:36 -> John 4:1, not 3:37.
 * Without the list the step is a plain +/-1 inside the chapter.
 * Returns null at the Bible's two ends (Genesis 1:1 backwards, Revelation 22 forwards).
 */
export function stepCommentaryVerse(
  book: number,
  chapter: number,
  verse: number,
  delta: 1 | -1,
  chapterVerses?: number[],
): VerseStep | null {
  const known = chapterVerses && chapterVerses.length > 0
    ? [...chapterVerses].filter(n => n > 0).sort((a, b) => a - b)
    : null;

  if (delta === 1) {
    const last = known ? known[known.length - 1] : null;
    if (last == null || verse < last) {
      const next = known ? known.find(n => n > verse) ?? verse + 1 : verse + 1;
      return { book, chapter, verse: next, crossesChapter: false };
    }
    if (chapter < (MAX_CHAPTERS[book] || 1)) return { book, chapter: chapter + 1, verse: 1, crossesChapter: true };
    if (book >= 66) return null;
    return { book: book + 1, chapter: 1, verse: 1, crossesChapter: true };
  }

  const first = known ? known[0] : 1;
  if (verse > first) {
    const prev = known ? [...known].reverse().find(n => n < verse) ?? verse - 1 : verse - 1;
    return { book, chapter, verse: prev, crossesChapter: false };
  }
  if (chapter > 1) return { book, chapter: chapter - 1, verse: null, crossesChapter: true };
  if (book <= 1) return null;
  return { book: book - 1, chapter: MAX_CHAPTERS[book - 1] || 1, verse: null, crossesChapter: true };
}
