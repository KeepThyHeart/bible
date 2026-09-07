import { formatPassageRef, isSingleChapterBook } from '../constants';
import { getLocalizedBookName } from './bookNames';

/**
 * Parse a numeric verse ID into its book, chapter, and verse components.
 * Verse IDs use the format: (book * 1000000) + (chapter * 1000) + verse
 */
export function parseVerseId(verseId: number): { bookNumber: number; chapter: number; verse: number } {
  const bookNumber = Math.floor(verseId / 1000000);
  const chapter = Math.floor((verseId % 1000000) / 1000);
  const verse = verseId % 1000;
  return { bookNumber, chapter, verse };
}

/**
 * Format a verse ID range as a human-readable reference string.
 * Handles single-chapter books, same-chapter ranges, and cross-chapter ranges.
 *
 * Examples:
 *   formatVerseRange(43003016)              → "John 3:16"
 *   formatVerseRange(43003016, 43003018)    → "John 3:16-18"
 *   formatVerseRange(43003016, 43004005)    → "John 3:16-4:5"
 *   formatVerseRange(65001003, 65001005)    → "Jude 3-5"
 */
export function formatVerseRange(verseIdStart: number, verseIdEnd?: number | null): string {
  const start = parseVerseId(verseIdStart);
  const bookName = getLocalizedBookName(start.bookNumber);
  const single = isSingleChapterBook(start.bookNumber);
  if (verseIdEnd && verseIdEnd !== verseIdStart) {
    const end = parseVerseId(verseIdEnd);
    if (single) {
      return `${bookName} ${start.verse}-${end.verse}`;
    }
    if (end.chapter === start.chapter) {
      return `${bookName} ${start.chapter}:${start.verse}-${end.verse}`;
    }
    return `${bookName} ${start.chapter}:${start.verse}-${end.chapter}:${end.verse}`;
  }
  return formatPassageRef(start.bookNumber, start.chapter, start.verse, bookName);
}

/** Check if a commentary module abbreviation is TSK-style (uses bare verse numbers). */
export function isTskModule(moduleAbbr: string): boolean {
  return moduleAbbr.toUpperCase() === 'TSK';
}
