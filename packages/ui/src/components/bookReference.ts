/**
 * Pure helpers behind BookChapterPicker: parse a typed passage reference and filter the book list.
 * No DOM, no i18n library: names and aliases come in as data, so the same code serves both apps and
 * extension panels. (This is the matcher both app pickers shared before 0062; it intentionally stays
 * separate from core's ReferenceParser, whose range/whole-book grammar differs from what the picker's
 * reference box accepts.)
 */
import { MAX_CHAPTERS, NT_BOOKS, OT_BOOKS, isSingleChapterBook } from '@bible/core/browser';

/**
 * `extended` (default): verse ranges ("John 3:16-18"), bare chapter ranges ("John 3-5" lands on chapter 3)
 * and single-chapter books ("Jude 5" means Jude 1:5, "Jude 5-7" a verse range). This is the web behaviour.
 * `basic`: only "Book chapter" and "Book chapter:verse" (the desktop behaviour before 0062: "Jude 5" is chapter 5).
 */
export type ReferenceSyntax = 'extended' | 'basic';

export interface ParsedReference {
  book: number;
  chapter: number;
  verse?: number;
  endVerse?: number;
}

export interface ReferenceLookup {
  /** Localized display name of a book (1..66). */
  bookName: (book: number) => string;
  /** Alias table (lower-case or not) to book number, for abbreviations and other spellings. */
  bookAliases?: Readonly<Record<string, number>>;
  syntax?: ReferenceSyntax;
}

const ALL_BOOKS: readonly number[] = [...OT_BOOKS, ...NT_BOOKS];

/** Normalize Roman numeral prefixes (i, ii, iii) to Arabic digits. */
export function normalizeRomanPrefix(input: string): string {
  return input
    .replace(/^iii\b\s*/i, '3 ')
    .replace(/^ii\b\s*/i, '2 ')
    .replace(/^i\b\s*/i, '1 ');
}

/** True when every character of `filter` appears in `text` in order. */
export function fuzzyMatch(text: string, filter: string): boolean {
  let ti = 0;
  for (let fi = 0; fi < filter.length; fi++) {
    const idx = text.indexOf(filter[fi], ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}

function buildCandidates(lookup: ReferenceLookup): Array<[string, number]> {
  const candidates: Array<[string, number]> = [];
  for (const bookNum of ALL_BOOKS) {
    const lowerName = lookup.bookName(bookNum).toLowerCase();
    if (!lowerName) continue; // an empty name would prefix-match every input
    candidates.push([lowerName, bookNum]);
    candidates.push([lowerName.substring(0, 3), bookNum]);
    if (/^\d/.test(lowerName)) candidates.push([lowerName.replace(' ', ''), bookNum]);
  }
  for (const [alias, bookNum] of Object.entries(lookup.bookAliases ?? {})) {
    if (alias) candidates.push([alias.toLowerCase(), bookNum]);
  }
  // Longest first so longer matches take priority.
  candidates.sort((a, b) => b[0].length - a[0].length);
  return candidates;
}

/** Parse "John 3:16", "jn 3", "1 cor 13", "Jude 5" ... Returns null when the text is not a passage. */
export function parseReference(input: string, lookup: ReferenceLookup): ParsedReference | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const extended = (lookup.syntax ?? 'extended') === 'extended';
  const normalized = normalizeRomanPrefix(trimmed.toLowerCase());
  const candidates = buildCandidates(lookup);

  // Groups (extended): 1 chapter (or verse in a single-chapter book), 2 end of a bare range ("Jude 5-7"),
  // 3 verse, 4 end verse. Basic: 1 chapter, 2 verse (remapped below).
  const fullRe = extended
    ? /^(\d+)(?:\s*[-–—]\s*(\d+))?(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/
    : /^(\d+)(?::(\d+))?$/;

  for (const [abbr, bookNum] of candidates) {
    if (!normalized.startsWith(abbr)) continue;
    const rest = normalized.substring(abbr.length).trim();
    const match = rest.match(fullRe);
    if (match) {
      if (!extended) {
        return { book: bookNum, chapter: parseInt(match[1], 10), verse: match[2] ? parseInt(match[2], 10) : undefined };
      }
      let chapter = parseInt(match[1], 10);
      let verse = match[3] ? parseInt(match[3], 10) : undefined;
      let endVerse = match[4] ? parseInt(match[4], 10) : undefined;
      if (isSingleChapterBook(bookNum) && verse === undefined) {
        // "Jude 5" means verse 5 of chapter 1, and "Jude 5-7" is a verse range.
        verse = chapter;
        chapter = 1;
        endVerse = match[2] ? parseInt(match[2], 10) : undefined;
      } else if (match[2] && verse === undefined) {
        // "John 3-5" is a chapter range; only a passage start is selectable, so land on the first chapter.
        return { book: bookNum, chapter, verse: undefined, endVerse: undefined };
      }
      return { book: bookNum, chapter, verse, endVerse };
    }
    if (!rest) return { book: bookNum, chapter: 1 };
  }

  // Partial book names: "chron 2" matches "chronicles".
  const partialRe = extended
    ? /^(\d?\s*[a-zA-Z]+)\s+(\d+)(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/
    : /^(\d?\s*[a-zA-Z]+)\s+(\d+)(?::(\d+))?$/;
  const partial = normalized.match(partialRe);
  if (partial) {
    const bookPart = partial[1].replace(/\s+/g, ' ').trim();
    let chapter = parseInt(partial[2], 10);
    let verse = partial[3] ? parseInt(partial[3], 10) : undefined;
    const endVerse = extended && partial[4] ? parseInt(partial[4], 10) : undefined;
    for (const [abbr, bookNum] of candidates) {
      if (abbr.startsWith(bookPart) && abbr.length > bookPart.length) {
        if (extended && isSingleChapterBook(bookNum) && verse === undefined) {
          verse = chapter;
          chapter = 1;
        }
        return { book: bookNum, chapter, verse, endVerse };
      }
    }
  }
  return null;
}

/** The book-name portion of the input, for filtering the book list (trailing chapter:verse removed). */
export function getBookFilterText(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^\d+$/.test(trimmed)) return ''; // a bare number is a chapter, not a book filter
  const match = trimmed.match(/^(\d?\s*[a-zA-Z]+)\s*\d/);
  if (match) return match[1].trim();
  return trimmed;
}

/** Keep the books whose name, 3-letter abbreviation, alias or letter-subsequence matches the filter text. */
export function filterBooks(
  books: readonly number[],
  filter: string,
  lookup: Pick<ReferenceLookup, 'bookName' | 'bookAliases'>,
): number[] {
  if (!filter) return [...books];
  const lower = normalizeRomanPrefix(filter.toLowerCase());
  const aliasesByBook = new Map<number, string[]>();
  for (const [alias, bookNum] of Object.entries(lookup.bookAliases ?? {})) {
    const list = aliasesByBook.get(bookNum) ?? [];
    list.push(alias.toLowerCase());
    aliasesByBook.set(bookNum, list);
  }
  return books.filter((num) => {
    const name = lookup.bookName(num).toLowerCase();
    if (name.startsWith(lower)) return true;
    if (name.substring(0, 3).startsWith(lower)) return true;
    if (/^\d/.test(name) && name.replace(' ', '').startsWith(lower)) return true;
    if (aliasesByBook.get(num)?.some((a) => a.startsWith(lower))) return true;
    return fuzzyMatch(name, lower);
  });
}

/** Chapter count of a book (1 when unknown). */
export function chapterCount(book: number): number {
  return MAX_CHAPTERS[book] ?? 1;
}
