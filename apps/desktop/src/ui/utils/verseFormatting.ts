/**
 * Verse Formatting Utilities
 * Helper functions for formatting verse IDs and references.
 *
 * Display names and verse-id parsing come from @bible/core.
 */
import { MEDIUM_NAMES, VerseIdHelper, getBookName as coreGetBookName, getLocalizer, type Localizer } from '@bible/core';


// Book abbreviations: core's English medium names (SBL style, "Exod", "Ps"),
// the single source since task 0077 (Q9 adopted this app's spellings).
const BOOK_ABBREVIATIONS: readonly string[] = Array.from({ length: 66 }, (_, i) => MEDIUM_NAMES[i + 1]);

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
 * Format date for display. Pass the caller's active `Localizer` (from
 * `useI18n()`) so this follows the chosen UI locale rather than always
 * formatting in English; callers that omit it keep the historical `en`
 * formatting.
 */
export function formatDate(dateString: string, localizer: Localizer = getLocalizer('en')): string {
  try {
    const date = new Date(dateString);
    return localizer.formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' });
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
