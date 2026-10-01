/**
 * Reference Parser
 *
 * Parses Bible references from text strings.
 * Supports various formats:
 * - "John 3:16" (single verse)
 * - "John 3:16-17" (verse range in same chapter)
 * - "John 3:16-4:2" (verse range across chapters)
 * - "John 3" (entire chapter)
 * - "John 3-5" (chapter range)
 * - "1 John 3:16" (numbered books)
 * - "Gen 1:1" (abbreviated names)
 * - "Genesis 1:1" (full names)
 * - "John 3:16, 17" (comma-separated verses)
 *
 * Since task 0077 this class is an adapter over the multilingual
 * {@link ReferenceEngine} (`../Reference`): any script, accents, CJK without
 * spaces, full-width and non-Latin digits, per-locale separators. Its public
 * API and its English results are unchanged, including two legacy shapes
 * kept for existing callers: `parse()` reads "John 3-5" as chapter 3 with
 * `endVerse` 5, and takes a single reference (no "3:16, 18" lists). New code
 * should use the engine directly (`referenceEngineFor(locale)`), which returns
 * proper chapter ranges and lists.
 */

export interface ParsedReference {
  isValid: boolean;
  book?: number;           // Book number (1-66)
  bookName?: string;       // Book name as entered
  chapter?: number;        // Starting chapter
  verse?: number;          // Starting verse
  endChapter?: number;     // Ending chapter (for ranges)
  endVerse?: number;       // Ending verse (for ranges)
  originalText: string;    // Original reference text
  fuzzyMatch?: boolean;    // True if book name was fuzzy-matched (typo corrected)
  correctedBookName?: string; // The matched book name when fuzzy-matched
  /**
   * The reference names a book and nothing else ("John"), so it covers every
   * chapter. `chapter` is 1 and `verse`/`endChapter`/`endVerse` are absent -
   * the end is "wherever the book ends", which this parser has no chapter
   * counts to state. Only ever set when {@link ReferenceParseOptions.allowWholeBook}
   * is passed.
   */
  wholeBook?: boolean;
}

/**
 * Per-call parsing options.
 *
 * Separate from {@link ReferenceParserConfig}, which configures a parser
 * instance's book-name tables. These change what *counts* as a reference, and
 * so must be decided by each caller rather than shared.
 */
export interface ReferenceParseOptions {
  /**
   * Accept a bare book name - "John", "I John", "Gen" - as a reference to the
   * whole book.
   *
   * Off by default, and it must stay that way for the search box: "John" typed
   * there is someone looking for the word *John*, and "love" fuzzy-matches a
   * book name (see ReferenceClassifier). Callers that have no keyword mode to
   * be confused with - the copy/export dialog, which only ever takes a
   * reference - opt in.
   *
   * Whole-book matching is deliberately **exact**: no fuzzy fallback, or every
   * mistyped word in the box would resolve to some book.
   */
  allowWholeBook?: boolean;
}

/**
 * Interface for reference parsing.
 * Implementations handle language-specific book name resolution and formatting.
 * Latin-script languages can reuse ReferenceParser with different book name tables;
 * languages with fundamentally different syntax should provide a full implementation.
 */
export interface IReferenceParser {
  isReference(text: string, options?: ReferenceParseOptions): boolean;
  parse(text: string, options?: ReferenceParseOptions): ParsedReference;
  getBookNumber(bookName: string): number | undefined;
  getBookNumberFuzzy(bookName: string): { bookNumber: number; matchedName: string; fuzzy: boolean } | undefined;
  getBookName(bookNumber: number): string;
  validate(ref: ParsedReference): string | undefined;
  format(ref: ParsedReference): string;
  extractReferences(text: string): ParsedReference[];
  scanText(text: string): Array<ParsedReference & { start: number; end: number }>;
}

/**
 * Configuration for ReferenceParser.
 * All fields are optional - English defaults are used when omitted.
 */
export interface ReferenceParserConfig {
  /** Map of lowercase book name/abbreviation -> book number (1-66). */
  bookNames?: Map<string, number>;
  /** Display names indexed by (bookNumber - 1). Length should be 66. */
  displayNames?: string[];
  /** Book numbers that have only one chapter (e.g., Obadiah, Philemon, Jude). */
  singleChapterBooks?: Set<number>;
  /**
   * Reference-engine locale (data tag such as "es" or "zh-Hans") these tables
   * came from. When set, the parser uses that locale's full data - folding,
   * separators, ordinals, formatting - and English as a second input
   * language; `bookNames` is then informational only.
   */
  locale?: string;
}

// ============================================================================
// English Defaults
// ============================================================================
//
// The tables themselves live in Data/Core/BookNames.ts, which is the single
// source of truth for the repo. They are re-exported here so that the many
// existing `import { ENGLISH_BOOK_NAMES } from '.../ReferenceParser'` call
// sites keep working unchanged.

export {
  ENGLISH_SINGLE_CHAPTER_BOOKS,
  ENGLISH_DISPLAY_NAMES,
  ENGLISH_BOOK_NAMES,
} from '../Data/Core/BookNames';

import {
  ENGLISH_DISPLAY_NAMES,
  ENGLISH_BOOK_NAMES,
} from '../Data/Core/BookNames';
import { ReferenceEngine } from '../Reference/engine';
import type { ReferenceLocaleData, ReferenceRange } from '../Reference/types';

/** The legacy loose shape test: "<book> <chapter>[:<verse>][-[<chapter>:]<verse>]", any script. */
const LOOSE_REFERENCE = /^((?:[123]|i{1,3})?\s*[\p{L}\p{M}]+)\s+(\d+)(?::(\d+))?(?:\s*-\s*(?:(\d+):)?(\d+))?$/iu;

let inlineCounter = 0;

/** Locale data for a caller-supplied table (CLI aliases, tests): exactly its keys, nothing generated. */
function inlineLocale(config: ReferenceParserConfig): ReferenceLocaleData {
  const books: Record<string, { long?: string; aliases: string[] }> = {};
  for (const [name, book] of config.bookNames ?? ENGLISH_BOOK_NAMES) (books[String(book)] ??= { aliases: [] }).aliases.push(name);
  const display = config.displayNames ?? ENGLISH_DISPLAY_NAMES;
  display.forEach((name, i) => {
    if (books[String(i + 1)]) books[String(i + 1)].long = name;
  });
  return { tag: `custom-${++inlineCounter}`, books, ordinals: {} };
}

export class ReferenceParser implements IReferenceParser {
  private readonly bookNames: Map<string, number>;
  private readonly displayNames: string[];
  private readonly locale?: string;
  private readonly customDisplay: boolean;
  private inlineEngine?: ReferenceEngine;

  constructor(config?: ReferenceParserConfig) {
    this.bookNames = config?.bookNames ?? ENGLISH_BOOK_NAMES;
    this.displayNames = config?.displayNames ?? ENGLISH_DISPLAY_NAMES;
    this.customDisplay = !config?.locale && this.displayNames !== ENGLISH_DISPLAY_NAMES;
    if (config?.locale) this.locale = config.locale;
    else if (this.bookNames === ENGLISH_BOOK_NAMES) this.locale = 'en';
    else this.inlineEngine = ReferenceEngine.create({ locales: [], inline: [inlineLocale(config!)] });
  }

  /** The engine behind this parser (rebuilt by the engine cache when locale data loads). */
  get engine(): ReferenceEngine {
    if (this.inlineEngine) return this.inlineEngine;
    return ReferenceEngine.create({ locales: this.locale === 'en' ? ['en'] : [this.locale!, 'en'] });
  }

  /**
   * Check if the given text looks like a Bible reference: the loose
   * "<word> <number>[:<number>]" shape (any script), or anything the engine
   * parses ("约翰福音3:16"). Does not validate that the book exists -- use
   * {@link parse} followed by {@link validate} for that.
   */
  isReference(text: string, options?: ReferenceParseOptions): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (LOOSE_REFERENCE.test(trimmed)) return true;
    return this.parse(trimmed, options).isValid;
  }

  /**
   * Parse one Bible reference: numbered books ("1 John", "II Cor", "Primera de
   * Corintios"), abbreviations, any language this parser's locale knows plus
   * English, single-chapter books ("Jude 5" -> 1:5), ranges. Exact names
   * first, then a unique prefix ("Deuter"), then typo correction
   * (Damerau-Levenshtein <= 2), which sets `fuzzyMatch`.
   */
  parse(text: string, options?: ReferenceParseOptions): ParsedReference {
    const originalText = text.trim();
    const r = this.engine.parse(originalText, {
      allowWholeBook: options?.allowWholeBook === true,
      fuzzy: true,
      lists: false,
    });
    if (!r.ok) return { isValid: false, originalText };
    const range = r.ranges[0];
    if (range.wholeBook) {
      return { isValid: true, book: r.book, bookName: r.matched, chapter: 1, wholeBook: true, originalText };
    }
    const corrected = r.via === 'fuzzy' || r.via === 'prefix';
    return {
      isValid: true,
      book: r.book,
      bookName: r.matched,
      ...ReferenceParser.toLegacy(range),
      originalText,
      fuzzyMatch: corrected || undefined,
      correctedBookName: corrected ? this.getBookName(r.book) : undefined,
    };
  }

  /** Engine range -> the legacy ParsedReference fields ("3-5" keeps its old endVerse reading). */
  private static toLegacy(range: ReferenceRange): Pick<ParsedReference, 'chapter' | 'verse' | 'endChapter' | 'endVerse'> {
    const out: Pick<ParsedReference, 'chapter' | 'verse' | 'endChapter' | 'endVerse'> = { chapter: range.chapter };
    if (range.verse === undefined) {
      if (range.endChapter !== undefined) out.endVerse = range.endChapter;
      return out;
    }
    out.verse = range.verse;
    if (range.endChapter !== undefined) out.endChapter = range.endChapter;
    if (range.endVerse !== undefined) out.endVerse = range.endVerse;
    return out;
  }

  /**
   * Look up a book number (1-66) from a book name or abbreviation: exact,
   * case-, accent- and spacing-insensitive. No prefix or fuzzy fallback.
   */
  getBookNumber(bookName: string): number | undefined {
    return this.engine.lookupBook(bookName)?.book;
  }

  /**
   * Look up a book number with fuzzy fallback: exact first, then the closest
   * name by Damerau-Levenshtein distance (at most 2, and less than half the
   * input length; names of two characters or fewer are never fuzzy targets).
   */
  getBookNumberFuzzy(bookName: string): { bookNumber: number; matchedName: string; fuzzy: boolean } | undefined {
    const normalized = bookName.toLowerCase().trim();
    const hit = this.engine.lookupBook(bookName, { fuzzy: true });
    if (!hit) return undefined;
    return { bookNumber: hit.book, matchedName: hit.via === 'exact' ? normalized : hit.name, fuzzy: hit.via !== 'exact' };
  }

  /**
   * Validate a parsed reference for logical correctness.
   *
   * Checks that the book number is 1-66, chapter/verse are positive,
   * and range endpoints are ordered correctly (end >= start).
   * Does NOT verify that the chapter or verse actually exists in the book.
   */
  validate(ref: ParsedReference): string | undefined {
    if (!ref.isValid) {
      return 'Invalid reference format';
    }

    if (!ref.book || ref.book < 1 || ref.book > 66) {
      return 'Invalid book number';
    }

    if (!ref.chapter || ref.chapter < 1) {
      return 'Invalid chapter number';
    }

    if (ref.verse !== undefined && ref.verse < 1) {
      return 'Invalid verse number';
    }

    if (ref.endChapter !== undefined && ref.endChapter < ref.chapter) {
      return 'End chapter must be after start chapter';
    }

    if (ref.endVerse !== undefined && ref.verse !== undefined && !ref.endChapter && ref.endVerse < ref.verse) {
      return 'End verse must be after start verse';
    }

    return undefined; // Valid
  }

  /**
   * Format a parsed reference in this parser's locale ("John 3:16-4:2",
   * "约翰福音3:16"). Falls back to the original text if the reference is
   * invalid. A legacy "3-5" (chapter 3, endVerse 5) formats as "John 3".
   */
  format(ref: ParsedReference): string {
    if (!ref.isValid || !ref.book || !ref.chapter) {
      return ref.originalText;
    }
    const bookName = this.getBookName(ref.book);
    if (ref.wholeBook) return bookName;
    const range: ReferenceRange = { book: ref.book, chapter: ref.chapter };
    if (ref.verse !== undefined) {
      range.verse = ref.verse;
      if (ref.endVerse !== undefined) {
        range.endVerse = ref.endVerse;
        if (ref.endChapter !== undefined) range.endChapter = ref.endChapter;
      }
    } else if (ref.endChapter !== undefined) {
      range.endChapter = ref.endChapter;
    }
    return this.engine
      .formatParts(range, { digits: 'latin' })
      .map((p) => (p.type === 'book' ? bookName : p.value))
      .join('');
  }

  /**
   * The display name of a book (1=Genesis, 66=Revelation) in this parser's
   * locale, or "Book N" if the number is out of range.
   */
  getBookName(bookNumber: number): string {
    if (bookNumber < 1 || bookNumber > 66 || !Number.isInteger(bookNumber)) return `Book ${bookNumber}`;
    if (this.customDisplay || !this.locale) return this.displayNames[bookNumber - 1] || `Book ${bookNumber}`;
    return this.engine.bookName(bookNumber);
  }

  /**
   * Extract all Bible references from a text string.
   *
   * Splits the input on commas and semicolons, then attempts to parse each
   * segment as a reference. Only returns segments that parse as valid references.
   * For finding references embedded in running prose, use {@link scanText} instead.
   */
  extractReferences(text: string): ParsedReference[] {
    const references: ParsedReference[] = [];
    for (const segment of text.split(/[,;，；、]/)) {
      if (this.isReference(segment)) {
        const ref = this.parse(segment);
        if (ref.isValid) {
          references.push(ref);
        }
      }
    }
    return references;
  }

  /**
   * Scan running text for Bible references and return their positions
   * (offsets into `text`), for decorations, links and highlights.
   *
   * Exact book names only (no fuzzy or prefix matching, so "Task 1" never
   * becomes a book); in scripts with case the name must be capitalised; a
   * two-letter abbreviation needs a chapter and verse. "John 3:16, 17"
   * produces two references (John 3:16 and John 3:17, the second spanning
   * ", 17").
   */
  scanText(text: string): Array<ParsedReference & { start: number; end: number }> {
    const results: Array<ParsedReference & { start: number; end: number }> = [];
    let bookName: string | undefined;
    for (const m of this.engine.scan(text)) {
      if (!m.continuation) bookName = m.text.replace(/[\s.]*\d[\s\S]*$/u, '').trim() || m.text;
      results.push({
        isValid: true,
        book: m.book,
        bookName,
        ...ReferenceParser.toLegacy(m),
        originalText: m.text.trim(),
        start: m.start,
        end: m.end,
      });
    }
    return results;
  }
}
