/**
 * Types for the multilingual reference engine (task 0077).
 *
 * This folder (`src/Reference/`) is self-contained on purpose: nothing in it
 * imports from the rest of core, so it can be lifted into a standalone package
 * later without code changes. Core re-exports it from `index.ts` and
 * `browser.ts`.
 */

/** Book number in the 66-book Protestant canon, 1 (Genesis) .. 66 (Revelation). */
export type RefBook = number;

/** Maturity of a locale file, matching the UI catalogs' draft / beta / complete tiers. */
export type ReferenceLocaleStatus = 'draft' | 'beta' | 'complete';

/** One book's names in one locale. Every string is display text; matching folds it. */
export interface ReferenceBookData {
  /** Full name, e.g. "1 Corinthians", "约翰福音", "يوحنا". Required unless inherited. */
  long?: string;
  /** Standard abbreviation, e.g. "1 Cor". Falls back to `long`. */
  medium?: string;
  /** Short abbreviation, e.g. "1Co", "约". Falls back to `medium`. */
  short?: string;
  /** More spellings accepted on input only. */
  aliases?: string[];
  /**
   * `false`: when scanning prose, the short form (and any alias of at most two
   * characters) only counts when followed by a full chapter and verse.
   * Short names are always treated this way; this flag extends it to `short`.
   */
  scanShort?: boolean;
}

/** How input text is matched against this locale's names. */
export interface ReferenceMatchData {
  /** Book and chapter may touch with no space, and no word boundary is needed (CJK). */
  spaceless?: boolean;
  /** Ignore combining marks (accents, harakat, niqqud) when matching. Default true. */
  foldMarks?: boolean;
  /** Minimum length of an auto-accepted unique prefix ("Deute"). 0 disables prefixes. Default 3. */
  minPrefix?: number;
  /** BCP 47 tag whose case rules fold input (Turkish dotted/dotless I). Default: the locale's tag. */
  caseLocale?: string;
}

/** Input separators. Every list *adds* to the inherited one only when the locale says so: a locale list replaces the parent's. */
export interface ReferenceSyntaxData {
  /** Between chapter and verse. Root default [":"]. German-style locales use [",", ":"]. */
  chapterVerse?: string[];
  /** Range dash. Root default ["-"] (all dash forms are normalised to "-" first). */
  range?: string[];
  /** Between list items. Root default [",", ";"]. */
  list?: string[];
  /** Written after a chapter number, e.g. ["章", "篇"]. */
  chapterSuffix?: string[];
  /** Written after a verse number, e.g. ["节", "節"]. */
  verseSuffix?: string[];
}

/** Output conventions. A locale inherits each field it leaves out. */
export interface ReferenceFormatData {
  /** Between the book name and the chapter. Root default " ". Chinese: "". */
  bookGap?: string;
  /** Between chapter and verse. Root default ":". */
  chapterVerse?: string;
  /** Range dash. Root default "-". */
  range?: string;
  /** Between references to different chapters or books. Root default "; ". */
  list?: string;
  /** Between verses of one chapter. Root default ", ". */
  verseList?: string;
  /** Default digits for chapter and verse numbers. Root default "latin". */
  digits?: 'latin' | 'native';
  /** Unicode numbering system used for `native` digits, e.g. "arab", "arabext", "deva". */
  numberingSystem?: string;
}

/**
 * One locale's reference data: the JSON file `Reference/locales/<tag>.json`.
 * This is the single book-name format for the repo (0079's codegen reads it).
 */
export interface ReferenceLocaleData {
  /** BCP 47 tag of this file, e.g. "es", "zh-Hans", "pt-BR", "ar-SA". */
  tag: string;
  /** Parent locale whose data this file extends, e.g. "ar" for "ar-SA". The root defaults always apply last. */
  extends?: string;
  /** English name, for maintainers. */
  name?: string;
  status?: ReferenceLocaleStatus;
  /** Where the names come from (edition, seed data, reviewer). */
  source?: string;
  direction?: 'ltr' | 'rtl';
  match?: ReferenceMatchData;
  /** Keyed by book number as a string, "1".."66". */
  books?: Record<string, ReferenceBookData>;
  /**
   * Words that may replace the leading digit of a numbered book's name:
   * `{ "1": ["I", "First"] }` makes "First Corinthians" and "I Corinthians"
   * parse wherever "1 Corinthians" does.
   */
  ordinals?: Record<string, string[]>;
  syntax?: ReferenceSyntaxData;
  /**
   * Abbreviations that could mean several books, folded (lower case, no
   * marks). `prefer` wins; `also` is reported as alternatives ("Did you mean").
   */
  ambiguous?: Record<string, { prefer: RefBook; also: RefBook[] }>;
  format?: ReferenceFormatData;
}

/** A contiguous passage. `verse`/`endVerse` absent means whole chapters. */
export interface ReferenceRange {
  book: RefBook;
  chapter: number;
  verse?: number;
  /** Set for a range that ends in another chapter ("3:16-4:2") or a chapter range ("3-5"). */
  endChapter?: number;
  /** Last verse of the range (in `endChapter` when set, else in `chapter`). */
  endVerse?: number;
  /** The reference names a whole book ("John"). `chapter` is then 1. */
  wholeBook?: boolean;
}

/** Per-call parse options. */
export interface EngineParseOptions {
  /** Accept a bare book name ("John") as the whole book. Exact names only. */
  allowWholeBook?: boolean;
  /** Bookless input ("3:16", "16-18") refers to this book (and, for a bare verse, chapter). */
  context?: { book: RefBook; chapter?: number };
  /** Typo correction (Damerau-Levenshtein ≤ 2) when nothing matched exactly. Default false. */
  fuzzy?: boolean;
  /** Accept a unique prefix of a book name ("Deuter"). Default true. */
  prefix?: boolean;
  /** Accept "3:16, 18; 4:1" lists (several ranges). Default true. */
  lists?: boolean;
  /** Reject chapters beyond the book's last chapter (KJV versification). Default false. */
  checkChapters?: boolean;
}

export type ReferenceParseFailure = 'empty' | 'no-book' | 'bad-numbers' | 'out-of-range';

export type ReferenceParseResult =
  | {
      ok: true;
      ranges: ReferenceRange[];
      book: RefBook;
      /** Locale whose name matched ("osis" for an OSIS id, "context" for bookless input). */
      locale: string;
      /** The book text as typed. */
      matched: string;
      /** How the book was found. */
      via: 'exact' | 'prefix' | 'fuzzy' | 'context';
      /** Other books the abbreviation could have meant ("Jo": Joshua, Job, ...). */
      alternatives?: RefBook[];
    }
  | { ok: false; reason: ReferenceParseFailure; book?: RefBook };

/** One passage found in prose. Offsets index the original (un-normalised) text. */
export interface ReferenceMatch extends ReferenceRange {
  start: number;
  end: number;
  text: string;
  locale: string;
  /** True for a list continuation (", 17" after "John 3:16"); its span starts at the separator. */
  continuation?: boolean;
}

export interface ReferenceScanOptions {
  /** Require an upper-case first letter for scripts that have case (default true), so "job 3" in prose is left alone. */
  requireCapital?: boolean;
}

export type BookNameStyle = 'long' | 'medium' | 'short';

export interface ReferenceFormatOptions {
  style?: BookNameStyle;
  /** Locale to format in. Default: the engine's first locale. */
  locale?: string;
  /** Override the locale's default digits. */
  digits?: 'latin' | 'native';
}

/** One piece of a formatted reference, for callers that style or isolate parts (bidi, 0076). */
export interface ReferenceFormatPart {
  type: 'book' | 'chapter' | 'verse' | 'separator';
  value: string;
}

export interface BookSuggestion {
  book: RefBook;
  /** Display name in the locale that matched. */
  label: string;
  locale: string;
}
