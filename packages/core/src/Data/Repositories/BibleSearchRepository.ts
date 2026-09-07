import { ISql, SqlParameter } from '../Core/ISql';
import { VerseId } from '../Core/Types';
import { BibleSearchIndex } from '../Models/Main/BibleSearchIndex';
import { BibleSearchVersePosition } from '../Models/Main/BibleSearchVersePosition';
import { SavedSearch, SearchType } from '../Models/Main/SavedSearch';
import { FTS5Match } from '../../types/search';
import { IBibleSearchRepository } from './IBibleSearchRepository';
import { BibleSearchIndexRow, BibleSearchVersePositionRow, SavedSearchRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField, parseBoolField } from '../Core/JsonHelpers';

/**
 * Bible Search Repository
 *
 * Implements search index operations for book-level proximity searching,
 * verse position mapping, saved searches, and search history.
 *
 * This repository operates on main.db tables:
 * - bible_search_index (FTS5 virtual table)
 * - bible_search_index_metadata
 * - bible_search_verse_positions
 * - saved_search
 * - search_history
 */
export class BibleSearchRepository implements IBibleSearchRepository {
  constructor(private sql: ISql) {}

  // ========================================================================
  // Index Management
  // ========================================================================

  isBookIndexed(document: string, division: string): boolean {
    const row = this.sql.queryOne<{ is_indexed: number }>(
      `SELECT is_indexed FROM bible_search_index_metadata
       WHERE type = 'bible' AND document = ? AND division = ?`,
      [document, division]
    );
    return parseBoolField(row?.is_indexed);
  }

  getIndexMetadata(document: string, division: string): BibleSearchIndex | undefined {
    const row = this.sql.queryOne<BibleSearchIndexRow>(
      `SELECT * FROM bible_search_index_metadata
       WHERE type = 'bible' AND document = ? AND division = ?`,
      [document, division]
    );
    return row ? this.mapRowToSearchIndex(row) : undefined;
  }

  buildBookIndex(
    document: string,
    division: string,
    bookText: string,
    versePositions: BibleSearchVersePosition[]
  ): void {
    this.sql.transaction(() => {
      // 1. Insert or update index metadata
      const existing = this.getIndexMetadata(document, division);
      const now = new Date().toISOString();

      if (existing) {
        this.sql.execute(
          `UPDATE bible_search_index_metadata
           SET is_indexed = 1, last_indexed = ?
           WHERE type = 'bible' AND document = ? AND division = ?`,
          [now, document, division]
        );
      } else {
        this.sql.execute(
          `INSERT INTO bible_search_index_metadata (type, document, division, is_indexed, last_indexed)
           VALUES ('bible', ?, ?, 1, ?)`,
          [document, division, now]
        );
      }

      // 2. Insert into FTS5 virtual table
      this.sql.execute(
        `INSERT INTO bible_search_index (type, document, division, text)
         VALUES ('bible', ?, ?, ?)`,
        [document, division, bookText]
      );

      // 3. Batch insert verse positions
      this.batchInsertVersePositions(versePositions);
    });
  }

  clearBookIndex(document: string, division: string): void {
    this.sql.execute(
      `UPDATE bible_search_index_metadata
       SET is_indexed = 0
       WHERE type = 'bible' AND document = ? AND division = ?`,
      [document, division]
    );
  }

  deleteBookIndex(document: string, division: string): void {
    this.sql.transaction(() => {
      // Delete from FTS5 table
      this.sql.execute(
        `DELETE FROM bible_search_index
         WHERE type = 'bible' AND document = ? AND division = ?`,
        [document, division]
      );

      // Delete verse positions
      this.sql.execute(
        `DELETE FROM bible_search_verse_positions
         WHERE type = 'bible' AND document = ? AND division = ?`,
        [document, division]
      );

      // Delete metadata
      this.sql.execute(
        `DELETE FROM bible_search_index_metadata
         WHERE type = 'bible' AND document = ? AND division = ?`,
        [document, division]
      );
    });
  }

  getUnindexedBooks(document: string): BibleSearchIndex[] {
    const rows = this.sql.queryAll<BibleSearchIndexRow>(
      `SELECT * FROM bible_search_index_metadata
       WHERE type = 'bible' AND document = ? AND is_indexed = 0
       ORDER BY division`,
      [document]
    );
    return rows.map(row => this.mapRowToSearchIndex(row));
  }

  getIndexedBooks(document: string): BibleSearchIndex[] {
    const rows = this.sql.queryAll<BibleSearchIndexRow>(
      `SELECT * FROM bible_search_index_metadata
       WHERE type = 'bible' AND document = ? AND is_indexed = 1
       ORDER BY division`,
      [document]
    );
    return rows.map(row => this.mapRowToSearchIndex(row));
  }

  // ========================================================================
  // Proximity Search (Book-Level FTS5)
  // ========================================================================

  searchProximity(
    document: string,
    terms: string[],
    maxDistance: number,
    division?: string
  ): FTS5Match[] {
    // Build FTS5 NEAR query: NEAR(term1 term2, maxDistance)
    const nearQuery = `NEAR(${terms.join(' ')}, ${maxDistance})`;
    return this.searchFTS5(document, nearQuery, division);
  }

  searchPhrase(document: string, phrase: string, division?: string): FTS5Match[] {
    // FTS5 phrase query uses double quotes
    const phraseQuery = `"${phrase}"`;
    return this.searchFTS5(document, phraseQuery, division);
  }

  searchFTS5(document: string, fts5Query: string, division?: string): FTS5Match[] {
    // First, query FTS5 with offsets() to get match positions
    let sql = `
      SELECT
        bsi.rowid,
        bsi.division,
        bsi.text,
        offsets(bible_search_index) as match_offsets
      FROM bible_search_index bsi
      WHERE bible_search_index MATCH ?
        AND bsi.type = 'bible'
        AND bsi.document = ?
    `;

    const params: SqlParameter[] = [fts5Query, document];

    if (division) {
      sql += ` AND bsi.division = ?`;
      params.push(division);
    }

    sql += ` ORDER BY bsi.division`;

    const rows = this.sql.queryAll(sql, params);

    // Process each matching book and extract verses
    const matchMap = new Map<number, FTS5Match>();

    for (const row of rows) {
      const bookDivision = row.division as string;
      const offsetsStr = row.match_offsets as string;

      if (!offsetsStr) continue;

      // Parse FTS5 offsets: space-separated groups of 4 integers
      // Format: <column> <term> <offset> <size> ...
      const offsets = offsetsStr.split(' ').map(s => parseInt(s, 10));

      // Extract unique character positions where matches occur
      const matchPositions = new Set<number>();
      for (let i = 0; i < offsets.length; i += 4) {
        // offsets[i]     = column (always 3 for 'text' column in our schema)
        // offsets[i + 1] = term index
        // offsets[i + 2] = byte offset in text
        // offsets[i + 3] = byte length
        const byteOffset = offsets[i + 2];
        matchPositions.add(byteOffset);
      }

      // For each match position, find which verse(s) it belongs to
      for (const position of matchPositions) {
        const verseId = this.getVerseIdAtPosition(document, bookDivision, position);

        if (verseId && !matchMap.has(verseId)) {
          // Get the verse text from the full book text
          const versePosition = this.getVersePosition(document, bookDivision, verseId);
          let verseText = '';

          if (versePosition) {
            verseText = (row.text as string).substring(
              versePosition.startIndex,
              versePosition.endIndex
            );
          }

          matchMap.set(verseId, {
            verseId,
            text: verseText,
            matchPositions: Array.from(matchPositions).filter(pos => {
              // Only include positions that fall within this verse
              return versePosition && pos >= versePosition.startIndex && pos < versePosition.endIndex;
            }),
          });
        }
      }
    }

    return Array.from(matchMap.values());
  }

  // ========================================================================
  // Verse Position Mapping
  // ========================================================================

  getVerseIdAtPosition(
    document: string,
    division: string,
    position: number
  ): VerseId | undefined {
    const row = this.sql.queryOne<{ verse_id: number }>(
      `SELECT verse_id FROM bible_search_verse_positions
       WHERE type = 'bible' AND document = ? AND division = ?
         AND start_index <= ? AND end_index > ?
       LIMIT 1`,
      [document, division, position, position]
    );
    return row?.verse_id;
  }

  getVersePosition(
    document: string,
    division: string,
    verseId: VerseId
  ): BibleSearchVersePosition | undefined {
    const row = this.sql.queryOne<BibleSearchVersePositionRow>(
      `SELECT * FROM bible_search_verse_positions
       WHERE type = 'bible' AND document = ? AND division = ? AND verse_id = ?`,
      [document, division, verseId]
    );
    return row ? this.mapRowToVersePosition(row) : undefined;
  }

  getVersesInRange(
    document: string,
    division: string,
    startPos: number,
    endPos: number
  ): BibleSearchVersePosition[] {
    const rows = this.sql.queryAll<BibleSearchVersePositionRow>(
      `SELECT * FROM bible_search_verse_positions
       WHERE type = 'bible' AND document = ? AND division = ?
         AND NOT (end_index <= ? OR start_index >= ?)
       ORDER BY start_index`,
      [document, division, startPos, endPos]
    );
    return rows.map(row => this.mapRowToVersePosition(row));
  }

  batchInsertVersePositions(positions: BibleSearchVersePosition[]): void {
    this.sql.transaction(() => {
      for (const pos of positions) {
        this.sql.execute(
          `INSERT INTO bible_search_verse_positions
           (type, document, division, verse_id, start_index, end_index)
           VALUES ('bible', ?, ?, ?, ?, ?)`,
          [pos.document, pos.division, pos.verseId, pos.startIndex, pos.endIndex]
        );
      }
    });
  }

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

  private mapRowToSearchIndex(row: BibleSearchIndexRow): BibleSearchIndex {
    return new BibleSearchIndex({
      indexId: row.index_id,
      type: row.type,
      document: row.document!,
      division: row.division!,
      lastIndexed: row.last_indexed,
      isIndexed: parseBoolField(row.is_indexed),
      metadata: parseJsonField(row.metadata),
    });
  }

  private mapRowToVersePosition(row: BibleSearchVersePositionRow): BibleSearchVersePosition {
    return new BibleSearchVersePosition({
      positionId: row.position_id,
      type: row.type,
      document: row.document!,
      division: row.division!,
      verseId: row.verse_id,
      startIndex: row.start_index,
      endIndex: row.end_index,
    });
  }

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
