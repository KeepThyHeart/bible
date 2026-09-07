/**
 * Saved Search Model
 *
 * Represents a user-saved search query for quick re-use.
 */

import { SearchType } from '../../Core/Types';

/**
 * Saved-search types.
 *
 * Defined in `Core/Types.ts` - the single source of truth for the open enums
 * which carry no SQL CHECK constraints.
 * Re-exported here so existing imports from this module keep working.
 */
export type { SearchType };

export type SearchScope = 'currentModule' | 'allBibles' | 'allModules' | 'allOpenModules' | 'range' | 'lastResults';

export interface SearchScopeData {
  scope: SearchScope;
  modules?: string[];           // Specific modules to search
  range?: BibleRange;          // Book/chapter/verse range
}

export interface BibleRange {
  startBook?: number;
  startChapter?: number;
  startVerse?: number;
  endBook?: number;
  endChapter?: number;
  endVerse?: number;
  predefinedRange?: string;    // "OT", "NT", "Gospels", "Pentateuch", etc.
}

export interface SearchOptions {
  // Scope options
  scope?: SearchScope;          // Search scope (currentModule, allBibles, etc.)
  modules?: string[];           // Specific modules to search
  range?: BibleRange;          // Book/chapter/verse range

  // Search behavior options
  caseSensitive?: boolean;
  wholeWord?: boolean;
  fuzzyDistance?: number;       // Edit distance for fuzzy matching (1-3)
  proximityDistance?: number;   // Default word distance for proximity
  maxResults?: number;          // Result limit (default 200)
  includeContext?: boolean;     // Include surrounding verses
  autoFuzzy?: boolean;          // Auto-fallback to fuzzy if < 10 results
  includeRelatedWords?: boolean;  // For Strong's search: include word family members
}

export class SavedSearch {
  searchId?: number;
  name: string;
  query: string;
  searchType: SearchType;
  scope: SearchScopeData;
  options: SearchOptions;
  createdDate?: string;
  lastUsed?: string;
  useCount: number;
  metadata?: Record<string, any>;

  constructor(data: {
    searchId?: number;
    name: string;
    query: string;
    searchType: SearchType;
    scope: SearchScopeData;
    options: SearchOptions;
    createdDate?: string;
    lastUsed?: string;
    useCount?: number;
    metadata?: Record<string, any>;
  }) {
    this.searchId = data.searchId;
    this.name = data.name;
    this.query = data.query;
    this.searchType = data.searchType;
    this.scope = data.scope;
    this.options = data.options;
    this.createdDate = data.createdDate;
    this.lastUsed = data.lastUsed;
    this.useCount = data.useCount ?? 0;
    this.metadata = data.metadata;
  }

  /**
   * Mark this search as used (updates lastUsed and increments useCount)
   */
  markAsUsed(): void {
    this.lastUsed = new Date().toISOString();
    this.useCount++;
  }

  /**
   * Get a display-friendly description of the search
   */
  getDescription(): string {
    let desc = `${this.searchType}: "${this.query}"`;
    if (this.scope.scope !== 'currentModule') {
      desc += ` (${this.scope.scope})`;
    }
    return desc;
  }

  /**
   * Clone this search with a new name
   */
  clone(newName: string): SavedSearch {
    return new SavedSearch({
      name: newName,
      query: this.query,
      searchType: this.searchType,
      scope: { ...this.scope },
      options: { ...this.options },
      useCount: 0,
      metadata: this.metadata ? { ...this.metadata } : undefined,
    });
  }

  /**
   * Export to JSON for storage
   */
  toJSON(): Record<string, any> {
    return {
      searchId: this.searchId,
      name: this.name,
      query: this.query,
      searchType: this.searchType,
      scope: this.scope,
      options: this.options,
      createdDate: this.createdDate,
      lastUsed: this.lastUsed,
      useCount: this.useCount,
      metadata: this.metadata,
    };
  }

  /**
   * Create from JSON
   */
  static fromJSON(json: Record<string, any>): SavedSearch {
    return new SavedSearch({
      searchId: json.searchId,
      name: json.name,
      query: json.query,
      searchType: json.searchType as SearchType,
      scope: json.scope as SearchScopeData,
      options: json.options as SearchOptions,
      createdDate: json.createdDate,
      lastUsed: json.lastUsed,
      useCount: json.useCount ?? 0,
      metadata: json.metadata,
    });
  }
}
