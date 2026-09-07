import { VerseId } from '../Core/Types';
import { BibleSearchIndex } from '../Models/Main/BibleSearchIndex';
import { BibleSearchVersePosition } from '../Models/Main/BibleSearchVersePosition';
import { SavedSearch } from '../Models/Main/SavedSearch';
import { FTS5Match } from '../../types/search';

/**
 * Interface for Bible Search Repository
 *
 * Handles all search index operations including:
 * - Book-level FTS5 indexing for proximity searches
 * - Verse position mapping
 * - Saved searches
 * - Search history
 */
export interface IBibleSearchRepository {
  // ========================================================================
  // Index Management
  // ========================================================================

  /**
   * Check if a book is indexed for proximity search
   */
  isBookIndexed(document: string, division: string): boolean;

  /**
   * Get index metadata for a book
   */
  getIndexMetadata(document: string, division: string): BibleSearchIndex | undefined;

  /**
   * Build book-level search index
   * @param document Module abbreviation (e.g., "kjv")
   * @param division Book number as string (e.g., "1" for Genesis)
   * @param bookText Complete book text for indexing
   * @param versePositions Verse position mappings
   */
  buildBookIndex(
    document: string,
    division: string,
    bookText: string,
    versePositions: BibleSearchVersePosition[]
  ): void;

  /**
   * Clear book index (marks for re-indexing)
   */
  clearBookIndex(document: string, division: string): void;

  /**
   * Delete book index completely
   */
  deleteBookIndex(document: string, division: string): void;

  /**
   * Get all unindexed books for a document
   */
  getUnindexedBooks(document: string): BibleSearchIndex[];

  /**
   * Get all indexed books for a document
   */
  getIndexedBooks(document: string): BibleSearchIndex[];

  // ========================================================================
  // Proximity Search (Book-Level FTS5)
  // ========================================================================

  /**
   * Search for terms within a specific proximity using FTS5 NEAR
   * @param document Module abbreviation
   * @param terms Array of search terms
   * @param maxDistance Maximum word distance between terms
   * @param division Optional book number to limit search to specific book
   * @returns Array of FTS5 matches with positions
   */
  searchProximity(
    document: string,
    terms: string[],
    maxDistance: number,
    division?: string
  ): FTS5Match[];

  /**
   * Search for exact phrase in book-level index
   */
  searchPhrase(document: string, phrase: string, division?: string): FTS5Match[];

  /**
   * Raw FTS5 query (for advanced boolean searches)
   */
  searchFTS5(document: string, fts5Query: string, division?: string): FTS5Match[];

  // ========================================================================
  // Verse Position Mapping
  // ========================================================================

  /**
   * Get the verse ID at a specific character position in the book text
   */
  getVerseIdAtPosition(
    document: string,
    division: string,
    position: number
  ): VerseId | undefined;

  /**
   * Get verse position information
   */
  getVersePosition(
    document: string,
    division: string,
    verseId: VerseId
  ): BibleSearchVersePosition | undefined;

  /**
   * Get all verses that overlap a character position range
   */
  getVersesInRange(
    document: string,
    division: string,
    startPos: number,
    endPos: number
  ): BibleSearchVersePosition[];

  /**
   * Batch insert verse positions (for indexing)
   */
  batchInsertVersePositions(positions: BibleSearchVersePosition[]): void;

  // ========================================================================
  // Saved Searches
  // ========================================================================

  /**
   * Save a search query
   */
  saveSearch(search: SavedSearch): SavedSearch;

  /**
   * Get all saved searches
   */
  getSavedSearches(): SavedSearch[];

  /**
   * Get a saved search by ID
   */
  getSavedSearch(searchId: number): SavedSearch | undefined;

  /**
   * Update a saved search
   */
  updateSavedSearch(search: SavedSearch): SavedSearch;

  /**
   * Delete a saved search
   */
  deleteSavedSearch(searchId: number): boolean;

  /**
   * Get recently used saved searches
   */
  getRecentSavedSearches(limit?: number): SavedSearch[];

  /**
   * Get most frequently used saved searches
   */
  getPopularSavedSearches(limit?: number): SavedSearch[];

}
