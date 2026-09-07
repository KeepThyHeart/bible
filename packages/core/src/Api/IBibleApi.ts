/**
 * Bible module operations.
 *
 * Covers all read operations for Bible text, interlinear data, and module discovery.
 */

import type {
  BibleModuleSummary,
  FormattedVerse,
  ChapterResult,
  SearchOptions,
  VerseSearchResult,
  InterlinearWord,
  BookInfo
} from './ApiTypes';

export interface IBibleApi {
  // --- Module Discovery -------------------------------------------
  getAvailableBibles(): Promise<BibleModuleSummary[]>;

  // --- Reference Data ---------------------------------------------
  getAllBooks(): Promise<BookInfo[]>;
  getBookName(bookNumber: number): Promise<string>;

  // --- Verse Retrieval --------------------------------------------
  getVerse(abbreviation: string, verseId: number): Promise<FormattedVerse | null>;
  getVerses(abbreviation: string, verseIds: number[]): Promise<FormattedVerse[]>;
  /** Get a contiguous passage by start/end verse ID. Simpler than getVerses for sequential ranges. */
  getPassage(abbreviation: string, startVerseId: number, endVerseId: number): Promise<FormattedVerse[]>;
  getChapter(abbreviation: string, bookNumber: number, chapter: number): Promise<ChapterResult>;

  // --- Search -----------------------------------------------------
  search(abbreviation: string, query: string, options?: SearchOptions): Promise<VerseSearchResult[]>;

  // --- Interlinear ------------------------------------------------
  getInterlinearWords(abbreviation: string, verseId: number): Promise<InterlinearWord[]>;
  hasInterlinearData(abbreviation: string): Promise<boolean>;

  // --- Batch / Convenience ----------------------------------------
  /**
   * Load initial data for app startup: available Bibles + default chapter.
   * Reduces round-trips vs calling getAvailableBibles + getChapter separately.
   */
  getInitialData(abbreviation: string, bookNumber: number, chapter: number): Promise<{
    availableBibles: BibleModuleSummary[];
    defaultBible: BibleModuleSummary | null;
    defaultVerses: FormattedVerse[];
    bookNumber: number;
    chapter: number;
    bookName: string;
    hasInterlinearData?: boolean;
  }>;

  /**
   * Get plain text for multiple verses (used for clipboard, sharing).
   */
  getVerseTexts(abbreviation: string, verseIds: number[]): Promise<Array<{
    verseId: number;
    text: string;
    bookName: string;
    chapter: number;
    verse: number;
  }>>;
}
