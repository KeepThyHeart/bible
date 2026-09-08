/**
 * Verse Reference Parser
 *
 * Parses Bible references in various formats:
 * - "John 3:16" - Single verse
 * - "John 3:16-17" - Verse range
 * - "John 3" - Entire chapter
 * - "John 3-5" - Chapter range
 * - "John 3:16-5:12" - Cross-chapter range
 * - "John" or "Jn" - Entire book
 */

import { ENGLISH_BOOK_NAMES, getBookName } from '@bible/core';

// Book name/abbreviation -> { number, name }, derived from core's canonical
// alias table - a strict superset with identical mappings, so this file does
// not keep its own copy.
//
// NOTE: only the TABLE is shared, not the parsing. This parser supports
// whole-book references ("John", "Jude") that core's parse() rejects, and
// core fuzzy-matches typos, which must not happen in the copy/export dialogs
// that call this.
const BOOK_MAPPINGS: Record<string, { number: number; name: string }> =
  Object.fromEntries(
    [...ENGLISH_BOOK_NAMES].map(([alias, number]) => [alias, { number, name: getBookName(number) }]),
  );

// Books with only one chapter
// For these books, "Jude 2" means "Jude 1:2", not "Jude chapter 2"
const SINGLE_CHAPTER_BOOKS = new Set([
  31, // Obadiah
  57, // Philemon
  63, // 2 John
  64, // 3 John
  65  // Jude
]);

export interface ParsedReference {
  book: number;
  bookName: string;
  startChapter?: number;
  startVerse?: number;
  endChapter?: number;
  endVerse?: number;
  isWholeBook: boolean;
  isWholeChapter: boolean;
  originalText: string;
}

/**
 * Parse a Bible reference string
 *
 * @param reference - Reference string (e.g., "John 3:16-17", "Jn 3", "John")
 * @returns Parsed reference object or null if invalid
 */
export function parseReference(reference: string): ParsedReference | null {
  const trimmed = reference.trim();
  if (!trimmed) return null;

  // Pattern: "Book" or "Book Chapter" or "Book Chapter:Verse" or "Book Chapter:Verse-EndVerse" or "Book Chapter:Verse-Chapter:EndVerse"
  // Supports Roman numerals (I, II, III) for numbered books
  const pattern = /^([I]{1,3}\s+[a-z]+|[123]?\s*[a-z]+)\s*(\d+)?(?::(\d+))?(?:-(\d+))?(?::(\d+))?$/i;
  const match = trimmed.match(pattern);

  if (!match) return null;

  // Extract book name/abbreviation
  const bookInput = match[1].toLowerCase().replace(/\s+/g, ' ').trim();
  const bookInfo = BOOK_MAPPINGS[bookInput];

  if (!bookInfo) return null;

  const chapter1Str = match[2];
  const verse1Str = match[3];
  const rangeStr = match[4]; // Could be end verse OR end chapter
  const verse2Str = match[5]; // End verse if chapter range

  // Case 1: Just book name ("John")
  if (!chapter1Str) {
    return {
      book: bookInfo.number,
      bookName: bookInfo.name,
      isWholeBook: true,
      isWholeChapter: false,
      originalText: reference
    };
  }

  const chapter1 = parseInt(chapter1Str, 10);

  // Case 2: Book and chapter only ("John 3")
  // Special handling for single-chapter books: "Jude 2" means "Jude 1:2"
  if (!verse1Str && !rangeStr) {
    // Check if this is a single-chapter book
    if (SINGLE_CHAPTER_BOOKS.has(bookInfo.number)) {
      // Interpret the number as a verse, not a chapter
      return {
        book: bookInfo.number,
        bookName: bookInfo.name,
        startChapter: 1,
        startVerse: chapter1,
        endChapter: 1,
        endVerse: chapter1,
        isWholeBook: false,
        isWholeChapter: false,
        originalText: reference
      };
    }

    // Normal multi-chapter book
    return {
      book: bookInfo.number,
      bookName: bookInfo.name,
      startChapter: chapter1,
      isWholeBook: false,
      isWholeChapter: true,
      originalText: reference
    };
  }

  // Case 3: Book, chapter, and verse ("John 3:16")
  if (verse1Str && !rangeStr) {
    const verse1 = parseInt(verse1Str, 10);
    return {
      book: bookInfo.number,
      bookName: bookInfo.name,
      startChapter: chapter1,
      startVerse: verse1,
      endChapter: chapter1,
      endVerse: verse1,
      isWholeBook: false,
      isWholeChapter: false,
      originalText: reference
    };
  }

  // Case 4: Verse range in same chapter ("John 3:16-17")
  if (verse1Str && rangeStr && !verse2Str) {
    const verse1 = parseInt(verse1Str, 10);
    const verse2 = parseInt(rangeStr, 10);
    return {
      book: bookInfo.number,
      bookName: bookInfo.name,
      startChapter: chapter1,
      startVerse: verse1,
      endChapter: chapter1,
      endVerse: verse2,
      isWholeBook: false,
      isWholeChapter: false,
      originalText: reference
    };
  }

  // Case 5: Chapter range ("John 3-5")
  // Special handling for single-chapter books: "Jude 2-5" means "Jude 1:2-5"
  if (!verse1Str && rangeStr && !verse2Str) {
    const range = parseInt(rangeStr, 10);

    // Check if this is a single-chapter book
    if (SINGLE_CHAPTER_BOOKS.has(bookInfo.number)) {
      // Interpret as verse range in chapter 1
      return {
        book: bookInfo.number,
        bookName: bookInfo.name,
        startChapter: 1,
        startVerse: chapter1,
        endChapter: 1,
        endVerse: range,
        isWholeBook: false,
        isWholeChapter: false,
        originalText: reference
      };
    }

    // Normal multi-chapter book: chapter range
    return {
      book: bookInfo.number,
      bookName: bookInfo.name,
      startChapter: chapter1,
      endChapter: range,
      isWholeBook: false,
      isWholeChapter: true,
      originalText: reference
    };
  }

  // Case 6: Cross-chapter range ("John 3:16-5:12")
  if (verse1Str && rangeStr && verse2Str) {
    const verse1 = parseInt(verse1Str, 10);
    const chapter2 = parseInt(rangeStr, 10);
    const verse2 = parseInt(verse2Str, 10);
    return {
      book: bookInfo.number,
      bookName: bookInfo.name,
      startChapter: chapter1,
      startVerse: verse1,
      endChapter: chapter2,
      endVerse: verse2,
      isWholeBook: false,
      isWholeChapter: false,
      originalText: reference
    };
  }

  return null;
}

/**
 * Format a parsed reference back to a standard string
 */
export function formatReference(parsed: ParsedReference): string {
  if (parsed.isWholeBook) {
    return parsed.bookName;
  }

  if (parsed.isWholeChapter) {
    if (parsed.endChapter && parsed.endChapter !== parsed.startChapter) {
      return `${parsed.bookName} ${parsed.startChapter}-${parsed.endChapter}`;
    }
    return `${parsed.bookName} ${parsed.startChapter}`;
  }

  const start = `${parsed.bookName} ${parsed.startChapter}:${parsed.startVerse}`;

  if (parsed.endChapter === parsed.startChapter && parsed.endVerse === parsed.startVerse) {
    return start;
  }

  if (parsed.endChapter === parsed.startChapter) {
    return `${start}-${parsed.endVerse}`;
  }

  return `${start}-${parsed.endChapter}:${parsed.endVerse}`;
}
