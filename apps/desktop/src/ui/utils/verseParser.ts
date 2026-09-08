import { VerseId, VerseIdHelper, ENGLISH_BOOK_NAMES, getBookName as coreGetBookName } from '@bible/core';

/**
 * Utility for parsing Bible verse references from text
 * Supports formats like "John 3:16", "Romans 8:28-39", "Gen 1:1"
 */

// Book name/abbreviation -> book number. Sourced from @bible/core, which
// holds the repo-wide alias table, rather than this file keeping its own
// 296-entry copy. Core's table is a strict superset (same mappings, more
// aliases), so the parser below accepts everything a local copy would and a
// little more.
//
// NOTE: only the TABLE is shared. The parsing logic stays local on purpose -
// core's ReferenceParser accepts "John 0:1", "John 3:0" and the reversed
// range "John 3:16-10", all of which this parser correctly rejects, and it
// fuzzy-matches typos ("Genesus" -> Genesis) which would be wrong here.
const BOOK_NAME_MAP: ReadonlyMap<string, number> = ENGLISH_BOOK_NAMES;

export interface ParsedReference {
  bookNumber: number;
  bookName: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  originalText: string;
}

/**
 * Parse a verse reference string into structured data
 * @param reference - Reference string like "John 3:16" or "Romans 8:28-39"
 * @returns Parsed reference or undefined if invalid
 */
export function parseVerseReference(reference: string): ParsedReference | undefined {
  if (!reference || typeof reference !== 'string') {
    return undefined;
  }

  // Normalize: trim, lowercase for matching
  const normalized = reference.trim().toLowerCase();

  // Pattern: "Book Chapter:Verse" or "Book Chapter:StartVerse-EndVerse"
  // Examples: "John 3:16", "Romans 8:28-39", "1 John 2:1-3"
  const pattern = /^([123]?\s*[a-z]+(?:\s+of\s+[a-z]+)?)\s+(\d+):(\d+)(?:-(\d+))?$/i;
  const match = normalized.match(pattern);

  if (!match) {
    return undefined;
  }

  const [, bookName, chapterStr, verseStartStr, verseEndStr] = match;
  const bookNum = BOOK_NAME_MAP.get(bookName.trim());

  if (!bookNum) {
    return undefined;
  }

  const chapter = parseInt(chapterStr, 10);
  const verseStart = parseInt(verseStartStr, 10);
  const verseEnd = verseEndStr ? parseInt(verseEndStr, 10) : undefined;

  // Validate numbers
  if (chapter < 1 || verseStart < 1 || (verseEnd && verseEnd < verseStart)) {
    return undefined;
  }

  // Calculate verse IDs
  const verseIdStart = VerseIdHelper.calculate(bookNum, chapter, verseStart);
  const verseIdEnd = verseEnd ? VerseIdHelper.calculate(bookNum, chapter, verseEnd) : undefined;

  // Get proper book name (capitalize first letter)
  const properBookName = getBookName(bookNum);

  return {
    bookNumber: bookNum,
    bookName: properBookName,
    chapter,
    verseStart,
    verseEnd,
    verseIdStart,
    verseIdEnd,
    originalText: reference.trim()
  };
}

/**
 * Find all verse references in a text string
 * @param text - Text to search
 * @returns Array of parsed references
 */
export function findVerseReferences(text: string): ParsedReference[] {
  if (!text) return [];

  const results: ParsedReference[] = [];

  // Pattern to match potential verse references
  // Look for: word(s) followed by number:number or number:number-number
  const pattern = /\b([123]?\s*[a-z]+(?:\s+of\s+[a-z]+)?)\s+(\d+):(\d+)(?:-(\d+))?\b/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const parsed = parseVerseReference(match[0]);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

/**
 * Get the full book name from book number.
 * core's getBookName applies the same `Book <n>` fallback this used inline.
 */
function getBookName(bookNum: number): string {
  return coreGetBookName(bookNum);
}

/**
 * Get all book names with their numbers
 * Useful for autocomplete/dropdown
 */
export function getAllBooks(): Array<{ number: number; name: string }> {
  return Array.from({ length: 66 }, (_, i) => ({
    number: i + 1,
    name: getBookName(i + 1)
  }));
}
