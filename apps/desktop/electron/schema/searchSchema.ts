/**
 * Centralized search database schema.
 *
 * All search-related tables (saved searches, history) are defined here.
 * Applied to main.db.
 *
 * Used to also create a library-wide `bible_search_index` FTS5 table with
 * `bible_search_index_metadata` and `bible_search_verse_positions`
 * companions -- the runtime-DDL mirror of `MainDatabase.sql`'s former
 * section 3.1-3.3 (see that file's canonical schema and the removal note in
 * `IBibleSearchRepository.ts`). Task 0026 subtask M12 deleted all three: the
 * table had zero production callers, and the design had already chosen
 * per-module sidecars (task 0027 subtask F6) over ever building a
 * library-wide provider on top of it.
 */
import type { ISql } from '@bible/core';

/**
 * Create all search tables and indexes.
 * Safe to call multiple times (idempotent via IF NOT EXISTS).
 */
export function initializeSearchSchema(db: ISql): void {
  // --- Saved Searches --------------------------------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS saved_search (
      search_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      search_type TEXT NOT NULL,
      scope TEXT,
      options TEXT,
      created_date TEXT NOT NULL,
      last_used TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT
    )
  `);

  // --- Search History --------------------------------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS search_history (
      history_id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      search_type TEXT NOT NULL,
      result_count INTEGER NOT NULL DEFAULT 0,
      searched_date TEXT NOT NULL,
      metadata TEXT
    )
  `);

  // --- Indexes ---------------------------------------------------------
  db.execute('CREATE INDEX IF NOT EXISTS idx_saved_search_date ON saved_search(created_date DESC)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_search_history_date ON search_history(searched_date DESC)');
}
