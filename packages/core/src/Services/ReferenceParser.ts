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
 * Language-configurable: the constructor accepts optional book name tables and
 * display names. English defaults are exported as constants so other Latin-script
 * languages can provide their own tables while reusing the parsing logic.
 * Languages with fundamentally different reference syntax (e.g., CJK) can implement
 * the IReferenceParser interface directly.
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
  ENGLISH_SINGLE_CHAPTER_BOOKS,
  ENGLISH_DISPLAY_NAMES,
  ENGLISH_BOOK_NAMES,
} from '../Data/Core/BookNames';

export class ReferenceParser implements IReferenceParser {
  private readonly singleChapterBooks: Set<number>;
  private readonly bookNames: Map<string, number>;
  private readonly displayNames: string[];

  constructor(config?: ReferenceParserConfig) {
    this.bookNames = config?.bookNames ?? ENGLISH_BOOK_NAMES;
    this.displayNames = config?.displayNames ?? ENGLISH_DISPLAY_NAMES;
    this.singleChapterBooks = config?.singleChapterBooks ?? ENGLISH_SINGLE_CHAPTER_BOOKS;
  }

  /**
   * Check if the given text looks like a Bible reference.
   *
   * Tests against a pattern matching formats like "John 3:16", "1 John 3:16",
   * "Gen 1:1-5", "Psalm 23". Does not validate that the book, chapter, or
   * verse actually exist -- use {@link parse} followed by {@link validate}
   * for full validation.
   *
   * @param text - The text string to test
   * @returns true if the text matches a Bible reference pattern
   *
   * @example
   * ```typescript
   * const parser = new ReferenceParser();
   * parser.isReference("John 3:16");    // true
   * parser.isReference("Hello world");  // false
   * parser.isReference("1 Cor 13:4-7"); // true
   * ```
   */
  isReference(text: string, options?: ReferenceParseOptions): boolean {
    const trimmed = text.trim();

    // Pattern: [Number or Roman Numeral] BookName [Number][:Number][-Number[:Number]]
    // Examples: "John 3:16", "1 John 3:16", "i cor 1:2", "Gen 1:1-5", "Psalm 23"
    // Supports: 1, 2, 3 (digits) OR i, ii, iii (Roman numerals, case-insensitive)
    const pattern = /^((?:[123]|i{1,3})?\s*[a-z]+)\s+(\d+)(?::(\d+))?(?:\s*-\s*(?:(\d+):)?(\d+))?$/i;

    if (pattern.test(trimmed)) return true;
    return options?.allowWholeBook === true && this.matchWholeBook(trimmed) !== undefined;
  }

  /**
   * The book number a bare book name refers to, or undefined if the text is
   * not one.
   *
   * Exact lookup only - see {@link ReferenceParseOptions.allowWholeBook}.
   */
  private matchWholeBook(trimmed: string): number | undefined {
    // Letters, spaces and periods only, optionally after a 1/2/3 or i/ii/iii
    // prefix. Anything with a digit in the body is a chapter or verse the main
    // pattern already had its chance at, and rejected.
    if (!/^(?:[123]|i{1,3}\s)?\s*[a-z][a-z.\s]*$/i.test(trimmed)) return undefined;
    return this.getBookNumber(trimmed);
  }

  /**
   * Parse a Bible reference string into its component parts.
   *
   * Handles numbered books ("1 John"), Roman numeral prefixes ("II Cor"),
   * abbreviations ("Gen"), full names ("Genesis"), single-chapter books
   * ("Jude 5" -> chapter 1, verse 5), and verse ranges ("John 3:16-18").
   *
   * Uses exact book name matching first, then falls back to fuzzy matching
   * (Damerau-Levenshtein distance <= 2) to handle typos like "Jonh" -> "John".
   *
   * @param text - The reference string to parse (e.g., "John 3:16", "Gen 1:1-5")
   * @returns A {@link ParsedReference} with isValid=true on success, or isValid=false
   *          if the text cannot be parsed as a Bible reference
   *
   * @example
   * ```typescript
   * const parser = new ReferenceParser();
   * const ref = parser.parse("John 3:16");
   * // { isValid: true, book: 43, chapter: 3, verse: 16, ... }
   *
   * const range = parser.parse("Romans 8:28-30");
   * // { isValid: true, book: 45, chapter: 8, verse: 28, endVerse: 30, ... }
   *
   * const typo = parser.parse("Jonh 3:16");
   * // { isValid: true, book: 43, fuzzyMatch: true, correctedBookName: "john", ... }
   * ```
   */
  parse(text: string, options?: ReferenceParseOptions): ParsedReference {
    const trimmed = text.trim();
    const originalText = trimmed;

    // Try to match the pattern
    // Supports: 1, 2, 3 (digits) OR i, ii, iii (Roman numerals, case-insensitive)
    const pattern = /^((?:[123]|i{1,3})?\s*[a-z]+)\s+(\d+)(?::(\d+))?(?:\s*-\s*(?:(\d+):)?(\d+))?$/i;
    const match = pattern.exec(trimmed);

    if (!match) {
      // A bare book name has no chapter, so it never matches the pattern above.
      // Only a caller that asked for whole books gets one.
      if (options?.allowWholeBook) {
        const bookNumber = this.matchWholeBook(trimmed);
        if (bookNumber !== undefined) {
          return {
            isValid: true,
            book: bookNumber,
            bookName: trimmed,
            chapter: 1,
            wholeBook: true,
            originalText,
          };
        }
      }
      return { isValid: false, originalText };
    }

    // Extract components
    const bookName = match[1].trim();
    let chapter = parseInt(match[2]);
    let verse = match[3] ? parseInt(match[3]) : undefined;
    let endChapter = match[4] ? parseInt(match[4]) : undefined;
    let endVerse = match[5] ? parseInt(match[5]) : undefined;

    // Look up book number (exact first, then fuzzy)
    const fuzzyResult = this.getBookNumberFuzzy(bookName);
    if (!fuzzyResult) {
      return { isValid: false, originalText };
    }

    // For single-chapter books (e.g. Jude, Obadiah, Philemon, 2 John, 3 John),
    // "Jude 5" means verse 5, not chapter 5. Reinterpret when no verse is specified.
    if (this.singleChapterBooks.has(fuzzyResult.bookNumber) && verse === undefined) {
      // "Jude 5" -> chapter 1, verse 5; "Jude 5-8" -> chapter 1, verses 5-8
      verse = chapter;
      endVerse = endVerse; // preserve range end if present (e.g. "Jude 5-8")
      endChapter = undefined; // no cross-chapter range for single-chapter books
      chapter = 1;
    }

    return {
      isValid: true,
      book: fuzzyResult.bookNumber,
      bookName,
      chapter,
      verse,
      endChapter,
      endVerse,
      originalText,
      fuzzyMatch: fuzzyResult.fuzzy || undefined,
      correctedBookName: fuzzyResult.fuzzy ? this.getBookName(fuzzyResult.bookNumber) : undefined,
    };
  }

  /**
   * Look up a book number (1-66) from a book name or abbreviation.
   * Performs exact, case-insensitive matching only -- no fuzzy fallback.
   *
   * @param bookName - Full name or abbreviation (e.g., "Genesis", "gen", "Gn")
   * @returns The book number (1-66), or undefined if no exact match is found
   */
  getBookNumber(bookName: string): number | undefined {
    const normalized = bookName.toLowerCase().trim();
    return this.bookNames.get(normalized);
  }

  /**
   * Look up a book number with fuzzy matching fallback.
   *
   * Tries exact match first, then falls back to Damerau-Levenshtein distance
   * matching (max distance 2, and less than half the input length). Skips
   * very short keys (<=2 chars) during fuzzy matching to avoid ambiguity.
   * Tiebreakers: character overlap, then length similarity.
   *
   * @param bookName - Full name or abbreviation to look up
   * @returns The book number, matched name, and whether fuzzy matching was used,
   *          or undefined if no match could be found
   */
  getBookNumberFuzzy(bookName: string): { bookNumber: number; matchedName: string; fuzzy: boolean } | undefined {
    const normalized = bookName.toLowerCase().trim();

    // Try exact match first
    const exact = this.bookNames.get(normalized);
    if (exact !== undefined) {
      return { bookNumber: exact, matchedName: normalized, fuzzy: false };
    }

    // Fuzzy match: find the closest book name by Levenshtein distance
    let bestMatch: string | undefined;
    let bestDistance = Infinity;
    let bestOverlap = -1;
    let bestLenDiff = Infinity;
    let bestBookNumber = 0;

    for (const [key, bookNum] of this.bookNames) {
      // Skip very short keys (2 chars) for fuzzy matching - too ambiguous
      if (key.length <= 2) continue;

      const distance = ReferenceParser.levenshteinDistance(normalized, key);

      // Threshold: distance must be <= 2 AND less than half the input length
      // This prevents short inputs from matching everything
      const maxDistance = Math.min(2, Math.floor(normalized.length / 2));
      if (distance > maxDistance) continue;

      // Tiebreakers: 1) more character overlap, 2) closer length to input
      const overlap = ReferenceParser.characterOverlap(normalized, key);
      const lenDiff = Math.abs(normalized.length - key.length);

      const isBetter =
        distance < bestDistance ||
        (distance === bestDistance && overlap > bestOverlap) ||
        (distance === bestDistance && overlap === bestOverlap && lenDiff < bestLenDiff);

      if (isBetter) {
        bestDistance = distance;
        bestOverlap = overlap;
        bestLenDiff = lenDiff;
        bestMatch = key;
        bestBookNumber = bookNum;
      }
    }

    if (bestMatch !== undefined) {
      return { bookNumber: bestBookNumber, matchedName: bestMatch, fuzzy: true };
    }

    return undefined;
  }

  /**
   * Calculate Damerau-Levenshtein distance between two strings.
   * Counts insertions, deletions, substitutions, and transpositions of adjacent
   * characters each as a single edit - important for typos like "jonh" -> "john".
   */
  private static levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    // Full matrix needed for transposition lookback
    const d: number[][] = [];
    for (let i = 0; i <= m; i++) {
      d[i] = new Array<number>(n + 1);
      d[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
      d[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(
          d[i - 1][j] + 1,        // deletion
          d[i][j - 1] + 1,        // insertion
          d[i - 1][j - 1] + cost  // substitution
        );
        // Transposition
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }

    return d[m][n];
  }

  /**
   * Count shared characters between two strings (multiset intersection).
   * Used as a tiebreaker when Levenshtein distances are equal.
   * "jonh" vs "john" = 4 (all chars shared), "jonh" vs "josh" = 3 (j,o,h shared).
   */
  private static characterOverlap(a: string, b: string): number {
    const countA = new Map<string, number>();
    for (const ch of a) {
      countA.set(ch, (countA.get(ch) ?? 0) + 1);
    }

    let overlap = 0;
    for (const ch of b) {
      const remaining = countA.get(ch) ?? 0;
      if (remaining > 0) {
        overlap++;
        countA.set(ch, remaining - 1);
      }
    }
    return overlap;
  }

  /**
   * Validate a parsed reference for logical correctness.
   *
   * Checks that the book number is 1-66, chapter/verse are positive,
   * and range endpoints are ordered correctly (end >= start).
   * Does NOT verify that the chapter or verse actually exists in the book.
   *
   * @param ref - A previously parsed reference from {@link parse}
   * @returns An error message string if invalid, or undefined if valid
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
   * Format a parsed reference as a canonical human-readable string.
   *
   * Produces standard forms like "John 3:16", "Romans 8:28-30",
   * or "John 3:16-4:2" for cross-chapter ranges. Falls back to
   * the original text if the reference is invalid.
   *
   * @param ref - A previously parsed reference from {@link parse}
   * @returns A formatted reference string (e.g., "John 3:16")
   */
  format(ref: ParsedReference): string {
    if (!ref.isValid || !ref.book || !ref.chapter) {
      return ref.originalText;
    }

    const bookName = this.getBookName(ref.book);
    // A whole book is named by the book alone - "John", not "John 1".
    if (ref.wholeBook) return bookName;
    let formatted = `${bookName} ${ref.chapter}`;

    if (ref.verse !== undefined) {
      formatted += `:${ref.verse}`;

      if (ref.endVerse !== undefined) {
        if (ref.endChapter !== undefined) {
          formatted += `-${ref.endChapter}:${ref.endVerse}`;
        } else {
          formatted += `-${ref.endVerse}`;
        }
      }
    } else if (ref.endChapter !== undefined) {
      formatted += `-${ref.endChapter}`;
    }

    return formatted;
  }

  /**
   * Get the full canonical book name from a book number.
   *
   * @param bookNumber - The book number (1=Genesis, 66=Revelation)
   * @returns The full book name (e.g., "Genesis", "1 Corinthians"), or
   *          "Book N" if the number is out of range
   */
  getBookName(bookNumber: number): string {
    return this.displayNames[bookNumber - 1] || `Book ${bookNumber}`;
  }

  /**
   * Extract all Bible references from a text string.
   *
   * Splits the input on commas and semicolons, then attempts to parse each
   * segment as a reference. Only returns segments that parse as valid references.
   * For finding references embedded in running prose, use {@link scanText} instead.
   *
   * @param text - Text potentially containing multiple references separated by commas/semicolons
   * @returns Array of valid parsed references found in the text
   *
   * @example
   * ```typescript
   * const parser = new ReferenceParser();
   * const refs = parser.extractReferences("John 3:16; Romans 8:28");
   * // Returns two ParsedReference objects
   * ```
   */
  extractReferences(text: string): ParsedReference[] {
    const references: ParsedReference[] = [];

    // Split by common delimiters and try to parse each segment
    const segments = text.split(/[,;]/);

    for (const segment of segments) {
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
   * Scan running text for Bible references and return their positions.
   * Unlike extractReferences() which expects pre-segmented input,
   * this method finds references embedded in sentences.
   *
   * Returns matches with start/end character offsets so callers can
   * create decorations, links, or highlights in editors.
   *
   * Only exact book name matches are used (no fuzzy matching) to avoid
   * false positives like "Task 1" matching a Bible book name.
   *
   * Supports comma-separated verses: "John 3:16, 17" produces two
   * references (John 3:16 and John 3:17).
   */
  scanText(text: string): Array<ParsedReference & { start: number; end: number }> {
    const results: Array<ParsedReference & { start: number; end: number }> = [];

    // Regex that matches potential Bible references in running text.
    // Captures: optional prefix (1/2/3/I/II/III) + book name + chapter[:verse][-[chapter:]verse]
    const pattern = /\b((?:[123]|I{1,3}|i{1,3})\s+)?([A-Z][a-z]+(?:\s+of\s+[A-Z][a-z]+)?)\s+(\d+)(?::(\d+))?(?:\s*[-\u2013]\s*(?:(\d+):)?(\d+))?\b/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const fullMatch = match[0];
      const candidate = fullMatch.trim();
      const ref = this.parse(candidate);
      // For auto-detection in running text, only accept exact book name matches.
      // Fuzzy matching causes false positives (e.g. "Task 1" matching a book name).
      if (!(ref.isValid && !ref.fuzzyMatch && !this.validate(ref))) {
        // Rejected. Resume one character past where this attempt STARTED, not
        // past where it ended.
        //
        // The `[A-Z][a-z]+\s+\d+` part of the pattern happily matches an
        // ordinary capitalised word followed by a number, and a numbered book's
        // prefix is exactly such a number. In "See 1 John 3:16" the regex first
        // consumes "See 1"; continuing from `lastIndex` would then start at
        // " John 3:16" and lose the "1", silently detecting *John* 3:16. "Read
        // 2 Timothy 1:7" fared worse and matched nothing at all, because
        // "Timothy" alone is not a book name.
        //
        // Backing up to `match.index + 1` lets the scan find the real reference
        // that started inside the rejected span. lastIndex still increases
        // strictly on every iteration (exec only returns matches at or after
        // lastIndex), so this cannot loop forever.
        pattern.lastIndex = match.index + 1;
        continue;
      }
      {
        const mainEnd = match.index + fullMatch.length;
        results.push({
          ...ref,
          start: match.index,
          end: mainEnd,
        });

        // Look ahead for comma-separated verses: "John 3:16, 17" -> also John 3:17
        if (ref.verse !== undefined && ref.chapter !== undefined && ref.book !== undefined) {
          const commaPattern = /^,\s*(\d+)/g;
          let remaining = text.substring(mainEnd);
          let offset = mainEnd;
          let commaMatch: RegExpExecArray | null;
          while ((commaMatch = commaPattern.exec(remaining)) !== null) {
            const extraVerse = parseInt(commaMatch[1]);
            results.push({
              isValid: true,
              book: ref.book,
              bookName: ref.bookName,
              chapter: ref.chapter,
              verse: extraVerse,
              originalText: commaMatch[0].trim(),
              start: offset + commaMatch.index,
              end: offset + commaMatch.index + commaMatch[0].length,
            });
            // Advance past this comma+number and try for another
            const consumed = commaMatch.index + commaMatch[0].length;
            remaining = remaining.substring(consumed);
            offset += consumed;
            commaPattern.lastIndex = 0;
          }
          // Advance the main pattern past any comma-separated verses we consumed
          if (offset > mainEnd) {
            pattern.lastIndex = offset;
          }
        }
      }
    }

    return results;
  }
}
