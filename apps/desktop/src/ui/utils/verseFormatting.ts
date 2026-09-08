/**
 * Verse Formatting Utilities
 * Helper functions for formatting verse IDs and references.
 *
 * Display names and verse-id parsing come from @bible/core.
 */
import { VerseIdHelper, getBookName as coreGetBookName } from '@bible/core';


// Book abbreviations.
//
// Deliberately NOT core's MEDIUM_NAMES. The two tables agree on 64 of 66
// entries but differ on Exodus ('Exod' here vs 'Exo' in core) and Psalms
// ('Ps' vs 'Psa'). Both spellings are in common use, so picking one is a
// product decision about visible UI text rather than a refactor - unifying
// them would silently restyle every abbreviated reference in one app or the
// other. Left local until that call is made.
const BOOK_ABBREVIATIONS = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth',
  '1 Sam', '2 Sam', '1 Kgs', '2 Kgs', '1 Chr', '2 Chr', 'Ezra',
  'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song',
  'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos',
  'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech',
  'Mal', 'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1 Cor',
  '2 Cor', 'Gal', 'Eph', 'Phil', 'Col', '1 Thess',
  '2 Thess', '1 Tim', '2 Tim', 'Titus', 'Phlm', 'Heb', 'Jas',
  '1 Pet', '2 Pet', '1 John', '2 John', '3 John', 'Jude', 'Rev'
];

/**
 * Parse verse ID into components
 * Format: (book_number * 1000000) + (chapter * 1000) + verse
 */
export interface VerseReference {
  bookNumber: number;
  chapter: number;
  verse: number;
}

export function parseVerseId(verseId: number): VerseReference {
  return VerseIdHelper.parse(verseId);
}

/**
 * Get book name from book number (1-66)
 */
export function getBookName(bookNumber: number): string {
  // core's getBookName already returns `Book <n>` for out-of-range numbers.
  return coreGetBookName(bookNumber);
}

/**
 * Get book abbreviation from book number (1-66)
 */
export function getBookAbbreviation(bookNumber: number): string {
  if (bookNumber < 1 || bookNumber > 66) {
    return `Bk${bookNumber}`;
  }
  return BOOK_ABBREVIATIONS[bookNumber - 1];
}

/**
 * Format verse ID as human-readable reference
 * Examples: "John 3:16", "Genesis 1:1"
 */
export function formatVerseReference(verseId: number, useAbbreviation: boolean = false): string {
  const { bookNumber, chapter, verse } = parseVerseId(verseId);
  const bookName = useAbbreviation ? getBookAbbreviation(bookNumber) : getBookName(bookNumber);
  return `${bookName} ${chapter}:${verse}`;
}

/**
 * Format verse range as human-readable reference
 * Examples: "John 3:16-18", "Genesis 1:1-2:3"
 */
export function formatVerseRange(startVerseId: number, endVerseId?: number, useAbbreviation: boolean = false): string {
  if (!endVerseId || endVerseId === startVerseId) {
    return formatVerseReference(startVerseId, useAbbreviation);
  }

  const start = parseVerseId(startVerseId);
  const end = parseVerseId(endVerseId);

  const bookName = useAbbreviation ? getBookAbbreviation(start.bookNumber) : getBookName(start.bookNumber);

  // Same chapter
  if (start.bookNumber === end.bookNumber && start.chapter === end.chapter) {
    return `${bookName} ${start.chapter}:${start.verse}-${end.verse}`;
  }

  // Different chapters
  if (start.bookNumber === end.bookNumber) {
    return `${bookName} ${start.chapter}:${start.verse}-${end.chapter}:${end.verse}`;
  }

  // Different books (rare)
  return `${formatVerseReference(startVerseId, useAbbreviation)}-${formatVerseReference(endVerseId, useAbbreviation)}`;
}

/**
 * Format date for display
 */
export function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateString;
  }
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Strip HTML tags from text
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Get content preview from HTML or plain text
 */
export function getContentPreview(content: string, maxLength: number = 100): string {
  const stripped = stripHtml(content);
  const trimmed = stripped.trim();
  return truncateText(trimmed, maxLength);
}

/**
 * Clean module name by removing trailing single digit (SWORD import artifact)
 * Examples: "Clark0" -> "Clark", "Barnes1" -> "Barnes"
 * Does not affect names with multi-digit numbers like "KJV2000"
 */
export function cleanModuleName(name: string): string {
  if (!name) return name;
  // Remove trailing single digit that follows a letter (common SWORD import artifact)
  return name.replace(/([a-zA-Z])(\d)$/, '$1');
}
