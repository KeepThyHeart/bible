import { ISql, SqlParameter } from '../Core/ISql';
import { BibleVerse, InterlinearWord, parseWordPositionList } from '../Models/Bible/BibleVerse';
import { BibleModuleInfo } from '../Models/Bible/BibleModuleInfo';
import { VerseId, BookNumber } from '../Core/Types';
import { BibleSearchVersePosition } from '../Models/Main/BibleSearchVersePosition';
import { IBibleRepository } from './IBibleRepository';
import { BaseModuleRepository, mapModuleIdentity, buildIdentityAssignments } from './BaseModuleRepository';
import { ModuleInfoRow, BibleVerseRow, InterlinearWordRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField, parseBoolField } from '../Core/JsonHelpers';
import { isReadOnlyDatabaseError } from '../Core/Errors';
import { parseVerseFormatting, stringifyVerseFormatting } from '../Text';

/**
 * Repository for Bible translation module databases (bible_*.db)
 *
 * This repository handles ALL operations for a Bible translation database:
 * - Module information (metadata about the translation)
 * - Bible verses (the actual text)
 * - Interlinear data (for original language texts)
 *
 * @example
 * ```typescript
 * const kjvDb = new SqliteProvider('data/modules/bible_kjv.db');
 * const repo = new BibleRepository(kjvDb);
 *
 * // Get module info
 * const info = repo.getModuleInfo();
 * console.log(info.getDisplayName());
 *
 * // Get verses
 * const verse = repo.getVerse(43003016); // John 3:16
 * const chapter = repo.getChapter(43, 3); // John 3
 * ```
 */
export class BibleRepository extends BaseModuleRepository<BibleModuleInfo> implements IBibleRepository {
  constructor(sql: ISql) { super(sql); }

  // ========================================================================
  // Module Info Operations
  // ========================================================================

  /**
   * Update the module information.
   *
   * The identity + provenance block is written alongside the legacy columns that are
   * touched. See {@link buildIdentityAssignments}.
   */
  updateModuleInfo(info: BibleModuleInfo): void {
    const identity = buildIdentityAssignments(info);
    this.sql.execute(
      `UPDATE module_info SET
        abbreviation = ?, full_name = ?, copyright = ?, description = ?,
        language_code = ?, year_published = ?, publisher = ?, metadata = ?${identity.sql}
      WHERE info_id = 1`,
      [
        info.abbreviation,
        info.fullName,
        info.copyright ?? null,
        info.description ?? null,
        info.languageCode,
        info.yearPublished ?? null,
        info.publisher ?? null,
        stringifyJsonField(info.metadata),
        ...identity.params
      ]
    );
  }

  // ========================================================================
  // Column selection
  // ========================================================================

  /**
   * The explicit `bible_verse` column list.
   */
  private verseColumns(): string {
    return 'verse_id, text, formatting, word_count, metadata';
  }

  // ========================================================================
  // Verse Operations
  // ========================================================================

  /**
   * Get a single verse by its calculated verse ID.
   *
   * @param verseId - Calculated verse ID (book * 1000000 + chapter * 1000 + verse).
   *                  Use {@link VerseIdHelper.calculate} to compute this value.
   * @returns The verse data, or undefined if the verse does not exist in this module
   */
  getVerse(verseId: VerseId): BibleVerse | undefined {
    const row = this.sql.queryOne<BibleVerseRow>(
      'SELECT * FROM bible_verse WHERE verse_id = ?',
      [verseId]
    );

    return row ? this.mapRowToVerse(row) : undefined;
  }

  /**
   * Get multiple verses by their IDs in a single query.
   * Returns only verse text data (no interlinear). Useful for batch display
   * in topical indexes, cross-references, etc.
   *
   * @param verseIds - Array of calculated verse IDs
   * @returns Map of verse ID to BibleVerse for found verses
   */
  getVerseTexts(verseIds: VerseId[]): Map<VerseId, BibleVerse> {
    const result = new Map<VerseId, BibleVerse>();
    if (verseIds.length === 0) return result;

    // SQLite has a limit on the number of variables in a query (default 999).
    // Batch into chunks to stay within limits.
    const CHUNK_SIZE = 500;
    for (let i = 0; i < verseIds.length; i += CHUNK_SIZE) {
      const chunk = verseIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.sql.queryAll<BibleVerseRow>(
        `SELECT ${this.verseColumns()}
         FROM bible_verse WHERE verse_id IN (${placeholders})`,
        chunk
      );
      for (const row of rows) {
        result.set(row.verse_id, this.mapRowToVerse(row));
      }
    }
    return result;
  }

  /**
   * Get all verses within a verse ID range (inclusive).
   *
   * @param startVerseId - Starting verse ID (inclusive)
   * @param endVerseId - Ending verse ID (inclusive)
   * @returns Array of verses ordered by verse ID
   */
  getVerseRange(startVerseId: VerseId, endVerseId: VerseId): BibleVerse[] {
    const rows = this.sql.queryAll<BibleVerseRow>(
      `SELECT * FROM bible_verse
       WHERE verse_id BETWEEN ? AND ?
       ORDER BY verse_id`,
      [startVerseId, endVerseId]
    );

    return rows.map(row => this.mapRowToVerse(row));
  }

  /**
   * Get all verses for a chapter
   *
   * @example
   * ```typescript
   * // Using book number
   * const verses1 = repo.getChapter(43, 3); // John 3
   *
   * // Using Book enum
   * const verses2 = repo.getChapter(Book.John, 3); // John 3
   * ```
   */
  getChapter(book: BookNumber, chapter: number): BibleVerse[] {
    const bookNumber = typeof book === 'number' ? book : book as number;
    const startId = bookNumber * 1000000 + chapter * 1000;
    const endId = bookNumber * 1000000 + chapter * 1000 + 999;

    return this.getVerseRange(startId, endId);
  }

  /**
   * Get all verses for a book
   *
   * @example
   * ```typescript
   * // Using book number
   * const verses1 = repo.getBook(43); // Book of John
   *
   * // Using Book enum
   * const verses2 = repo.getBook(Book.John); // Book of John
   * ```
   */
  getBook(book: BookNumber): BibleVerse[] {
    const bookNumber = typeof book === 'number' ? book : book as number;
    const startId = bookNumber * 1000000 + 1;
    const endId = bookNumber * 1000000 + 999999;

    return this.getVerseRange(startId, endId);
  }

  /**
   * Search verses using SQLite FTS5 full-text search.
   *
   * Queries the verse-level FTS5 index (porter stemming + unicode61 tokenizer).
   * Supports all FTS5 query syntax: AND, OR, NOT, quoted phrases, prefix matching.
   *
   * @param query - FTS5 query string (e.g., "faith AND works", "\"grace of God\"")
   * @param options - Optional search configuration
   * @param options.limit - Maximum results to return (default 100)
   * @returns Array of matching verses ordered by verse ID
   */
  searchVerses(query: string, options?: { limit?: number }): BibleVerse[] {
    const limit = options?.limit ?? 100;

    const rows = this.sql.queryAll<BibleVerseRow>(
      `SELECT v.* FROM bible_verse v
       JOIN bible_verse_fts fts ON v.verse_id = fts.rowid
       WHERE bible_verse_fts MATCH ?
       ORDER BY v.verse_id
       LIMIT ?`,
      [query, limit]
    );

    return rows.map(row => this.mapRowToVerse(row));
  }

  /**
   * Search verses with FTS5 highlighting
   * Returns verses with matched terms highlighted using FTS5's highlight() function.
   * This correctly highlights stemmed variants (e.g., searching "walk" highlights "walking", "walked").
   *
   * @param query - FTS5 query string
   * @param options - Search options (limit)
   * @returns Array of objects with verse data and highlighted text
   */
  searchVersesWithHighlighting(
    query: string,
    options?: { limit?: number }
  ): Array<{
    verse: BibleVerse;
    highlightedText: string;
    highlightedPlainText: string;
  }> {
    const limit = options?.limit ?? 100;

    // `bible_verse_fts` is (verse_id UNINDEXED, text), so `text` is column 1.
    // Column ordering is load-bearing for highlight(), which returns '' rather
    // than raising when handed a column index that is not there.
    const textColumn = 1;

    const rows = this.sql.queryAll<BibleVerseRow>(
      `SELECT
         v.*,
         highlight(bible_verse_fts, ${textColumn}, '<strong><u>', '</u></strong>') as highlighted_text
       FROM bible_verse v
       JOIN bible_verse_fts fts ON v.verse_id = fts.rowid
       WHERE bible_verse_fts MATCH ?
       ORDER BY v.verse_id
       LIMIT ?`,
      [query, limit]
    );

    return rows.map(row => {
      const verse = this.mapRowToVerse(row);
      // `highlight()` returns '' rather than raising when the column is not
      // where we expected, and the verse's own text is already in this row. An
      // unhighlighted result is a small loss; a blank one is the whole verse.
      const highlighted = (row.highlighted_text as string) || verse.text || '';
      return {
        verse,
        highlightedText: highlighted,
        highlightedPlainText: highlighted
      };
    });
  }

  /**
   * Get verses with section headings.
   *
   * The heading lives at `formatting.block.heading`.
   */
  getVersesWithHeadings(): BibleVerse[] {
    const rows = this.sql.queryAll<BibleVerseRow>(
      `SELECT * FROM bible_verse
       WHERE formatting LIKE ?
       ORDER BY verse_id`,
      ['%"heading"%']
    );

    return rows.map(row => this.mapRowToVerse(row));
  }

  /**
   * Get total verse count
   */
  getVerseCount(): number {
    const row = this.sql.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM bible_verse'
    );
    return row?.count ?? 0;
  }

  /**
   * Get which books have content in this module
   * Returns an array of book numbers (1-66) that have at least one verse
   */
  getCoveredBooks(): number[] {
    const rows = this.sql.queryAll<{ book_number: number }>(
      'SELECT DISTINCT verse_id / 1000000 as book_number FROM bible_verse ORDER BY book_number'
    );
    return rows.map(r => r.book_number);
  }

  /**
   * Create a new verse (for module creation/import).
   *
   * Writes the structured {@link VerseFormatting} payload,
   * serialized by the shared `stringifyVerseFormatting`. Only the destination
   * written to the `formatting` column. drop the column selection.
   */
  createVerse(verse: BibleVerse): BibleVerse {
    const { columns, values } = this.verseWriteColumns(verse);
    const placeholders = columns.map(() => '?').join(', ');

    this.sql.execute(
      `INSERT INTO bible_verse (verse_id, ${columns.join(', ')})
       VALUES (?, ${placeholders})`,
      [verse.verseId, ...values]
    );

    return verse;
  }

  /**
   * Update an existing verse.
   */
  updateVerse(verse: BibleVerse): BibleVerse {
    const { columns, values } = this.verseWriteColumns(verse);
    const assignments = columns.map(c => `${c} = ?`).join(', ');

    this.sql.execute(
      `UPDATE bible_verse SET ${assignments} WHERE verse_id = ?`,
      [...values, verse.verseId]
    );

    return verse;
  }

  /**
   * Build the writable `bible_verse` column list and matching values.
   *
   * Column names are literals here; all values bind as parameters.
   */
  private verseWriteColumns(verse: BibleVerse): { columns: string[]; values: SqlParameter[] } {
    return {
      columns: ['text', 'formatting', 'word_count', 'metadata'],
      values: [
        verse.text,
        stringifyVerseFormatting(verse.formatting),
        verse.wordCount ?? null,
        stringifyJsonField(verse.metadata)
      ]
    };
  }

  /**
   * Delete a verse
   */
  deleteVerse(verseId: VerseId): boolean {
    const result = this.sql.execute(
      'DELETE FROM bible_verse WHERE verse_id = ?',
      [verseId]
    );
    return result.changes > 0;
  }

  /**
   * Batch insert multiple verses within a single transaction.
   * Significantly faster than calling {@link createVerse} individually.
   *
   * @param verses - Array of BibleVerse objects to insert
   */
  batchInsertVerses(verses: BibleVerse[]): void {
    this.sql.transaction(() => {
      for (const verse of verses) {
        this.createVerse(verse);
      }
    });
  }

  // ========================================================================
  // Search Index Support
  // ========================================================================

  /**
   * Get complete book text for indexing
   * Returns concatenated plain text of all verses in the book with spaces between verses
   */
  getBookTextForIndex(book: BookNumber): string {
    const bookNumber = typeof book === 'number' ? book : book as number;
    const verses = this.getBook(bookNumber);

    // Concatenate all verse text with spaces
    // Use text_plain if available, otherwise fall back to text
    return verses
      .map(v => v.textPlain || v.text)
      .join(' ');
  }

  /**
   * Get verse positions within book text for indexing
   * Returns an array of BibleSearchVersePosition objects mapping each verse to its
   * character positions in the concatenated book text
   *
   * @deprecated Use buildBookIndex() instead for module-level indexing
   */
  getBookVersePositions(book: BookNumber, moduleAbbr: string): BibleSearchVersePosition[] {
    const bookNumber = typeof book === 'number' ? book : book as number;
    const verses = this.getBook(bookNumber);

    const positions: BibleSearchVersePosition[] = [];
    let currentPosition = 0;

    for (const verse of verses) {
      const text = verse.textPlain || verse.text;
      const startIndex = currentPosition;
      const endIndex = currentPosition + text.length;

      positions.push(new BibleSearchVersePosition({
        type: 'bible',
        document: moduleAbbr,
        division: bookNumber.toString(),
        verseId: verse.verseId,
        startIndex,
        endIndex,
      }));

      // Add 1 for the space between verses
      currentPosition = endIndex + 1;
    }

    return positions;
  }

  // ========================================================================
  // Book-Level Search Index (Module-Level)
  // ========================================================================

  /**
   * Ensure the book-level search tables exist, returning whether they are
   * usable.
   *
   * R-12: these tables are a DERIVED INDEX, not module content. They are not in
   * from the shipped schema - they existed with zero rows in all 53 bible
   * shipped modules - and a module is an immutable artifact carrying a
   * `content_sha256`, so creating tables inside one both invalidates that hash
   * and mutates a file the user may treat as read-only.
   *
   * This therefore never throws. On a read-only database it reports `false` and
   * the read paths degrade to "not indexed", so proximity search falls back to
   * ordinary verse search instead of crashing the caller.
   *
   * @returns true when the tables are present and usable.
   */
  ensureSearchTablesExist(): boolean {
    const tableExists = this.sql.queryOne(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='book_search_metadata'
    `);

    if (tableExists) {
      return true;
    }

    try {
      this.createBookSearchTables();
      return true;
    } catch (e) {
      // Read-only module (the normal case for a shipped file). Not an error:
      // the index is a cache, and its absence only costs proximity search.
      if (isReadOnlyDatabaseError(e)) {
        return false;
      }
      throw e;
    }
  }

  /**
   * Create book search tables if they don't exist
   * This runs the schema from BibleTranslation.sql
   */
  private createBookSearchTables(): void {
    // Create FTS5 table
    this.sql.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS book_search_index USING fts5(
        book_number UNINDEXED,
        text,
        tokenize='porter unicode61'
      )
    `);

    // Create metadata table
    this.sql.execute(`
      CREATE TABLE IF NOT EXISTS book_search_metadata (
        metadata_id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_number INTEGER NOT NULL UNIQUE,
        is_indexed INTEGER DEFAULT 0,
        last_indexed TEXT,
        verse_count INTEGER,
        char_count INTEGER,
        metadata TEXT,
        CHECK (book_number > 0 AND book_number <= 66),
        CHECK (is_indexed IN (0, 1))
      )
    `);

    this.sql.execute(`
      CREATE INDEX IF NOT EXISTS idx_book_search_indexed
      ON book_search_metadata(is_indexed, book_number)
    `);

    // Create verse positions table
    this.sql.execute(`
      CREATE TABLE IF NOT EXISTS verse_positions (
        position_id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_number INTEGER NOT NULL,
        verse_id INTEGER NOT NULL,
        start_index INTEGER NOT NULL,
        end_index INTEGER NOT NULL,
        FOREIGN KEY (verse_id) REFERENCES bible_verse(verse_id) ON DELETE CASCADE,
        CHECK (book_number > 0 AND book_number <= 66),
        CHECK (start_index >= 0),
        CHECK (end_index > start_index)
      )
    `);

    this.sql.execute(`
      CREATE INDEX IF NOT EXISTS idx_verse_position_lookup
      ON verse_positions(book_number, verse_id)
    `);

    this.sql.execute(`
      CREATE INDEX IF NOT EXISTS idx_verse_position_range
      ON verse_positions(book_number, start_index, end_index)
    `);
  }

  /**
   * Check if a specific book is indexed for proximity search
   */
  isBookIndexed(bookNumber: number): boolean {
    // No index table (read-only module) means simply "not indexed".
    if (!this.ensureSearchTablesExist()) return false;

    const row = this.sql.queryOne<{ is_indexed: number }>(
      'SELECT is_indexed FROM book_search_metadata WHERE book_number = ?',
      [bookNumber]
    );

    return parseBoolField(row?.is_indexed);
  }

  /**
   * Build search index for a specific book
   * This indexes the entire book text for proximity searches
   */
  buildBookIndex(bookNumber: number): void {
    // Building the index is an explicit request, so failing to create the tables
    // IS an error here - unlike the read paths, which degrade quietly.
    if (!this.ensureSearchTablesExist()) {
      throw new Error(
        `buildBookIndex(${bookNumber}): cannot create the book search index - this module ` +
        `database is read-only. A module is an immutable artifact; build the index ` +
        `against a writable copy, or open the module read-write if that is intended.`
      );
    }

    const bookText = this.getBookTextForIndex(bookNumber);
    const verses = this.getBook(bookNumber);

    this.sql.transaction(() => {
      // 1. Delete existing index if any
      this.sql.execute('DELETE FROM book_search_index WHERE book_number = ?', [bookNumber]);
      this.sql.execute('DELETE FROM verse_positions WHERE book_number = ?', [bookNumber]);

      // 2. Insert or update metadata
      this.sql.execute(`
        INSERT OR REPLACE INTO book_search_metadata
        (book_number, is_indexed, last_indexed, verse_count, char_count)
        VALUES (?, 1, ?, ?, ?)
      `, [bookNumber, new Date().toISOString(), verses.length, bookText.length]);

      // 3. Insert into FTS5
      this.sql.execute(`
        INSERT INTO book_search_index (book_number, text)
        VALUES (?, ?)
      `, [bookNumber, bookText]);

      // 4. Insert verse positions
      let currentPosition = 0;
      for (const verse of verses) {
        const text = verse.textPlain || verse.text;
        const startIndex = currentPosition;
        const endIndex = currentPosition + text.length;

        this.sql.execute(`
          INSERT INTO verse_positions (book_number, verse_id, start_index, end_index)
          VALUES (?, ?, ?, ?)
        `, [bookNumber, verse.verseId, startIndex, endIndex]);

        currentPosition = endIndex + 1; // +1 for space between verses
      }
    });
  }

  /**
   * Get verse ID at a specific character position in book text
   */
  getVerseIdAtPosition(bookNumber: number, position: number): VerseId | undefined {
    const row = this.sql.queryOne<{ verse_id: number }>(
      `SELECT verse_id FROM verse_positions
       WHERE book_number = ? AND start_index <= ? AND end_index > ?
       LIMIT 1`,
      [bookNumber, position, position]
    );
    return row?.verse_id;
  }

  /**
   * Get verse position range
   */
  getVersePosition(bookNumber: number, verseId: VerseId): { startIndex: number; endIndex: number } | undefined {
    const row = this.sql.queryOne<{ start_index: number; end_index: number }>(
      `SELECT start_index, end_index FROM verse_positions
       WHERE book_number = ? AND verse_id = ?`,
      [bookNumber, verseId]
    );
    return row ? { startIndex: row.start_index, endIndex: row.end_index } : undefined;
  }

  /**
   * Search book text using FTS5 with custom query (e.g., NEAR for proximity)
   * Note: offsets() doesn't work with NEAR queries, so we return empty offsets
   */
  searchBookFTS5(bookNumber: number, fts5Query: string): Array<{ bookNumber: number; text: string; offsets: string }> {
    // Without the index there is nothing to match; callers fall back to ordinary
    // verse search rather than failing.
    if (!this.ensureSearchTablesExist()) return [];

    // Check if this is a NEAR query (offsets() doesn't work with NEAR)
    const isNearQuery = fts5Query.toUpperCase().includes('NEAR(');

    if (isNearQuery) {
      // For NEAR queries, we can't use offsets()
      const rows = this.sql.queryAll(
        `SELECT book_number, text
         FROM book_search_index
         WHERE book_search_index MATCH ? AND book_number = ?`,
        [fts5Query, bookNumber]
      );

      return rows.map(row => ({
        bookNumber: row.book_number as number,
        text: row.text as string,
        offsets: '' // Empty offsets for NEAR queries
      }));
    } else {
      // For non-NEAR queries, use offsets()
      const rows = this.sql.queryAll(
        `SELECT book_number, text, offsets(book_search_index) as match_offsets
         FROM book_search_index
         WHERE book_search_index MATCH ? AND book_number = ?`,
        [fts5Query, bookNumber]
      );

      return rows.map(row => ({
        bookNumber: row.book_number as number,
        text: row.text as string,
        offsets: row.match_offsets as string
      }));
    }
  }

  /**
   * Find all verses in a book where all search terms appear within a word-proximity window.
   *
   * **Algorithm overview:**
   *
   * 1. **Tokenize** -- The entire book text (all verses concatenated) is lowercased and
   *    split into words. This gives a flat word-position array spanning the whole book.
   *
   * 2. **Build term position index** -- For each search term, record every word index
   *    where it appears (exact match or prefix match). This produces a Map<term, number[]>
   *    of word positions per term.
   *
   * 3. **Early exit** -- If any term has zero occurrences in the book, return immediately
   *    (all terms must be present for a proximity match).
   *
   * 4. **Sliding anchor scan** ({@link findProximityMatches}) -- Iterate over each occurrence
   *    of the first term as an "anchor" position. For each anchor, check whether every other
   *    term has at least one occurrence within maxDistance words (using linear scan with
   *    `Array.some`). If all terms are nearby, the anchor is recorded as a match.
   *
   * 5. **Expand to nearby terms** -- For each match, collect ALL word positions from ALL
   *    terms that fall within the proximity window. This ensures that if the matching terms
   *    span multiple verses, all relevant verses are included in the result.
   *
   * 6. **Word-to-verse mapping** -- Convert each word position back to a character offset
   *    (by joining preceding words), then look up which verse contains that character offset
   *    using the verse_positions table (populated by {@link buildBookIndex}).
   *
   * **Time complexity:** O(W * T * P) where W = occurrences of the first term, T = number
   * of terms, P = max occurrences of any other term. The word-to-character conversion in
   * step 6 is O(W_total * W_avg) due to the `words.slice(0, pos).join(' ')` call per position.
   *
   * **Known limitations:**
   * - Prefix matching ("walk" matches "walking") may produce false positives for short terms.
   * - The word-to-character position conversion rebuilds substrings for each match, which
   *   is expensive for books with many proximity matches. A precomputed word-offset array
   *   would improve this to O(1) per lookup.
   * - The algorithm anchors on the first term only. A term with very few occurrences in a
   *   non-first position won't benefit from early pruning.
   *
   * @param bookNumber - Book number (1-66) to search within
   * @param terms - Array of search terms (at least 2 terms expected)
   * @param maxDistance - Maximum number of words allowed between any two terms
   * @returns Sorted array of verse IDs where all terms appear within proximity
   */
  searchProximityInBook(bookNumber: number, terms: string[], maxDistance: number): VerseId[] {
    // Step 1: Tokenize the entire book text into a flat word array
    const bookText = this.getBookTextForIndex(bookNumber).toLowerCase();
    const words = bookText.split(/\s+/);

    // Step 2: Build a position index -- for each term, record all word indices where it appears
    const termPositions: Map<string, number[]> = new Map();
    for (const term of terms) {
      termPositions.set(term.toLowerCase(), []);
    }

    for (let i = 0; i < words.length; i++) {
      const word = words[i].replace(/[^\w]/g, ''); // Strip punctuation for matching
      for (const term of terms) {
        // Match exact word or prefix (e.g., "walk" matches "walking")
        if (word === term.toLowerCase() || word.startsWith(term.toLowerCase())) {
          const positions = termPositions.get(term.toLowerCase());
          if (positions) positions.push(i);
        }
      }
    }

    // Step 3: Early exit if any term is missing entirely from the book
    for (const positions of termPositions.values()) {
      if (positions.length === 0) {
        return [];
      }
    }

    // Step 4: Find anchor positions where all terms are within maxDistance words
    const matchingWordPositions = this.findProximityMatches(Array.from(termPositions.values()), maxDistance);

    // Steps 5-6: Expand each match to collect all nearby term positions, then map to verse IDs
    const matchingVerseIds = new Set<VerseId>();

    for (const wordPos of matchingWordPositions) {
      // Collect all word positions from all terms that fall within the proximity window
      const nearbyPositions = new Set<number>();
      nearbyPositions.add(wordPos);

      for (const positions of termPositions.values()) {
        for (const pos of positions) {
          if (Math.abs(pos - wordPos) <= maxDistance) {
            nearbyPositions.add(pos);
          }
        }
      }

      // Convert word positions to character offsets, then resolve to verse IDs
      for (const pos of nearbyPositions) {
        // Reconstruct character offset from word position (expensive -- see limitations above)
        const charPos = words.slice(0, pos).join(' ').length + (pos > 0 ? 1 : 0);

        const verseId = this.getVerseIdAtPosition(bookNumber, charPos);
        if (verseId) {
          matchingVerseIds.add(verseId);
        }
      }
    }

    return Array.from(matchingVerseIds).sort((a, b) => a - b);
  }

  /**
   * Find all word positions where all terms appear within maxDistance words.
   *
   * Uses a simple anchor-and-scan approach: iterates over each occurrence of
   * the first term, then checks whether every other term has at least one
   * occurrence within maxDistance. This is O(P0 * sum(Pi)) where P0 is the
   * occurrence count of the first term and Pi are the counts of other terms.
   *
   * @param termPositions - Array of arrays, where each inner array is the sorted
   *                        word positions for one search term
   * @param maxDistance - Maximum word distance between the anchor and any other term
   * @returns Array of anchor word positions where all terms are within proximity
   */
  private findProximityMatches(termPositions: number[][], maxDistance: number): number[] {
    const matches: number[] = [];

    // For each occurrence of the first term
    for (const firstPos of termPositions[0]) {
      // Check if all other terms appear within maxDistance words
      let allTermsNearby = true;

      for (let i = 1; i < termPositions.length; i++) {
        const otherTermPositions = termPositions[i];

        // Check if any occurrence of this term is within range
        const hasNearbyOccurrence = otherTermPositions.some(pos =>
          Math.abs(pos - firstPos) <= maxDistance
        );

        if (!hasNearbyOccurrence) {
          allTermsNearby = false;
          break;
        }
      }

      if (allTermsNearby) {
        matches.push(firstPos);
      }
    }

    return matches;
  }


  // ========================================================================
  // Interlinear Operations
  // ========================================================================

  /**
   * Get interlinear words for a specific verse (original language texts only)
   * Returns empty array if no interlinear data exists
   */
  getInterlinearWords(verseId: VerseId): InterlinearWord[] {
    const rows = this.sql.queryAll<InterlinearWordRow>(
      `SELECT * FROM interlinear_word
       WHERE verse_id = ?
       ORDER BY word_position_start`,
      [verseId]
    );

    return rows.map(row => this.mapRowToInterlinearWord(row));
  }

  /**
   * Get interlinear words for all verses in a chapter (batch query)
   * Much more efficient than calling getInterlinearWords() per verse
   * Returns a Map of verse_id to InterlinearWord[]
   */
  getInterlinearWordsForChapter(book: BookNumber, chapter: number): Map<VerseId, InterlinearWord[]> {
    const bookNumber = typeof book === 'number' ? book : book as number;
    const startId = bookNumber * 1000000 + chapter * 1000 + 1;
    const endId = bookNumber * 1000000 + chapter * 1000 + 999;

    const rows = this.sql.queryAll<InterlinearWordRow>(
      `SELECT * FROM interlinear_word
       WHERE verse_id BETWEEN ? AND ?
       ORDER BY verse_id, word_position_start`,
      [startId, endId]
    );

    const result = new Map<VerseId, InterlinearWord[]>();
    for (const row of rows) {
      const word = this.mapRowToInterlinearWord(row);
      const verseId = row.verse_id as VerseId;
      if (!result.has(verseId)) {
        result.set(verseId, []);
      }
      const words = result.get(verseId);
      if (words) words.push(word);
    }

    return result;
  }

  /**
   * Check if this module has interlinear data
   * Checks if the interlinear_word table exists and has data
   * Uses EXISTS for fast O(1) check instead of COUNT(*) which scans all rows
   */
  hasInterlinearData(): boolean {
    try {
      const row = this.sql.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM sqlite_master
         WHERE type='table' AND name='interlinear_word'`
      );

      if (!row || row.count === 0) {
        return false;
      }

      // Use SELECT 1 ... LIMIT 1 for fast existence check (stops after first row)
      // instead of COUNT(*) which scans all rows (349K+ for KJV)
      const dataRow = this.sql.queryOne<{ has_data: number }>(
        'SELECT 1 as has_data FROM interlinear_word LIMIT 1'
      );

      return dataRow !== undefined;
    } catch (error) {
      return false;
    }
  }

  // ========================================================================
  // Strong's Number Search Operations
  // ========================================================================

  /**
   * Find all verse IDs containing a given Strong's number.
   * Accepts multiple format variants to handle variable zero-padding.
   */
  searchByStrongsNumber(strongsVariants: string[], range?: { startVerseId: number; endVerseId: number }): VerseId[] {
    if (strongsVariants.length === 0) return [];

    if (!this.hasInterlinearData()) return [];

    const placeholders = strongsVariants.map(() => '?').join(', ');
    let query = `SELECT DISTINCT verse_id FROM interlinear_word WHERE strongs_number IN (${placeholders})`;
    const params: (string | number)[] = [...strongsVariants];

    if (range) {
      query += ' AND verse_id BETWEEN ? AND ?';
      params.push(range.startVerseId, range.endVerseId);
    }

    query += ' ORDER BY verse_id';

    const rows = this.sql.queryAll<{ verse_id: number }>(query, params);
    return rows.map(row => row.verse_id);
  }

  /**
   * Get the distinct English glosses for a Strong's number.
   * Returns the most common gloss first.
   */
  getGlossesForStrongs(strongsVariants: string[]): string[] {
    if (strongsVariants.length === 0) return [];

    if (!this.hasInterlinearData()) return [];

    const placeholders = strongsVariants.map(() => '?').join(', ');
    const rows = this.sql.queryAll<{ gloss: string; cnt: number }>(
      `SELECT gloss, COUNT(*) as cnt FROM interlinear_word
       WHERE strongs_number IN (${placeholders}) AND gloss IS NOT NULL AND gloss != ''
       GROUP BY gloss ORDER BY cnt DESC`,
      [...strongsVariants]
    );

    return rows.map(row => row.gloss);
  }

  // ========================================================================
  // Private Mapping Methods
  // ========================================================================

  protected mapRowToModuleInfo(row: ModuleInfoRow): BibleModuleInfo {
    return new BibleModuleInfo({
      ...mapModuleIdentity(row),
      infoId: row.info_id,
      abbreviation: row.abbreviation,
      fullName: row.full_name,
      languageCode: row.language_code,
      yearPublished: row.year_published,
      copyright: row.copyright,
      description: row.description,
      publisher: row.publisher,
      version: row.version,
      createdDate: row.created_date,
      metadata: parseJsonField(row.metadata)
    });
  }

  /**
   * Map a `bible_verse` row.
   */
  private mapRowToVerse(row: BibleVerseRow): BibleVerse {
    return new BibleVerse({
      verseId: row.verse_id,
      text: row.text,
      // There is no `text_plain` column: `text` is exactly what `text_plain`
      // was trying to be. The deprecated field is kept populated so consumers
      // outside this package (desktop/web renderers, extension DTOs) keep
      // working unchanged.
      textPlain: row.text,
      formatting: parseVerseFormatting(row.formatting),
      wordCount: row.word_count,
      metadata: parseJsonField(row.metadata)
    });
  }

  private mapRowToInterlinearWord(row: InterlinearWordRow): InterlinearWord {
    return new InterlinearWord({
      extraSpans: parseWordPositionList(row.extra_word_positions),
      interlinearId: row.interlinear_id,
      verseId: row.verse_id,
      wordPositionStart: row.word_position_start,
      wordPositionEnd: row.word_position_end,
      // better-sqlite3 hands back JS null for a NULL column; normalise to undefined.
      originalWord: row.original_word ?? undefined,
      transliteration: row.transliteration,
      strongsNumber: row.strongs_number,
      morphology: row.morphology,
      lemma: row.lemma,
      gloss: row.gloss,
      metadata: parseJsonField(row.metadata)
    });
  }
}
