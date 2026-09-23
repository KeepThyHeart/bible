import { SavedSearch } from '../Models/Main/SavedSearch';

/**
 * Interface for Bible Search Repository
 *
 * Handles saved searches and search history against main.db.
 *
 * This interface used to also cover book-level FTS5 index management,
 * proximity/phrase search and verse position mapping over a library-wide
 * `bible_search_index` table in main.db (schema sections 3.1-3.3). Task 0026
 * ("Swappable Data Access") subtask M12 removed that half: it had zero
 * production callers (proximity search is served per module by
 * `BibleRepository`'s own `book_search_index`, and keyword search generally
 * by the `SidecarFts5Provider`/`keyword_index` registry -- see task 0027,
 * "Module Format v2", subtask F6), and the design's own decision record
 * (task 0026 report, section 07) chose per-module sidecars over ever
 * building a library-wide provider on top of this table. If a real need for
 * a library-wide index resurfaces, that is a new `IKeywordIndexProvider`
 * (`SharedFts5Provider`), not a revival of these methods.
 */
export interface IBibleSearchRepository {
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
