import { SearchResult, SearchOptions, ParsedQuery } from '../types/search';

/**
 * Search Service Interface
 *
 * Defines the contract for search services. This interface allows for
 * swapping search implementations (e.g., SQLite FTS5, Lunr.js, Elasticsearch)
 * without changing the rest of the application.
 *
 * Following the spec recommendation (line 3107) to create an interface for
 * search so implementations can be swapped seamlessly.
 */
export interface ISearchService {
  /**
   * Main search method
   * Automatically detects query type and routes to appropriate search implementation
   *
   * @param query - Search query string (can include syntax like quotes, ~N, AND/OR/NOT, etc.)
   * @param options - Search options (scope, modules, filters, etc.)
   * @returns Promise resolving to array of search results
   */
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;

  /**
   * Parse a search query to determine type and extract components
   * Handles complex syntax: "phrase" word1 word2 ~50w NOT (word3 AND word4)
   *
   * @param query - Raw search query string
   * @returns Parsed query structure
   */
  parseQuery(query: string): ParsedQuery;

  /**
   * Get autocomplete suggestions for partial query
   * Used for search box autocomplete dropdown
   *
   * @param partialQuery - Partial query string
   * @param limit - Maximum number of suggestions (default 10)
   * @returns Array of suggested query completions
   */
  getSuggestions(partialQuery: string, limit?: number): Promise<string[]>;

  /**
   * Check if modules are indexed for proximity search
   * Returns status of book-level indexes for specified modules
   *
   * @param modules - Array of module abbreviations to check
   * @returns Map of module -> index status
   */
  getIndexStatus(modules: string[]): Promise<Map<string, {
    indexed: boolean;
    lastIndexed?: string;
    booksIndexed?: number;
    totalBooks?: number;
  }>>;

  /**
   * Build search index for a module
   * Creates book-level FTS5 index for proximity searches
   *
   * @param module - Module abbreviation
   * @param books - Optional array of book numbers to index (if not provided, indexes all books)
   * @param onProgress - Optional callback for progress updates
   * @returns Promise resolving when indexing is complete
   */
  buildIndex(
    module: string,
    books?: number[],
    onProgress?: (progress: { current: number; total: number; bookName: string }) => void
  ): Promise<void>;
}
