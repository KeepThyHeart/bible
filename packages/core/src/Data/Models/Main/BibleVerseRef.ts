/**
 * Canonical verse location record (bookId, chapter, verse, absoluteId).
 * Defines the verse catalog - fundamentally different from ScriptureReference,
 * which tracks where a verse is mentioned/referenced in content.
 */
import { VerseId, Metadata } from '../../Core/Types';

/**
 * Bible verse reference entity from the main database
 * Represents a unique verse with its location in the Bible
 */
export class BibleVerseRef {
  verseId: VerseId;
  absoluteId: number;
  bookId: number;
  chapter: number;
  verse: number;
  isBookStart: boolean;
  isDivisionStart: boolean;
  metadata?: Metadata;

  constructor(data: {
    verseId: VerseId;
    absoluteId: number;
    bookId: number;
    chapter: number;
    verse: number;
    isBookStart?: boolean;
    isDivisionStart?: boolean;
    metadata?: Metadata;
  }) {
    this.verseId = data.verseId;
    this.absoluteId = data.absoluteId;
    this.bookId = data.bookId;
    this.chapter = data.chapter;
    this.verse = data.verse;
    this.isBookStart = data.isBookStart ?? false;
    this.isDivisionStart = data.isDivisionStart ?? false;
    this.metadata = data.metadata;
  }

  /**
   * Get the reference as a string (requires book name lookup)
   */
  toString(bookName: string): string {
    return `${bookName} ${this.chapter}:${this.verse}`;
  }

  /**
   * Check if this is the first verse of a book
   */
  isFirstVerseOfBook(): boolean {
    return this.isBookStart;
  }

  /**
   * Check if this is a division start (book start or Psalms chapter)
   */
  isDivision(): boolean {
    return this.isDivisionStart;
  }
}
