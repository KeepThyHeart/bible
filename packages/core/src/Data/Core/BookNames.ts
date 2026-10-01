/**
 * Canonical English book-name tables - the single source of truth for the repo.
 *
 * Before this module existed, a full 66-book table was hardcoded in more than a
 * dozen places across core and its consumers. Those copies differed only in
 * their alias sets, never in the display names, so this file is their union:
 * every alias that parsed anywhere before still parses here.
 *
 * ## Localization
 *
 * These are the *English* defaults. `ReferenceParser` accepts its own tables
 * via `ReferenceParserConfig`, so a localized app supplies translated names
 * rather than editing this file. UI code that displays a book name to the user
 * should prefer the app's i18n lookup and fall back to `getBookName()`; these
 * constants exist for parsing, for non-UI contexts, and as that fallback.
 *
 * It imports only a JSON file and has no platform dependencies, so it is safe
 * in a browser bundle, an Electron renderer, and a Node script alike.
 */

/**
 * Book name format for reference output.
 * - 'long': Full book names (e.g., "Acts", "Romans", "1 Corinthians")
 * - 'short': TSK-style abbreviations (e.g., "Ac", "Ro", "1Co")
 * - 'medium': Standard abbreviations (e.g., "Act", "Rom", "1 Cor")
 */
export type BookNameFormat = 'long' | 'short' | 'medium';

/** Total number of books in the standard English canon. */
export const BOOK_COUNT = 66;


import enData from '../../Reference/locales/en.json';

/**
 * Since task 0077 the English names live in the reference engine's locale
 * file `Reference/locales/en.json` (the one book-name data format for every
 * language); the tables below are built from it so existing imports keep
 * working.
 */
const EN_BOOKS = (enData as { books: Record<string, { long: string; medium?: string; short?: string; aliases?: string[] }> }).books;

function table(pick: (b: { long: string; medium?: string; short?: string }) => string): Record<number, string> {
  const t: Record<number, string> = {};
  for (let n = 1; n <= BOOK_COUNT; n++) t[n] = pick(EN_BOOKS[String(n)]);
  return t;
}

/** Long (full) book names, indexed by book number 1-66. */
export const LONG_NAMES: Record<number, string> = table((b) => b.long);

/** Medium-length abbreviations (SBL style: "Exod", "Ps"), indexed by book number 1-66. */
export const MEDIUM_NAMES: Record<number, string> = table((b) => b.medium ?? b.long);

/** Short TSK-style abbreviations, indexed by book number 1-66. */
export const SHORT_NAMES: Record<number, string> = table((b) => b.short ?? b.medium ?? b.long);

export const ENGLISH_SINGLE_CHAPTER_BOOKS = new Set([
  31,  // Obadiah
  57,  // Philemon
  63,  // 2 John
  64,  // 3 John
  65,  // Jude
]);

export const ENGLISH_DISPLAY_NAMES: string[] = Array.from({ length: BOOK_COUNT }, (_, i) => LONG_NAMES[i + 1]);

/** Lower-case name or abbreviation -> book number: every long, medium and short name plus the aliases of en.json. */
export const ENGLISH_BOOK_NAMES: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (let n = 1; n <= BOOK_COUNT; n++) {
    const b = EN_BOOKS[String(n)];
    for (const name of [b.long, b.medium, b.short, ...(b.aliases ?? [])]) {
      if (!name) continue;
      const key = name.toLowerCase();
      if (!m.has(key)) m.set(key, n);
    }
  }
  return m;
})();

/** Name tables keyed by format. */
const NAME_TABLES: Record<BookNameFormat, Record<number, string>> = {
  long: LONG_NAMES,
  medium: MEDIUM_NAMES,
  short: SHORT_NAMES,
};

/**
 * Get the English book name for a book number in the requested format.
 * Returns `Book <n>` for out-of-range numbers rather than throwing, so callers
 * rendering user-supplied data cannot crash on a bad book number.
 */
export function getBookName(bookNumber: number, format: BookNameFormat = 'long'): string {
  return NAME_TABLES[format][bookNumber] ?? `Book ${bookNumber}`;
}

/**
 * Chapter count per book, keyed by book number 1-66 (standard English / KJV
 * versification - the only scheme the apps support). One table for both
 * clients: pickers, prev/next chapter navigation and the advanced-search
 * chapter range all clamp against it.
 */
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

/** Book numbers of the Old Testament (1-39), in canonical order. */
export const OT_BOOKS: number[] = Array.from({ length: 39 }, (_, i) => i + 1);

/** Book numbers of the New Testament (40-66), in canonical order. */
export const NT_BOOKS: number[] = Array.from({ length: 27 }, (_, i) => i + 40);

/** True when the book has a single chapter ("Jude 5" means "Jude 1:5"). */
export function isSingleChapterBook(bookNumber: number): boolean {
  return ENGLISH_SINGLE_CHAPTER_BOOKS.has(bookNumber);
}

/**
 * Resolve a book name or abbreviation to its book number, or `undefined`.
 * Input is lower-cased and trimmed; internal spacing must match a table entry
 * (both spaced and unspaced forms are present for the numbered books).
 */
export function getBookNumber(bookName: string): number | undefined {
  return ENGLISH_BOOK_NAMES.get(bookName.toLowerCase().trim());
}
