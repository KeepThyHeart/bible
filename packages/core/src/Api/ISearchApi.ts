import type { SearchResult, IndexStatus, VerseSearchResult } from './ApiTypes';

/**
 * Unified search operations - text search, semantic search, saved searches.
 *
 * Future: Search methods should accept an optional PassageRange[] to limit
 * results by book, testament, or arbitrary verse ranges. Keyword search can
 * filter via SQL WHERE; semantic search may need post-retrieval filtering.
 */
export interface ISearchApi {
  // --- Text Search ------------------------------------------------
  performSearch(query: string, modules: string[], options?: {
    limit?: number;
    offset?: number;
  }): Promise<SearchResult>;

  // --- Index Management -------------------------------------------
  getIndexStatus(module: string): Promise<IndexStatus>;
  buildIndex(module: string): Promise<void>;

  // --- Saved Searches ---------------------------------------------
  getSavedSearches(): Promise<Array<{
    savedSearchId: number;
    name: string;
    query: string;
    modules: string[];
  }>>;
  saveSearch(name: string, query: string, modules: string[]): Promise<number>;
  deleteSavedSearch(savedSearchId: number): Promise<void>;

  // No search history: the app does not record what users search for.

  // --- Semantic Search --------------------------------------------
  isSemanticSearchAvailable(): Promise<boolean>;
  semanticSearch(query: string, options?: {
    limit?: number;
    threshold?: number;
  }): Promise<VerseSearchResult[]>;
}
