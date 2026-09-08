/**
 * Centralized search database schema.
 *
 * All search-related tables (FTS index, metadata, positions, saved
 * searches, history) are defined here. Applied to main.db.
 */
import type { ISql } from '@bible/core';

/**
 * Create all search tables, indexes, and FTS virtual tables.
 * Safe to call multiple times (idempotent via IF NOT EXISTS).
 */
export function initializeSearchSchema(db: ISql): void {
  // --- FTS5 Search Index ------------------------------------------------
  db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS bible_search_index USING fts5(
      type UNINDEXED,
      document UNINDEXED,
      division UNINDEXED,
      text,
      tokenize='porter unicode61'
    )
  `);

  // --- Index Metadata ---------------------------------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS bible_search_index_metadata (
      index_id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      document TEXT NOT NULL,
      division TEXT NOT NULL,
      last_indexed TEXT NOT NULL,
      is_indexed INTEGER NOT NULL DEFAULT 1,
      word_count INTEGER,
      metadata TEXT,
      UNIQUE(type, document, division),
      CHECK (is_indexed IN (0, 1))
    )
  `);

  // --- Verse Positions -------------------------------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS bible_search_verse_positions (
      position_id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      document TEXT NOT NULL,
      division TEXT NOT NULL,
      verse_id INTEGER NOT NULL,
      start_index INTEGER NOT NULL,
      end_index INTEGER NOT NULL,
      CHECK (start_index >= 0),
      CHECK (end_index > start_index)
    )
  `);

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
  db.execute('CREATE INDEX IF NOT EXISTS idx_search_metadata_type_doc ON bible_search_index_metadata(type, document)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_search_positions_verse ON bible_search_verse_positions(verse_id)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_search_positions_division ON bible_search_verse_positions(type, document, division)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_saved_search_date ON saved_search(created_date DESC)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_search_history_date ON search_history(searched_date DESC)');
}
