/**
 * Pure logic behind `ReferencePicker`: parse a typed reference into a `ReferenceValue`, and suggest books.
 *
 * Deliberately does not call `ReferenceParser.parse()` on the whole string: that regex is ASCII-only
 * (`[a-z]+`), so "Génesis 1:1" and "约翰福音 3:16" never parse, and it reads "John 3-5" as chapter 3 verse 5.
 * Instead the book text is split from the numbers here, and the parsers are used only to resolve the book
 * (`getBookNumber`, `getBookNumberFuzzy`) and to `format` the result.
 */
import {
  ENGLISH_BOOK_NAMES,
  ENGLISH_DISPLAY_NAMES,
  MAX_CHAPTERS,
  ReferenceParser,
  VerseIdHelper,
  getLocalizer,
  isSingleChapterBook,
} from '@bible/core/browser';
import type { Localizer, ParsedReference } from '@bible/core/browser';

/** The committed value of a `ReferencePicker` (and the `kth-change` detail of the kit element). */
export interface ReferenceValue {
  /** `VerseIdHelper.calculate(book, chapter, verse ?? 1)`. */
  verseId: number;
  /** Ranges only: same-chapter "3:16-18" or cross-chapter "3:16-4:2". */
  endVerseId?: number;
  /** Canonical reference in the active locale, e.g. "Juan 3:16". */
  ref: string;
  /** "John 3": `verseId` is chapter:1 and there is no `endVerseId` (core has no verse counts). */
  wholeChapter?: true;
}

export interface ReferenceInputOptions {
  /** Reject "3:16-18" and "3:16-4:2". */
  noRanges?: boolean;
  /** Reject a bare chapter ("John 3"). */
  noWholeChapter?: boolean;
}

export type ParseReferenceInputResult =
  | { ok: true; value: ReferenceValue; book: number; fuzzy: boolean }
  | { ok: false };

export interface BookSuggestion {
  book: number;
  /** Localized display name. */
  name: string;
}

interface PickerParsers {
  /** Formats `ref` and supplies the locale's book tables. */
  primary: ReferenceParser;
  /** Every parser that may resolve the book, locale first; English is always accepted as input. */
  all: ReferenceParser[];
  localizer: Localizer;
  displayNames: readonly string[];
  aliasKeys: ReadonlyMap<string, number>;
}

const parserCache = new Map<string, PickerParsers>();
const EN = new ReferenceParser();

/** Locale parser plus English (memoized per tag). A locale without a book-name table uses English only. */
export function getPickerParsers(locale: string): PickerParsers {
  const hit = parserCache.get(locale);
  if (hit) return hit;
  const localizer = getLocalizer(locale);
  const config = localizer.referenceParserConfig;
  const primary = config ? new ReferenceParser(config) : EN;
  const built: PickerParsers = {
    primary,
    all: primary === EN ? [EN] : [primary, EN],
    localizer,
    displayNames: config?.displayNames ?? ENGLISH_DISPLAY_NAMES,
    aliasKeys: config?.bookNames ?? ENGLISH_BOOK_NAMES,
  };
  parserCache.set(locale, built);
  return built;
}

const ZERO_DIGIT_BLOCKS = [0x0660, 0x06f0, 0x0966, 0xff10];

/** NFC, Unicode digits to ASCII, full-width colon and dash variants to ASCII, whitespace collapsed. */
export function normalizeInput(input: string): string {
  let s = input.normalize('NFC');
  s = s.replace(/[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\uff10-\uff19]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const zero = ZERO_DIGIT_BLOCKS.find((z) => code >= z && code <= z + 9) as number;
    return String(code - zero);
  });
  s = s.replace(/\uff1a/g, ':').replace(/[\u2013\u2014\u2212]/g, '-');
  return s.replace(/\s+/g, ' ').trim();
}

const SPLIT = /^\s*((?:[1-3]\s*)?[^\d]+?)\s*(\d[\d:\-\s]*)?$/u;
const NUMBERS = /^(\d+)(?::(\d+))?(?:\s*-\s*(?:(\d+):)?(\d+))?$/;

/** Split text into a book part and an optional numeric part; `null` when it has no book text. */
export function splitReferenceInput(text: string): { bookPart: string; numPart?: string } | null {
  const m = SPLIT.exec(normalizeInput(text));
  if (!m) return null;
  const bookPart = m[1].trim();
  if (!bookPart) return null;
  const numPart = m[2]?.trim();
  return numPart ? { bookPart, numPart } : { bookPart };
}

function resolveBook(parsers: PickerParsers, bookPart: string): { book: number; fuzzy: boolean } | undefined {
  for (const p of parsers.all) {
    const n = p.getBookNumber(bookPart);
    if (n !== undefined) return { book: n, fuzzy: false };
  }
  const f = parsers.primary.getBookNumberFuzzy(bookPart); // fuzzy is Latin-oriented: locale parser only
  return f ? { book: f.bookNumber, fuzzy: f.fuzzy } : undefined;
}

/** Parse typed text (book plus numbers) into a `ReferenceValue`; never throws. */
export function parseReferenceInput(
  text: string,
  locale = 'en',
  opts: ReferenceInputOptions = {},
): ParseReferenceInputResult {
  const split = splitReferenceInput(text);
  if (!split || !split.numPart) return { ok: false };
  const parsers = getPickerParsers(locale);
  const found = resolveBook(parsers, split.bookPart);
  if (!found) return { ok: false };
  const { book, fuzzy } = found;

  const m = NUMBERS.exec(split.numPart);
  if (!m) return { ok: false };
  const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));
  let c = Number(m[1]);
  let v = num(m[2]);
  const d = num(m[3]);
  const w = num(m[4]);

  if (isSingleChapterBook(book) && v === undefined && d === undefined) {
    // "Jude 5" and "Jude 5-7" are verses of chapter 1, mirroring ReferenceParser.
    v = c;
    c = 1;
  }

  const maxChapter = MAX_CHAPTERS[book] as number | undefined;
  if (!maxChapter || c < 1 || c > maxChapter) return { ok: false };

  const parsed: ParsedReference = { isValid: true, book, chapter: c, originalText: text };

  if (v === undefined) {
    // "John 3". A chapter range ("3-5", "3-4:2") is rejected in v1.
    if (w !== undefined || d !== undefined) return { ok: false };
    if (opts.noWholeChapter) return { ok: false };
    const value: ReferenceValue = {
      verseId: VerseIdHelper.calculate(book, c, 1),
      ref: parsers.primary.format(parsed),
      wholeChapter: true,
    };
    return { ok: true, value, book, fuzzy };
  }

  if (v < 1) return { ok: false };
  parsed.verse = v;
  let endVerseId: number | undefined;

  if (w !== undefined) {
    if (opts.noRanges || w < 1) return { ok: false };
    const endChapter = d ?? c;
    if (endChapter < c || endChapter > maxChapter) return { ok: false };
    if (endChapter === c && w < v) return { ok: false };
    if (!(endChapter === c && w === v)) {
      parsed.endVerse = w;
      if (endChapter !== c) parsed.endChapter = endChapter;
      endVerseId = VerseIdHelper.calculate(book, endChapter, w);
    }
  }

  const value: ReferenceValue = { verseId: VerseIdHelper.calculate(book, c, v), ref: parsers.primary.format(parsed) };
  if (endVerseId !== undefined) value.endVerseId = endVerseId;
  return { ok: true, value, book, fuzzy };
}

const fold = (localizer: Localizer, s: string) =>
  localizer.toLocaleLowerCase(s).normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();

/**
 * Books whose name starts with, or has a word starting with, the typed text; at most `max`.
 * Rank 0: display name starts with it; rank 1: an alias does; rank 2: a word inside the display name does.
 * Within a rank, canonical book order. Empty input, or input with a numeric part, gives no suggestions.
 */
export function suggestBooks(text: string, locale = 'en', max = 8): BookSuggestion[] {
  const split = splitReferenceInput(text);
  if (!split || split.numPart || max <= 0) return [];
  const parsers = getPickerParsers(locale);
  const q = fold(parsers.localizer, split.bookPart);
  if (!q) return [];

  const rankOf = new Map<number, number>();
  const note = (book: number, rank: number) => {
    const prev = rankOf.get(book);
    if (prev === undefined || rank < prev) rankOf.set(book, rank);
  };
  parsers.displayNames.forEach((name, i) => {
    const f = fold(parsers.localizer, name);
    if (f.startsWith(q)) note(i + 1, 0);
    else if (f.split(' ').some((word) => word.startsWith(q))) note(i + 1, 2);
  });
  for (const [key, book] of parsers.aliasKeys) {
    if (fold(parsers.localizer, key).startsWith(q)) note(book, 1);
  }

  return [...rankOf.entries()]
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .slice(0, max)
    .map(([book]) => ({ book, name: parsers.displayNames[book - 1] ?? `Book ${book}` }));
}
