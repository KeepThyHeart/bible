/**
 * How many chapters each book has, for the phone's picker.
 *
 * This is a property of the canon rather than of any module, and the picker
 * needs it before a single verse has been fetched — it is what stops someone
 * scrolling to Jude 7 and finding it does not exist. The wrong options a round
 * offers are never built from this table; they are drawn from the module
 * itself, which is the only thing that knows what it carries.
 */

import { BOOK_COUNT } from '../../../shared/verseId.js';

/** Indexed by book number minus one, matching `BOOK_NAMES`. */
export const CHAPTER_COUNTS: readonly number[] = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52,
  5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5,
  3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
];

export function chapterCount(book: number): number {
  if (!Number.isInteger(book) || book < 1 || book > BOOK_COUNT) return 1;
  return CHAPTER_COUNTS[book - 1] ?? 1;
}

/** The chapter numbers a picker may offer for a book. */
export function chaptersOf(book: number): number[] {
  return Array.from({ length: chapterCount(book) }, (_unused, index) => index + 1);
}
