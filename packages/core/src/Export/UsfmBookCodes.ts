/**
 * Mapping between the module format's book numbers (1..66, Protestant canon) and
 * the identifiers USFM uses.
 *
 * - `code` is the three-character USFM/Paratext book identifier used on the `\id` line.
 * - `fileNumber` is the two-digit prefix used by the conventional USFM filename.
 *   Paratext reserves `40` for deuterocanonical material, so the New Testament
 *   runs 41 (Matthew) through 67 (Revelation).
 * - `name` is the default English book name used for `\h` and `\mt1` when the
 *   caller does not supply its own names.
 */
export interface UsfmBook {
  readonly bookNumber: number;
  readonly code: string;
  readonly fileNumber: number;
  readonly name: string;
}

const BOOKS: readonly UsfmBook[] = [
  { bookNumber: 1, code: 'GEN', fileNumber: 1, name: 'Genesis' },
  { bookNumber: 2, code: 'EXO', fileNumber: 2, name: 'Exodus' },
  { bookNumber: 3, code: 'LEV', fileNumber: 3, name: 'Leviticus' },
  { bookNumber: 4, code: 'NUM', fileNumber: 4, name: 'Numbers' },
  { bookNumber: 5, code: 'DEU', fileNumber: 5, name: 'Deuteronomy' },
  { bookNumber: 6, code: 'JOS', fileNumber: 6, name: 'Joshua' },
  { bookNumber: 7, code: 'JDG', fileNumber: 7, name: 'Judges' },
  { bookNumber: 8, code: 'RUT', fileNumber: 8, name: 'Ruth' },
  { bookNumber: 9, code: '1SA', fileNumber: 9, name: '1 Samuel' },
  { bookNumber: 10, code: '2SA', fileNumber: 10, name: '2 Samuel' },
  { bookNumber: 11, code: '1KI', fileNumber: 11, name: '1 Kings' },
  { bookNumber: 12, code: '2KI', fileNumber: 12, name: '2 Kings' },
  { bookNumber: 13, code: '1CH', fileNumber: 13, name: '1 Chronicles' },
  { bookNumber: 14, code: '2CH', fileNumber: 14, name: '2 Chronicles' },
  { bookNumber: 15, code: 'EZR', fileNumber: 15, name: 'Ezra' },
  { bookNumber: 16, code: 'NEH', fileNumber: 16, name: 'Nehemiah' },
  { bookNumber: 17, code: 'EST', fileNumber: 17, name: 'Esther' },
  { bookNumber: 18, code: 'JOB', fileNumber: 18, name: 'Job' },
  { bookNumber: 19, code: 'PSA', fileNumber: 19, name: 'Psalms' },
  { bookNumber: 20, code: 'PRO', fileNumber: 20, name: 'Proverbs' },
  { bookNumber: 21, code: 'ECC', fileNumber: 21, name: 'Ecclesiastes' },
  { bookNumber: 22, code: 'SNG', fileNumber: 22, name: 'Song of Solomon' },
  { bookNumber: 23, code: 'ISA', fileNumber: 23, name: 'Isaiah' },
  { bookNumber: 24, code: 'JER', fileNumber: 24, name: 'Jeremiah' },
  { bookNumber: 25, code: 'LAM', fileNumber: 25, name: 'Lamentations' },
  { bookNumber: 26, code: 'EZK', fileNumber: 26, name: 'Ezekiel' },
  { bookNumber: 27, code: 'DAN', fileNumber: 27, name: 'Daniel' },
  { bookNumber: 28, code: 'HOS', fileNumber: 28, name: 'Hosea' },
  { bookNumber: 29, code: 'JOL', fileNumber: 29, name: 'Joel' },
  { bookNumber: 30, code: 'AMO', fileNumber: 30, name: 'Amos' },
  { bookNumber: 31, code: 'OBA', fileNumber: 31, name: 'Obadiah' },
  { bookNumber: 32, code: 'JON', fileNumber: 32, name: 'Jonah' },
  { bookNumber: 33, code: 'MIC', fileNumber: 33, name: 'Micah' },
  { bookNumber: 34, code: 'NAM', fileNumber: 34, name: 'Nahum' },
  { bookNumber: 35, code: 'HAB', fileNumber: 35, name: 'Habakkuk' },
  { bookNumber: 36, code: 'ZEP', fileNumber: 36, name: 'Zephaniah' },
  { bookNumber: 37, code: 'HAG', fileNumber: 37, name: 'Haggai' },
  { bookNumber: 38, code: 'ZEC', fileNumber: 38, name: 'Zechariah' },
  { bookNumber: 39, code: 'MAL', fileNumber: 39, name: 'Malachi' },
  { bookNumber: 40, code: 'MAT', fileNumber: 41, name: 'Matthew' },
  { bookNumber: 41, code: 'MRK', fileNumber: 42, name: 'Mark' },
  { bookNumber: 42, code: 'LUK', fileNumber: 43, name: 'Luke' },
  { bookNumber: 43, code: 'JHN', fileNumber: 44, name: 'John' },
  { bookNumber: 44, code: 'ACT', fileNumber: 45, name: 'Acts' },
  { bookNumber: 45, code: 'ROM', fileNumber: 46, name: 'Romans' },
  { bookNumber: 46, code: '1CO', fileNumber: 47, name: '1 Corinthians' },
  { bookNumber: 47, code: '2CO', fileNumber: 48, name: '2 Corinthians' },
  { bookNumber: 48, code: 'GAL', fileNumber: 49, name: 'Galatians' },
  { bookNumber: 49, code: 'EPH', fileNumber: 50, name: 'Ephesians' },
  { bookNumber: 50, code: 'PHP', fileNumber: 51, name: 'Philippians' },
  { bookNumber: 51, code: 'COL', fileNumber: 52, name: 'Colossians' },
  { bookNumber: 52, code: '1TH', fileNumber: 53, name: '1 Thessalonians' },
  { bookNumber: 53, code: '2TH', fileNumber: 54, name: '2 Thessalonians' },
  { bookNumber: 54, code: '1TI', fileNumber: 55, name: '1 Timothy' },
  { bookNumber: 55, code: '2TI', fileNumber: 56, name: '2 Timothy' },
  { bookNumber: 56, code: 'TIT', fileNumber: 57, name: 'Titus' },
  { bookNumber: 57, code: 'PHM', fileNumber: 58, name: 'Philemon' },
  { bookNumber: 58, code: 'HEB', fileNumber: 59, name: 'Hebrews' },
  { bookNumber: 59, code: 'JAS', fileNumber: 60, name: 'James' },
  { bookNumber: 60, code: '1PE', fileNumber: 61, name: '1 Peter' },
  { bookNumber: 61, code: '2PE', fileNumber: 62, name: '2 Peter' },
  { bookNumber: 62, code: '1JN', fileNumber: 63, name: '1 John' },
  { bookNumber: 63, code: '2JN', fileNumber: 64, name: '2 John' },
  { bookNumber: 64, code: '3JN', fileNumber: 65, name: '3 John' },
  { bookNumber: 65, code: 'JUD', fileNumber: 66, name: 'Jude' },
  { bookNumber: 66, code: 'REV', fileNumber: 67, name: 'Revelation' }
];

/** All 66 canonical books, in canonical order. */
export const USFM_BOOKS: readonly UsfmBook[] = BOOKS;

const BY_NUMBER: ReadonlyMap<number, UsfmBook> = new Map(BOOKS.map((b) => [b.bookNumber, b]));
const BY_CODE: ReadonlyMap<string, UsfmBook> = new Map(BOOKS.map((b) => [b.code, b]));

/** Look up a book by its 1..66 book number. Returns `undefined` if out of canon. */
export function getUsfmBookByNumber(bookNumber: number): UsfmBook | undefined {
  return BY_NUMBER.get(bookNumber);
}

/** Look up a book by its USFM identifier (case-insensitive). */
export function getUsfmBookByCode(code: string): UsfmBook | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/**
 * Conventional USFM filename for a book, e.g. `01-GEN.usfm`, `44-JHN.usfm`.
 */
export function usfmFileName(book: UsfmBook, extension = 'usfm'): string {
  const prefix = String(book.fileNumber).padStart(2, '0');
  return `${prefix}-${book.code}.${extension}`;
}
