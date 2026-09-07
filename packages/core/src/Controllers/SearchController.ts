import { ISearchService } from '../Services/ISearchService';
import { SearchQueryParser } from '../Services/SearchQueryParser';
import { SearchResult, SearchOptions, SavedSearch } from '../types/search';
import { IBibleSearchRepository } from '../Data/Repositories/IBibleSearchRepository';

/**
 * Search Controller
 *
 * Coordinates search operations between the UI and service layer.
 * Handles:
 * - Reference detection (navigation vs search)
 * - Search execution with loading states
 * - Saved searches management
 * - Search history
 * - Index building progress
 */
export class SearchController {
  private parser: SearchQueryParser;
  // Guards against concurrent searches - FTS5 queries can be expensive, and
  // overlapping searches cause confusing result interleaving in the UI.
  private isSearching: boolean = false;
  private currentQuery: string = '';

  constructor(
    private searchService: ISearchService,
    private searchRepo: IBibleSearchRepository
  ) {
    this.parser = new SearchQueryParser();
  }

  // ========================================================================
  // Main Search Operations
  // ========================================================================

  /**
   * Determine if query is a Bible reference or a search query
   * Returns { isReference: boolean, query: string }
   */
  detectQueryType(query: string): { isReference: boolean; query: string } {
    const isRef = this.parser.isReference(query);
    return {
      isReference: isRef,
      query: query.trim(),
    };
  }

  /**
   * Perform search
   * Returns search results or throws error
   */
  async performSearch(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    if (this.isSearching) {
      throw new Error('Search already in progress');
    }

    try {
      this.isSearching = true;
      this.currentQuery = query;

      // Validate query
      const validation = this.parser.validate(query);
      if (validation) {
        throw new Error(validation);
      }

      // Perform search
      const results = await this.searchService.search(query, options);

      return results;
    } finally {
      // Reset in finally so the guard clears even if search throws -
      // otherwise a failed search would permanently block future searches.
      this.isSearching = false;
    }
  }

  /**
   * Get search suggestions for autocomplete
   */
  async getSuggestions(partialQuery: string, limit?: number): Promise<string[]> {
    return this.searchService.getSuggestions(partialQuery, limit);
  }

  /**
   * Cancel current search (if supported)
   */
  cancelSearch(): void {
    // Future: implement cancellation token
    this.isSearching = false;
  }

  /**
   * Check if currently searching
   */
  getIsSearching(): boolean {
    return this.isSearching;
  }

  /**
   * Get current query
   */
  getCurrentQuery(): string {
    return this.currentQuery;
  }

  // ========================================================================
  // Saved Searches
  // ========================================================================

  /**
   * Save current search
   */
  saveCurrentSearch(name: string, options: SearchOptions): SavedSearch {
    const parsed = this.parser.parse(this.currentQuery);

    const savedSearch = new SavedSearch({
      name,
      query: this.currentQuery,
      searchType: parsed.searchType,
      scope: {
        scope: options.scope || 'currentModule',
        modules: options.modules,
        range: options.range,
      },
      options: {
        caseSensitive: options.caseSensitive,
        wholeWord: options.wholeWord,
        fuzzyDistance: options.fuzzyDistance,
        proximityDistance: options.proximityDistance,
        maxResults: options.maxResults,
        includeContext: options.includeContext,
        autoFuzzy: options.autoFuzzy,
      },
    });

    return this.searchRepo.saveSearch(savedSearch);
  }

  /**
   * Get all saved searches
   */
  getSavedSearches(): SavedSearch[] {
    return this.searchRepo.getSavedSearches();
  }

  /**
   * Load a saved search (returns query and options)
   */
  loadSavedSearch(searchId: number): { query: string; options: SearchOptions } | undefined {
    const saved = this.searchRepo.getSavedSearch(searchId);
    if (!saved) return undefined;

    // Mark as used
    saved.markAsUsed();
    this.searchRepo.updateSavedSearch(saved);

    return {
      query: saved.query,
      options: {
        ...saved.options,
        scope: saved.scope.scope,
        modules: saved.scope.modules,
        range: saved.scope.range,
      },
    };
  }

  /**
   * Delete a saved search
   */
  deleteSavedSearch(searchId: number): boolean {
    return this.searchRepo.deleteSavedSearch(searchId);
  }

  /**
   * Get recently used saved searches
   */
  getRecentSavedSearches(limit?: number): SavedSearch[] {
    return this.searchRepo.getRecentSavedSearches(limit);
  }

  /**
   * Get most popular saved searches
   */
  getPopularSavedSearches(limit?: number): SavedSearch[] {
    return this.searchRepo.getPopularSavedSearches(limit);
  }

  // ========================================================================
  // Index Management
  // ========================================================================

  /**
   * Get index status for modules
   */
  async getIndexStatus(modules: string[]): Promise<Map<string, {
    indexed: boolean;
    lastIndexed?: string;
    booksIndexed?: number;
    totalBooks?: number;
  }>> {
    return this.searchService.getIndexStatus(modules);
  }

  /**
   * Build search index for modules
   * Returns promise that resolves when complete
   * Calls onProgress callback with updates
   */
  async buildIndex(
    modules: string[],
    onProgress?: (progress: {
      module: string;
      current: number;
      total: number;
      bookName: string;
    }) => void
  ): Promise<void> {
    for (const module of modules) {
      await this.searchService.buildIndex(
        module,
        undefined, // Index all books
        (progress) => {
          if (onProgress) {
            onProgress({
              module,
              ...progress,
            });
          }
        }
      );
    }
  }

  /**
   * Check if indexing is needed for proximity search
   */
  async needsIndexing(modules: string[]): Promise<boolean> {
    const status = await this.getIndexStatus(modules);

    for (const [_, moduleStatus] of status) {
      if (!moduleStatus.indexed) {
        return true;
      }
    }

    return false;
  }

  // ========================================================================
  // Query Helpers
  // ========================================================================

  /**
   * Validate a search query
   * Returns error message if invalid, undefined if valid
   */
  validateQuery(query: string): string | undefined {
    return this.parser.validate(query);
  }

  /**
   * Get spelling suggestions for query
   */
  getSpellingSuggestions(query: string): string[] {
    return this.parser.getSuggestions(query);
  }

  /**
   * Parse query to determine search type
   */
  parseQuery(query: string) {
    return this.parser.parse(query);
  }

  /**
   * Extract phrases from query
   */
  extractPhrases(query: string): string[] {
    return this.parser.extractPhrases(query);
  }
}
