import { IBibleBookRepository } from '../Data/Repositories/IBibleBookRepository';
import { VerseId, VerseIdHelper } from '../Data/Core/Types';
import { BibleBook } from '../Data/Models/Main/BibleBook';

/**
 * Verse reference parsed from user input
 */
export interface VerseReference {
  bookNumber: number;
  bookName: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  verseId: VerseId;
}

/**
 * Chapter information
 */
export interface ChapterInfo {
  bookNumber: number;
  bookName: string;
  chapter: number;
  verseCount: number;
  startVerseId: VerseId;
  endVerseId: VerseId;
}

/**
 * Navigation result
 */
export interface NavigationResult {
  canNavigate: boolean;
  targetVerseId?: VerseId;
  targetBookNumber?: number;
  targetChapter?: number;
  message?: string;
}

/**
 * Service for verse navigation and reference parsing
 *
 * This service handles:
 * - Parsing verse references from user input (e.g., "John 3:16", "Gen 1:1-3")
 * - Navigating between chapters, verses, and books
 * - Validating verse references
 * - Calculating verse ranges
 */
export class VerseNavigationService {
  constructor(private bibleBookRepo: IBibleBookRepository) {}

  /**
   * Parse a verse reference string
   *
   * Supports formats:
   * - "John 3:16"
   * - "John 3:16-17"
   * - "Gen 1"
   * - "Genesis 1:1"
   * - "Rom 8:28-39"
   */
  parseReference(reference: string): VerseReference | undefined {
    // Trim and normalize
    reference = reference.trim();
    if (!reference) return undefined;

    // Match pattern: "Book Chapter:Verse" or "Book Chapter:Verse-Verse"
    const match = reference.match(/^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
    if (!match) return undefined;

    const [, bookStr, chapterStr, verseStartStr, verseEndStr] = match;

    // Find the book
    const book = this.bibleBookRepo.getByName(bookStr.trim());
    if (!book) return undefined;

    const chapter = parseInt(chapterStr, 10);
    if (chapter < 1 || chapter > book.chapterCount) return undefined;

    // Parse verses
    const verseStart = verseStartStr ? parseInt(verseStartStr, 10) : 1;
    const verseEnd = verseEndStr ? parseInt(verseEndStr, 10) : verseStart;

    // Calculate verse ID (using start verse)
    const verseId = VerseIdHelper.calculate(book.bookNumber, chapter, verseStart);

    return {
      bookNumber: book.bookNumber,
      bookName: book.bookName,
      chapter,
      verseStart,
      verseEnd: verseEnd !== verseStart ? verseEnd : undefined,
      verseId
    };
  }

  /**
   * Get the next chapter
   */
  getNextChapter(bookNumber: number, chapter: number): NavigationResult {
    const book = this.bibleBookRepo.getByBookNumber(bookNumber);
    if (!book) {
      return { canNavigate: false, message: 'Invalid book number' };
    }

    // Check if we can go to next chapter in same book
    if (chapter < book.chapterCount) {
      const nextChapter = chapter + 1;
      const verseId = VerseIdHelper.calculate(bookNumber, nextChapter, 1);
      return {
        canNavigate: true,
        targetVerseId: verseId,
        targetBookNumber: bookNumber,
        targetChapter: nextChapter
      };
    }

    // Try next book
    const nextBook = this.bibleBookRepo.getByBookNumber(bookNumber + 1);
    if (!nextBook) {
      return { canNavigate: false, message: 'Already at last chapter of last book' };
    }

    const verseId = VerseIdHelper.calculate(nextBook.bookNumber, 1, 1);
    return {
      canNavigate: true,
      targetVerseId: verseId,
      targetBookNumber: nextBook.bookNumber,
      targetChapter: 1
    };
  }

  /**
   * Get the previous chapter
   */
  getPreviousChapter(bookNumber: number, chapter: number): NavigationResult {
    const book = this.bibleBookRepo.getByBookNumber(bookNumber);
    if (!book) {
      return { canNavigate: false, message: 'Invalid book number' };
    }

    // Check if we can go to previous chapter in same book
    if (chapter > 1) {
      const prevChapter = chapter - 1;
      const verseId = VerseIdHelper.calculate(bookNumber, prevChapter, 1);
      return {
        canNavigate: true,
        targetVerseId: verseId,
        targetBookNumber: bookNumber,
        targetChapter: prevChapter
      };
    }

    // Try previous book
    const prevBook = this.bibleBookRepo.getByBookNumber(bookNumber - 1);
    if (!prevBook) {
      return { canNavigate: false, message: 'Already at first chapter of first book' };
    }

    const verseId = VerseIdHelper.calculate(
      prevBook.bookNumber,
      prevBook.chapterCount,
      1
    );
    return {
      canNavigate: true,
      targetVerseId: verseId,
      targetBookNumber: prevBook.bookNumber,
      targetChapter: prevBook.chapterCount
    };
  }

  /**
   * Get chapter information
   */
  getChapterInfo(bookNumber: number, chapter: number): ChapterInfo | undefined {
    const book = this.bibleBookRepo.getByBookNumber(bookNumber);
    if (!book || chapter < 1 || chapter > book.chapterCount) {
      return undefined;
    }

    // Calculate verse range for the chapter
    const chapterRange = VerseIdHelper.getChapterRange(bookNumber, chapter);

    return {
      bookNumber,
      bookName: book.bookName,
      chapter,
      verseCount: 0, // Would need to query this from Bible module
      startVerseId: chapterRange.startVerseId,
      endVerseId: chapterRange.endVerseId ?? chapterRange.startVerseId
    };
  }

  /**
   * Get all books
   */
  getAllBooks(): BibleBook[] {
    return this.bibleBookRepo.getAll();
  }

  /**
   * Get books by testament
   */
  getBooksByTestament(testament: 'OT' | 'NT'): BibleBook[] {
    return this.bibleBookRepo.getByTestament(testament);
  }

  /**
   * Format a verse reference for display
   */
  formatReference(verseId: VerseId): string {
    const ref = VerseIdHelper.parse(verseId);
    const book = this.bibleBookRepo.getByBookNumber(ref.bookNumber);

    if (!book) return `Book ${ref.bookNumber}:${ref.chapter}:${ref.verse}`;

    const bookName = book.bookAbbreviation ?? book.bookName;
    return `${bookName} ${ref.chapter}:${ref.verse}`;
  }

  /**
   * Format a verse range for display
   */
  formatRangeReference(
    startVerseId: VerseId,
    endVerseId: VerseId
  ): string {
    const startRef = VerseIdHelper.parse(startVerseId);
    const endRef = VerseIdHelper.parse(endVerseId);
    const book = this.bibleBookRepo.getByBookNumber(startRef.bookNumber);

    if (!book) return `Book ${startRef.bookNumber}:${startRef.chapter}:${startRef.verse}-${endRef.verse}`;

    const bookName = book.bookAbbreviation ?? book.bookName;

    // Same chapter
    if (startRef.chapter === endRef.chapter) {
      return `${bookName} ${startRef.chapter}:${startRef.verse}-${endRef.verse}`;
    }

    // Different chapters
    return `${bookName} ${startRef.chapter}:${startRef.verse} - ${endRef.chapter}:${endRef.verse}`;
  }

  /**
   * Validate a verse reference
   */
  isValidReference(bookNumber: number, chapter: number, verse: number): boolean {
    const book = this.bibleBookRepo.getByBookNumber(bookNumber);
    if (!book) return false;

    if (chapter < 1 || chapter > book.chapterCount) return false;

    // Note: We can't validate verse count without querying the Bible module
    // This is a basic validation
    if (verse < 1) return false;

    return true;
  }

  /**
   * Get the verse ID for a reference
   */
  getVerseId(bookNumber: number, chapter: number, verse: number): VerseId | undefined {
    if (!this.isValidReference(bookNumber, chapter, verse)) {
      return undefined;
    }

    return VerseIdHelper.calculate(bookNumber, chapter, verse);
  }
}
