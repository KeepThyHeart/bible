import { BibleVerse, InterlinearWord } from '../Models/Bible/BibleVerse';
import { BibleModuleInfo } from '../Models/Bible/BibleModuleInfo';
import { VerseId, BookNumber } from '../Core/Types';


/**
 * Interface for Bible translation repository
 * Defines all operations for working with Bible translation databases
 */
export interface IBibleRepository {
  // Module Info Operations
  getModuleInfo(): BibleModuleInfo | undefined;
  updateModuleInfo(info: BibleModuleInfo): void;

  // Verse Operations
  getVerse(verseId: VerseId): BibleVerse | undefined;
  getVerseTexts(verseIds: VerseId[]): Map<VerseId, BibleVerse>;
  getVerseRange(startVerseId: VerseId, endVerseId: VerseId): BibleVerse[];
  getChapter(book: BookNumber, chapter: number): BibleVerse[];
  getBook(book: BookNumber): BibleVerse[];
  searchVerses(query: string, options?: { limit?: number }): BibleVerse[];
  searchVersesWithHighlighting(
    query: string,
    options?: { limit?: number }
  ): Array<{
    verse: BibleVerse;
    highlightedText: string;
    highlightedPlainText: string;
  }>;
  getVersesWithHeadings(): BibleVerse[];
  getVerseCount(): number;

  /**
   * Get which books have content in this module
   * Returns an array of book numbers (1-66) that have at least one verse
   */
  getCoveredBooks(): number[];

  // Verse Modification (for module creation/import)
  createVerse(verse: BibleVerse): BibleVerse;
  updateVerse(verse: BibleVerse): BibleVerse;
  deleteVerse(verseId: VerseId): boolean;
  batchInsertVerses(verses: BibleVerse[]): void;

  // Module-Level Search Index Support
  /**
   * Ensure the derived book-search index exists; returns whether it is usable.
   * Returns false (rather than throwing) on a read-only module - a module is
   * immutable, and this index is a cache, not module content. See R-12.
   */
  ensureSearchTablesExist(): boolean;
  isBookIndexed(bookNumber: number): boolean;
  buildBookIndex(bookNumber: number): void;
  searchBookFTS5(bookNumber: number, fts5Query: string): Array<{
    bookNumber: number;
    text: string;
    offsets: string;
  }>;
  searchProximityInBook(bookNumber: number, terms: string[], maxDistance: number): VerseId[];
  getVerseIdAtPosition(bookNumber: number, position: number): VerseId | undefined;
  getVersePosition(bookNumber: number, verseId: VerseId): { startIndex: number; endIndex: number } | undefined;

  // Interlinear Operations (for original language texts)
  getInterlinearWords(verseId: VerseId): InterlinearWord[];
  getInterlinearWordsForChapter(book: BookNumber, chapter: number): Map<VerseId, InterlinearWord[]>;
  hasInterlinearData(): boolean;

  // Strong's Number Search Operations
  /**
   * Find all verse IDs containing a given Strong's number.
   * Handles variable zero-padding in Hebrew entries.
   * @param strongsVariants - Array of format variants to match (from StrongsNumberHelper.toInterlinearVariants)
   * @param range - Optional verse ID range for scope filtering
   */
  searchByStrongsNumber(strongsVariants: string[], range?: { startVerseId: number; endVerseId: number }): VerseId[];

  /**
   * Get the most common English gloss for a Strong's number.
   * Useful for highlighting matched words in search results.
   */
  getGlossesForStrongs(strongsVariants: string[]): string[];
}
