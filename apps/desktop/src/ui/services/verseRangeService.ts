/**
 * Verse Range Service
 *
 * Fetches Bible verses based on parsed references
 */

import { parseReference, ParsedReference } from './verseReferenceParser';
import { bibleAPI } from './electronAPI';
import { BibleVerse } from './verseCopyService';

// Import VerseIdHelper from Data layer
import { VerseIdHelper } from '@bible/core';

/** The shape `bible:getAllBooks` actually returns - snake_case, straight from `bible_book`. */
interface BibleBookRow {
  book_number: number;
  book_name: string;
  chapter_count: number;
}

/** How many chapter fetches to have in flight when pulling a whole book. */
const WHOLE_BOOK_FETCH_CONCURRENCY = 6;

/** Run `fn` over `items` with at most `limit` in flight, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fetch verses based on a parsed reference
 *
 * @param abbreviation - Bible translation abbreviation (e.g., 'KJV')
 * @param parsed - Parsed reference object
 * @returns Array of verses
 */
export async function fetchVersesByReference(
  abbreviation: string,
  parsed: ParsedReference
): Promise<BibleVerse[]> {
  // Case 1: Whole book
  if (parsed.isWholeBook) {
    // Get all books to find the chapter count for this book.
    // `bible:getAllBooks` returns snake_case rows straight from the DB
    // (see electron/ipc/bibleHandlers.ts) - reading `bookNumber` here made
    // `find` return undefined for every book, so a bare book name such as
    // "John" always failed with "Book John not found".
    const allBooks = await bibleAPI.getAllBooks() as BibleBookRow[];
    const book = allBooks.find(b => b.book_number === parsed.book);

    if (!book) {
      throw new Error(`Book ${parsed.bookName} not found`);
    }

    // Fetch all chapters in the book. Genesis and Psalms are 50 and 150
    // chapters, so these go out in bounded batches rather than one at a time.
    const chapters = Array.from({ length: book.chapter_count }, (_, i) => i + 1);
    const pages = await mapWithConcurrency(chapters, WHOLE_BOOK_FETCH_CONCURRENCY, async ch => {
      const result = await bibleAPI.getChapter(abbreviation, parsed.book, ch);
      return Array.isArray(result) ? result : result.verses;
    });
    return pages.flat();
  }

  // Case 2: Whole chapter(s)
  if (parsed.isWholeChapter) {
    if (parsed.endChapter && parsed.endChapter !== parsed.startChapter) {
      // Multiple chapters - fetch each chapter and combine
      const allVerses: BibleVerse[] = [];
      for (let ch = parsed.startChapter!; ch <= parsed.endChapter; ch++) {
        const result = await bibleAPI.getChapter(abbreviation, parsed.book, ch);
        const verses = Array.isArray(result) ? result : result.verses;
        allVerses.push(...verses);
      }
      return allVerses;
    } else {
      // Single chapter
      const result = await bibleAPI.getChapter(abbreviation, parsed.book, parsed.startChapter!);
      return Array.isArray(result) ? result : result.verses;
    }
  }

  // Case 3: Verse range (single or cross-chapter)
  const startVerseId = VerseIdHelper.calculate(
    parsed.book,
    parsed.startChapter!,
    parsed.startVerse!
  );

  const endVerseId = VerseIdHelper.calculate(
    parsed.book,
    parsed.endChapter!,
    parsed.endVerse!
  );

  return await bibleAPI.getVerses(abbreviation, startVerseId, endVerseId);
}

/**
 * Fetch verses by reference string
 *
 * @param abbreviation - Bible translation abbreviation (e.g., 'KJV')
 * @param referenceText - Reference string (e.g., "John 3:16-17")
 * @returns Object with verses and parsed reference, or error
 */
export async function fetchVersesByReferenceText(
  abbreviation: string,
  referenceText: string
): Promise<{ verses: BibleVerse[]; parsed: ParsedReference } | { error: string }> {
  const parsed = parseReference(referenceText);

  if (!parsed) {
    return { error: 'Invalid reference format' };
  }

  try {
    const verses = await fetchVersesByReference(abbreviation, parsed);
    return { verses, parsed };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to fetch verses' };
  }
}

/**
 * Get a displayable reference string for the given verses
 *
 * @param verses - Array of verses
 * @param bookName - Name of the book
 * @param chapter - Chapter number (if all verses are in same chapter)
 * @returns Formatted reference string
 */
export function getDisplayReference(
  verses: BibleVerse[],
  bookName: string,
  _chapter?: number
): string {
  if (verses.length === 0) return '';

  if (verses.length === 1) {
    const v = verses[0];
    return `${bookName} ${v.chapter}:${v.verse}`;
  }

  const firstVerse = verses[0];
  const lastVerse = verses[verses.length - 1];

  // Check if all in same chapter
  if (firstVerse.chapter === lastVerse.chapter) {
    if (firstVerse.verse === lastVerse.verse) {
      return `${bookName} ${firstVerse.chapter}:${firstVerse.verse}`;
    }
    return `${bookName} ${firstVerse.chapter}:${firstVerse.verse}-${lastVerse.verse}`;
  }

  // Cross-chapter range
  return `${bookName} ${firstVerse.chapter}:${firstVerse.verse}-${lastVerse.chapter}:${lastVerse.verse}`;
}
