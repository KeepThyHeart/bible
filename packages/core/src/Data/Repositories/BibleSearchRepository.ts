import { ISql } from '../Core/ISql';
import { SavedSearch, SearchType } from '../Models/Main/SavedSearch';
import { IBibleSearchRepository } from './IBibleSearchRepository';
import { SavedSearchRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';

/**
 * Bible Search Repository
 *
 * Implements saved searches and search history against main.db.
 *
 * This repository operates on main.db tables:
 * - saved_search
 * - search_history
 *
 * It used to also implement book-level FTS5 index management, proximity
 * search and verse position mapping over a library-wide `bible_search_index`
 * table (main.db schema sections 3.1-3.3). Task 0026 ("Swappable Data
 * Access") subtask M12 deleted that half, along with the table, its
 * `..._metadata` and `..._verse_positions` companions, `searchSchema.ts`'s
 * runtime copies of them, and the `IBibleSearchRepository` methods that
 * used them: none of it had a production caller (see that method's removal
 * in `IBibleSearchRepository.ts` for the full explanation).
 */
export class BibleSearchRepository implements IBibleSearchRepository {
  constructor(private sql: ISql) {}

  // ========================================================================
  // Saved Searches
  // ========================================================================

  saveSearch(search: SavedSearch): SavedSearch {
    const now = new Date().toISOString();

    const result = this.sql.execute(
      `INSERT INTO saved_search
       (name, query, search_type, scope, options, created_date, use_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        search.name,
        search.query,
        search.searchType,
        stringifyJsonField(search.scope),
        stringifyJsonField(search.options),
        now,
        0,
      ]
    );

    return new SavedSearch({
      ...search,
      searchId: result.lastInsertRowId,
      createdDate: now,
      useCount: 0,
    });
  }

  getSavedSearches(): SavedSearch[] {
    const rows = this.sql.queryAll<SavedSearchRow>(
      `SELECT * FROM saved_search ORDER BY name`
    );
    return rows.map(row => this.mapRowToSavedSearch(row));
  }

  getSavedSearch(searchId: number): SavedSearch | undefined {
    const row = this.sql.queryOne<SavedSearchRow>(
      `SELECT * FROM saved_search WHERE search_id = ?`,
      [searchId]
    );
    return row ? this.mapRowToSavedSearch(row) : undefined;
  }

  updateSavedSearch(search: SavedSearch): SavedSearch {
    this.sql.execute(
      `UPDATE saved_search
       SET name = ?, query = ?, search_type = ?, scope = ?, options = ?,
           last_used = ?, use_count = ?, metadata = ?
       WHERE search_id = ?`,
      [
        search.name,
        search.query,
        search.searchType,
        stringifyJsonField(search.scope),
        stringifyJsonField(search.options),
        search.lastUsed ?? null,
        search.useCount,
        stringifyJsonField(search.metadata),
        search.searchId ?? null,
      ]
    );
    return search;
  }

  deleteSavedSearch(searchId: number): boolean {
    const result = this.sql.execute(
      `DELETE FROM saved_search WHERE search_id = ?`,
      [searchId]
    );
    return result.changes > 0;
  }

  getRecentSavedSearches(limit: number = 10): SavedSearch[] {
    const rows = this.sql.queryAll<SavedSearchRow>(
      `SELECT * FROM saved_search
       WHERE last_used IS NOT NULL
       ORDER BY last_used DESC
       LIMIT ?`,
      [limit]
    );
    return rows.map(row => this.mapRowToSavedSearch(row));
  }

  getPopularSavedSearches(limit: number = 10): SavedSearch[] {
    const rows = this.sql.queryAll<SavedSearchRow>(
      `SELECT * FROM saved_search
       ORDER BY use_count DESC, last_used DESC
       LIMIT ?`,
      [limit]
    );
    return rows.map(row => this.mapRowToSavedSearch(row));
  }


  // ========================================================================
  // Private Mapping Methods
  // ========================================================================

  private mapRowToSavedSearch(row: SavedSearchRow): SavedSearch {
    return new SavedSearch({
      searchId: row.search_id,
      name: row.name,
      query: row.query,
      searchType: row.search_type as SearchType,
      scope: parseJsonField(row.scope) ?? { scope: 'currentModule' },
      options: parseJsonField(row.options) ?? {},
      createdDate: row.created_date,
      lastUsed: row.last_used,
      useCount: row.use_count ?? 0,
      metadata: parseJsonField(row.metadata),
    });
  }
}
