import { LONG_NAMES, ENGLISH_BOOK_NAMES } from '@bible/core/browser';
import { getLocalizedBookName } from './utils/bookNames';

/**
 * English book names — kept as a fallback for server-side / non-UI contexts
 * where i18n may not be initialized.
 * @deprecated For UI display, use `t(String(bookNumber), { ns: 'books' })` (React)
 *   or `getLocalizedBookName(bookNumber)` (non-React).
 */
export const BOOK_NAMES: Record<number, string> = LONG_NAMES;

/**
 * Alternate book names/abbreviations mapped to their book number, for
 * reference parsing and book filtering. Sourced from '@bible/core', which
 * holds the repo-wide alias table; this file used to keep a 52-entry subset.
 */
export const BOOK_ALIASES: Record<string, number> = Object.fromEntries(ENGLISH_BOOK_NAMES);

export const MAX_CHAPTERS: Record<number, number> = {
  1: 50, 2: 40, 3: 27, 4: 36, 5: 34, 6: 24, 7: 21, 8: 4, 9: 31, 10: 24,
  11: 22, 12: 25, 13: 29, 14: 36, 15: 10, 16: 13, 17: 10, 18: 42, 19: 150,
  20: 31, 21: 12, 22: 8, 23: 66, 24: 52, 25: 5, 26: 48, 27: 12,
  28: 14, 29: 3, 30: 9, 31: 1, 32: 4, 33: 7, 34: 3, 35: 3, 36: 3, 37: 2,
  38: 14, 39: 4, 40: 28, 41: 16, 42: 24, 43: 21, 44: 28, 45: 16,
  46: 16, 47: 13, 48: 6, 49: 6, 50: 4, 51: 4, 52: 5, 53: 3, 54: 6, 55: 4,
  56: 3, 57: 1, 58: 13, 59: 5, 60: 5, 61: 3, 62: 5, 63: 1, 64: 1, 65: 1,
  66: 22,
};

/** Whether a book has only one chapter (Obadiah, Philemon, 2 John, 3 John, Jude) */
export function isSingleChapterBook(bookNumber: number): boolean {
  return MAX_CHAPTERS[bookNumber] === 1;
}

/**
 * Format a passage reference, omitting the chapter for single-chapter books.
 * Examples:
 *   formatPassageRef(43, 3)       → "John 3"
 *   formatPassageRef(43, 3, 16)   → "John 3:16"
 *   formatPassageRef(65, 1)       → "Jude"
 *   formatPassageRef(65, 1, 3)    → "Jude 3"
 */
export function formatPassageRef(bookNumber: number, chapter: number, verse?: number | null, bookName?: string): string {
  const name = bookName ?? getLocalizedBookName(bookNumber);
  const single = isSingleChapterBook(bookNumber);
  if (verse) {
    return single ? `${name} ${verse}` : `${name} ${chapter}:${verse}`;
  }
  return single ? name : `${name} ${chapter}`;
}
