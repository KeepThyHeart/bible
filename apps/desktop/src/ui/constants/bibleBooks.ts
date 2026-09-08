/**
 * Book constants for the desktop UI.
 *
 * The book names and parse aliases come from `@bible/core` (Data/Core/BookNames),
 * which is the single source of truth for the repo - a local 66-book table
 * and alias map here would drift out of step with core's 385. The chapter
 * counts, testament splits and search ranges below are genuinely
 * desktop-specific and stay here.
 */
import { LONG_NAMES, ENGLISH_BOOK_NAMES } from '@bible/core';

/** Full English book names, indexed by book number 1-66. */
export const BOOK_NAMES: Record<number, string> = LONG_NAMES;

/**
 * Book name/abbreviation -> book number, for the picker's typeahead.
 * Derived from core's alias table so the picker accepts everything the
 * reference parser does.
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

export const OT_BOOKS = Array.from({ length: 39 }, (_, i) => i + 1);
export const NT_BOOKS = Array.from({ length: 27 }, (_, i) => i + 40);

/** Ordered list of every book, for populating book pickers. */
export const ALL_BOOKS: Array<{ number: number; name: string }> =
  Array.from({ length: 66 }, (_, i) => ({ number: i + 1, name: BOOK_NAMES[i + 1] }));

export interface PredefinedRange {
  id: string;
  /** Catalog key for the group's display name. */
  labelKey: string;
  /** Inclusive book numbers in the standard English (KJV) ordering. */
  startBook: number;
  endBook: number;
}

/**
 * Named book groupings offered as one-click scopes in Advanced Search.
 *
 * The ids and book spans are safe to hardcode because this app supports exactly
 * one versification scheme (standard English / KJV ordering) - see the "Single
 * Versification Scheme" constraint in CLAUDE.md. The names are not: they are
 * the conventional Protestant divisions in English, so they live in the
 * catalog and are resolved at render time.
 */
export const PREDEFINED_RANGES: PredefinedRange[] = [
  { id: 'ot', labelKey: 'bibleBooks.range.ot', startBook: 1, endBook: 39 },
  { id: 'nt', labelKey: 'bibleBooks.range.nt', startBook: 40, endBook: 66 },
  { id: 'pentateuch', labelKey: 'bibleBooks.range.pentateuch', startBook: 1, endBook: 5 },
  { id: 'ot-history', labelKey: 'bibleBooks.range.otHistory', startBook: 6, endBook: 17 },
  { id: 'wisdom', labelKey: 'bibleBooks.range.wisdom', startBook: 18, endBook: 22 },
  { id: 'major-prophets', labelKey: 'bibleBooks.range.majorProphets', startBook: 23, endBook: 27 },
  { id: 'minor-prophets', labelKey: 'bibleBooks.range.minorProphets', startBook: 28, endBook: 39 },
  { id: 'gospels', labelKey: 'bibleBooks.range.gospels', startBook: 40, endBook: 43 },
  { id: 'acts', labelKey: 'bibleBooks.range.acts', startBook: 44, endBook: 44 },
  { id: 'pauline', labelKey: 'bibleBooks.range.pauline', startBook: 45, endBook: 57 },
  { id: 'general-epistles', labelKey: 'bibleBooks.range.generalEpistles', startBook: 58, endBook: 65 },
  { id: 'revelation', labelKey: 'bibleBooks.range.revelation', startBook: 66, endBook: 66 },
];
