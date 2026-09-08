/**
 * Utility functions for working with verse references.
 *
 * The book-name cache below is loaded from the module database, so it returns
 * names in the module's own language. Prefer it over the English tables in
 * `@bible/core` for anything the user reads.
 */
import { VerseIdHelper } from '@bible/core';

// Cache for book names to avoid repeated API calls
let bookNamesCache: Map<number, string> | null = null;

/**
 * Parse a verse ID into its components
 * VerseId format: (bookNumber * 1000000) + (chapter * 1000) + verse
 */
export function parseVerseId(verseId: number): {
  bookNumber: number;
  chapter: number;
  verse: number;
} {
  return VerseIdHelper.parse(verseId);
}

/**
 * Calculate a verse ID from components
 */
export function calculateVerseId(bookNumber: number, chapter: number, verse: number): number {
  return VerseIdHelper.calculate(bookNumber, chapter, verse);
}

/**
 * Load all book names into cache
 */
export async function loadBookNamesCache(bibleAPI: any): Promise<void> {
  if (bookNamesCache) return; // Already loaded

  try {
    const books = await bibleAPI.getAllBooks();
    bookNamesCache = new Map();
    books.forEach((book: any) => {
      bookNamesCache!.set(book.book_number, book.book_name);
    });
  } catch (error) {
    console.error('Failed to load book names:', error);
    bookNamesCache = new Map(); // Empty cache to prevent repeated failed loads
  }
}

/**
 * Get book name from cache
 */
export function getBookNameFromCache(bookNumber: number): string {
  return bookNamesCache?.get(bookNumber) || 'Unknown';
}

/**
 * Format a verse ID as a human-readable reference
 * @param verseId The verse ID to format
 * @param bookName Optional book name (if already available)
 * @returns Formatted reference like "Genesis 1:1"
 */
export function formatVerseReference(verseId: number, bookName?: string): string {
  const { bookNumber, chapter, verse } = parseVerseId(verseId);

  if (!bookName) {
    bookName = getBookNameFromCache(bookNumber);
  }

  return `${bookName} ${chapter}:${verse}`;
}

/**
 * Format a verse range as a human-readable reference
 * @param startVerseId Start verse ID
 * @param endVerseId End verse ID (optional)
 * @param bookName Optional book name (if already available)
 * @returns Formatted reference like "Genesis 1:1-5" or "Genesis 1:1 - 2:3"
 */
export function formatVerseRange(startVerseId: number, endVerseId?: number, bookName?: string): string {
  if (!endVerseId || startVerseId === endVerseId) {
    return formatVerseReference(startVerseId, bookName);
  }

  const start = parseVerseId(startVerseId);
  const end = parseVerseId(endVerseId);

  if (!bookName) {
    bookName = getBookNameFromCache(start.bookNumber);
  }

  // Same chapter
  if (start.bookNumber === end.bookNumber && start.chapter === end.chapter) {
    return `${bookName} ${start.chapter}:${start.verse}-${end.verse}`;
  }

  // Different chapters
  return `${bookName} ${start.chapter}:${start.verse} - ${end.chapter}:${end.verse}`;
}

/**
 * Clear the book names cache (useful for testing)
 */
export function clearBookNamesCache(): void {
  bookNamesCache = null;
}
