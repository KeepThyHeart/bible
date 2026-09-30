/**
 * Canon geometry for the graph views: verse ids to chapter indexes (0..1188) and
 * positions along the canon (0..1). Pure; shares chapter counts with BookNames.
 */
import { MAX_CHAPTERS } from '../../Data/Core/BookNames';
import type { VerseId } from '../../Data/Core/Types';
import { BIBLE_SECTIONS } from '../BibleSections';
import type { BibleSectionKey } from '../BibleSections';

export const BOOKS = 66;

/** First chapter index of each book; index 0 is unused, `[67]` is the total. */
const FIRST_CHAPTER: number[] = (() => {
  const out = [0, 0];
  for (let b = 1; b <= BOOKS; b++) out[b + 1] = out[b] + MAX_CHAPTERS[b];
  return out;
})();

export const CHAPTER_COUNT = FIRST_CHAPTER[BOOKS + 1];

export function bookOf(verseId: VerseId): number {
  return Math.floor(verseId / 1_000_000);
}
export function chapterOf(verseId: VerseId): number {
  return Math.floor(verseId / 1000) % 1000;
}
export function verseOf(verseId: VerseId): number {
  return verseId % 1000;
}

/** Chapter index 0..1188 in canon order, or -1 for a verse id that is not in the 66-book canon. */
export function chapterIndex(verseId: VerseId): number {
  const book = bookOf(verseId);
  const chapter = chapterOf(verseId);
  if (book < 1 || book > BOOKS || chapter < 1 || chapter > MAX_CHAPTERS[book]) return -1;
  return FIRST_CHAPTER[book] + chapter - 1;
}

export function chapterFromIndex(index: number): { book: number; chapter: number } {
  if (index < 0 || index >= CHAPTER_COUNT) throw new RangeError(`Chapter index out of range: ${index}`);
  let lo = 1;
  let hi = BOOKS;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (FIRST_CHAPTER[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { book: lo, chapter: index - FIRST_CHAPTER[lo] + 1 };
}

export function bookOfChapterIndex(index: number): number {
  return chapterFromIndex(index).book;
}

/** First chapter index of a book (1..66). */
export function bookFirstChapterIndex(book: number): number {
  return FIRST_CHAPTER[book];
}

/** Position 0..1 along the canon. Within a chapter the verse is spread over up to 176 verses (Psalm 119). */
export function canonPosition(verseId: VerseId): number {
  const idx = chapterIndex(verseId);
  if (idx < 0) return 0;
  const frac = Math.min(Math.max(verseOf(verseId) - 1, 0), 176) / 177;
  return (idx + frac) / CHAPTER_COUNT;
}

/** Position of the middle of a chapter, 0..1. */
export function chapterCanonPosition(index: number): number {
  return (index + 0.5) / CHAPTER_COUNT;
}

/** Index 0..9 into BIBLE_SECTIONS for a book, used to pick section colours. */
export function sectionIndexOfBook(book: number): number {
  const i = BIBLE_SECTIONS.findIndex(s => book >= s.firstBook && book <= s.lastBook);
  return i < 0 ? 0 : i;
}

export function sectionKeyOfBook(book: number): BibleSectionKey {
  return BIBLE_SECTIONS[sectionIndexOfBook(book)].key;
}
