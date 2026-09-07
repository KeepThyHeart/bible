import { ISql } from '../Core/ISql';
import { CommentaryEntry, CommentaryEntryLevel } from '../Models/Commentary/CommentaryEntry';
import { CommentaryModuleInfo } from '../Models/Commentary/CommentaryModuleInfo';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import { VerseId, assertEntryLevel, resolveOptionalRangeEnd } from '../Core/Types';
import {
  ICommentaryRepository,
  CommentaryEntrySummary,
  CommentaryEntryAnchor,
  CommentaryMentionRow,
} from './ICommentaryRepository';
import { BaseModuleRepository, mapModuleIdentity, buildIdentityAssignments } from './BaseModuleRepository';
import { ModuleInfoRow, CommentaryEntryRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';
import { verseRangeOverlapsRange, verseRangeOverlapsRangeNullable } from '../Core/VerseRangeQuery';
import { VerseLinkRepository } from './VerseLinkRepository';

/**
 * Repository for Commentary module databases (commentary_*.db)
 *
 * This repository handles ALL operations for a commentary database:
 * - Module information (metadata about the commentary)
 * - Commentary entries (the actual commentary text)
 * - Cross-references (if included)
 *
 * @example
 * ```typescript
 * const mhcDb = new SqliteProvider('data/modules/commentary_mhc.db');
 * const repo = new CommentaryRepository(mhcDb);
 *
 * // Get module info
 * const info = repo.getModuleInfo();
 * console.log(info.getDisplayName()); // "Matthew Henry's Commentary by Matthew Henry"
 *
 * // Get commentary for a verse
 * const entries = repo.getEntriesForVerse(43003016); // John 3:16
 * ```
 */
export class CommentaryRepository extends BaseModuleRepository<CommentaryModuleInfo> implements ICommentaryRepository {
  private readonly verseLinks: VerseLinkRepository;

  constructor(sql: ISql) {
    super(sql);
    this.verseLinks = new VerseLinkRepository(sql);
  }

  // ========================================================================
  // Module Info Operations
  // ========================================================================

  /**
   * Update the module information. The identity + provenance block is
   * written when the connected database has those columns.
   */
  updateModuleInfo(info: CommentaryModuleInfo): void {
    const identity = buildIdentityAssignments(info);
    this.sql.execute(
      `UPDATE module_info SET
        abbreviation = ?, full_name = ?, copyright = ?, description = ?,
        author = ?, year_published = ?, language_code = ?, metadata = ?${identity.sql}
      WHERE info_id = 1`,
      [
        info.abbreviation,
        info.fullName,
        info.copyright ?? null,
        info.description ?? null,
        info.author ?? null,
        info.yearPublished ?? null,
        info.languageCode,
        stringifyJsonField(info.metadata),
        ...identity.params
      ]
    );
  }

  // ========================================================================
  // Verse Link Operations
  // ========================================================================

  /**
   * Scripture references carried by a commentary entry.
   *
   * Read from the unified `verse_link` table (`source_type='commentary_entry'`).
   */
  getVerseLinksForEntry(entryId: number): VerseLinkRecord[] {
    return this.verseLinks.getForSource('commentary_entry', entryId);
  }

  /** Entry ids whose `verse_link` rows reference the given verse. */
  getEntryIdsReferencingVerse(verseId: VerseId): number[] {
    return this.verseLinks.getSourceIdsForVerse('commentary_entry', verseId);
  }

  // ========================================================================
  // Commentary Entry Operations
  // ========================================================================

  /**
   * Get a commentary entry by ID
   */
  getEntry(entryId: number): CommentaryEntry | undefined {
    const row = this.sql.queryOne<CommentaryEntryRow>(
      'SELECT * FROM commentary_entry WHERE entry_id = ?',
      [entryId]
    );

    return row ? this.mapRowToEntry(row) : undefined;
  }

  /**
   * Get all commentary entries for a specific verse
   */
  getEntriesForVerse(verseId: VerseId): CommentaryEntry[] {
    const rows = this.sql.queryAll<CommentaryEntryRow>(
      `SELECT * FROM commentary_entry
       WHERE (entry_level = 'verse' AND verse_id_start = ?)
          OR (entry_level IN ('passage', 'chapter') AND verse_id_start <= ? AND verse_id_end >= ?)
       ORDER BY entry_level DESC`,
      [verseId, verseId, verseId]
    );

    return rows.map(row => this.mapRowToEntry(row));
  }

  /**
   * Get entries by level (book, chapter, passage, verse)
   */
  getEntriesByLevel(level: CommentaryEntryLevel): CommentaryEntry[] {
    const rows = this.sql.queryAll<CommentaryEntryRow>(
      'SELECT * FROM commentary_entry WHERE entry_level = ? ORDER BY verse_id_start',
      [level]
    );

    return rows.map(row => this.mapRowToEntry(row));
  }

  /**
   * Get the single best-match entry for a verse (first match by verse_id_start).
   * Used by VerseLinksService for quick presence checks.
   */
  getBestEntryForVerse(verseId: VerseId): CommentaryEntry | undefined {
    const row = this.sql.queryOne<CommentaryEntryRow>(
      `SELECT * FROM commentary_entry
       WHERE verse_id_start <= ? AND (verse_id_end IS NULL OR verse_id_end >= ?)
       ORDER BY verse_id_start
       LIMIT 1`,
      [verseId, verseId]
    );
    return row ? this.mapRowToEntry(row) : undefined;
  }

  /**
   * Get entries from other verses that mention/reference this verse.
   * Returns aggregated counts per entry.
   *
   * Read from the unified `verse_link` table.
   */
  getVerseMentions(verseId: VerseId): Array<{ entryId: number; verseIdStart: number; count: number }> {
    const rows = this.sql.queryAll<{ entry_id: number; verse_id_start: number; mention_count: number }>(
      `SELECT vl.source_id AS entry_id, ce.verse_id_start, COUNT(*) as mention_count
       FROM verse_link vl
       JOIN commentary_entry ce ON vl.source_id = ce.entry_id
       WHERE vl.source_type = 'commentary_entry'
         AND vl.verse_id_start <= ? AND COALESCE(vl.verse_id_end, vl.verse_id_start) >= ?
         AND ce.verse_id_start != ?
       GROUP BY vl.source_id`,
      [verseId, verseId, verseId]
    );
    return rows.map(r => ({
      entryId: r.entry_id,
      verseIdStart: r.verse_id_start,
      count: r.mention_count
    }));
  }

  /** @inheritdoc */
  getBestEntryAnchorsForRange(startVerseId: VerseId, endVerseId: VerseId): CommentaryEntryAnchor[] {
    // The predicate is `getBestEntryForVerse`'s, widened to a range rather than
    // rewritten: `verse_id_start <= end AND (verse_id_end IS NULL OR verse_id_end >= start)`.
    // Deliberately NOT `verseRangeOverlapsRangeNullable`, whose COALESCE reads a
    // NULL end as "single verse". `getBestEntryForVerse` reads it as "open
    // ended", and this method exists to reproduce that method's answers exactly
    // - a difference here would silently change which commentaries Study mode
    // lists under a verse.
    const rows = this.sql.queryAll<Pick<
      CommentaryEntryRow,
      'entry_id' | 'verse_id_start' | 'verse_id_end' | 'entry_level'
    >>(
      `SELECT entry_id, verse_id_start, verse_id_end, entry_level
       FROM commentary_entry
       WHERE verse_id_start <= ? AND (verse_id_end IS NULL OR verse_id_end >= ?)
       ORDER BY verse_id_start`,
      [endVerseId, startVerseId]
    );

    return rows.map(row => ({
      entryId: row.entry_id,
      verseIdStart: row.verse_id_start,
      verseIdEnd: row.verse_id_end ?? undefined,
      entryLevel: assertEntryLevel(row.entry_level),
    }));
  }

  /** @inheritdoc */
  getVerseMentionRowsForRange(startVerseId: VerseId, endVerseId: VerseId): CommentaryMentionRow[] {
    const mapRows = (rows: Array<{
      entry_id: number;
      entry_verse_id_start: number;
      link_verse_id_start: number;
      link_verse_id_end: number;
    }>): CommentaryMentionRow[] => rows.map(r => ({
      entryId: r.entry_id,
      entryVerseIdStart: r.entry_verse_id_start,
      linkVerseIdStart: r.link_verse_id_start,
      linkVerseIdEnd: r.link_verse_id_end,
    }));

    const range = verseRangeOverlapsRangeNullable('vl.verse_id_start', 'vl.verse_id_end', startVerseId, endVerseId);
    return mapRows(this.sql.queryAll(
      `SELECT vl.source_id AS entry_id,
              ce.verse_id_start AS entry_verse_id_start,
              vl.verse_id_start AS link_verse_id_start,
              COALESCE(vl.verse_id_end, vl.verse_id_start) AS link_verse_id_end
       FROM verse_link vl
       JOIN commentary_entry ce ON vl.source_id = ce.entry_id
       WHERE vl.source_type = 'commentary_entry' AND ${range.sql}`,
      range.params
    ));
  }

  /**
   * Get entries for a verse range
   */
  getEntriesForRange(startVerseId: VerseId, endVerseId: VerseId): CommentaryEntry[] {
    const range = verseRangeOverlapsRange('verse_id_start', 'verse_id_end', startVerseId, endVerseId);
    const rows = this.sql.queryAll<CommentaryEntryRow>(
      `SELECT * FROM commentary_entry
       WHERE ${range.sql}
       ORDER BY verse_id_start`,
      range.params
    );

    return rows.map(row => this.mapRowToEntry(row));
  }

  /** @inheritdoc */
  getEntrySummariesForRange(startVerseId: VerseId, endVerseId: VerseId): CommentaryEntrySummary[] {
    const range = verseRangeOverlapsRange('verse_id_start', 'verse_id_end', startVerseId, endVerseId);
    // Naming the columns is the entire point - `content` is what makes the
    // equivalent SELECT * expensive.
    const rows = this.sql.queryAll<Pick<
      CommentaryEntryRow,
      'verse_id_start' | 'verse_id_end' | 'entry_level' | 'word_count'
    >>(
      `SELECT verse_id_start, verse_id_end, entry_level, word_count
       FROM commentary_entry
       WHERE ${range.sql}
       ORDER BY verse_id_start`,
      range.params
    );

    return rows.map(row => ({
      verseIdStart: row.verse_id_start,
      verseIdEnd: row.verse_id_end ?? undefined,
      entryLevel: row.entry_level as CommentaryEntryLevel,
      wordCount: row.word_count ?? undefined,
    }));
  }

  /**
   * Search commentary entries
   *
   * Note: The FTS5 index contains HTML content, so phrase searches like "Man had no claim"
   * might fail if there are HTML tags between words. We convert phrase queries to NEAR
   * queries to handle this case.
   */
  searchEntries(query: string, options?: { limit?: number }): CommentaryEntry[] {
    const limit = options?.limit ?? 100;

    // Convert quoted phrase searches to NEAR queries to handle HTML tags in content
    // "Man had no claim" becomes NEAR(Man had no claim, 5)
    let ftsQuery = query;
    const phraseMatch = query.match(/^"([^"]+)"$/);
    if (phraseMatch) {
      const words = phraseMatch[1].split(/\s+/).filter(w => w.length > 0);
      if (words.length > 1) {
        // Use NEAR with distance of 5 to allow for HTML tags between words
        ftsQuery = `NEAR(${words.join(' ')}, 5)`;
      } else {
        // Single word, just use the word without quotes
        ftsQuery = words[0];
      }
    }

    const rows = this.sql.queryAll<CommentaryEntryRow>(
      `SELECT e.* FROM commentary_entry e
       JOIN commentary_entry_fts fts ON e.entry_id = fts.rowid
       WHERE commentary_entry_fts MATCH ?
       ORDER BY e.verse_id_start
       LIMIT ?`,
      [ftsQuery, limit]
    );

    return rows.map(row => this.mapRowToEntry(row));
  }

  /**
   * Create a new commentary entry
   */
  createEntry(entry: CommentaryEntry): CommentaryEntry {
    const result = this.sql.execute(
      `INSERT INTO commentary_entry (
        verse_id_start, verse_id_end, entry_level, content, content_file, word_count, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.verseIdStart ?? null,
        // R-1: book/chapter-level entries have no range at all; where a range
        // exists, both columns are populated.
        resolveOptionalRangeEnd(entry.verseIdStart, entry.verseIdEnd),
        assertEntryLevel(entry.entryLevel),
        entry.content,
        entry.contentFile ?? null,
        entry.wordCount ?? null,
        stringifyJsonField(entry.metadata)
      ]
    );

    entry.entryId = result.lastInsertRowId;
    return entry;
  }

  /**
   * Update an existing commentary entry
   */
  updateEntry(entry: CommentaryEntry): CommentaryEntry {
    if (!entry.entryId) {
      throw new Error('Cannot update commentary entry without ID');
    }

    this.sql.execute(
      `UPDATE commentary_entry SET
        verse_id_start = ?, verse_id_end = ?, entry_level = ?, content = ?,
        content_file = ?, word_count = ?, metadata = ?
      WHERE entry_id = ?`,
      [
        entry.verseIdStart ?? null,
        // R-1: book/chapter-level entries have no range at all; where a range
        // exists, both columns are populated.
        resolveOptionalRangeEnd(entry.verseIdStart, entry.verseIdEnd),
        assertEntryLevel(entry.entryLevel),
        entry.content,
        entry.contentFile ?? null,
        entry.wordCount ?? null,
        stringifyJsonField(entry.metadata),
        entry.entryId
      ]
    );

    return entry;
  }

  /**
   * Delete a commentary entry
   */
  deleteEntry(entryId: number): boolean {
    const result = this.sql.execute(
      'DELETE FROM commentary_entry WHERE entry_id = ?',
      [entryId]
    );
    return result.changes > 0;
  }

  // ========================================================================
  // Navigation Operations
  // ========================================================================

  /**
   * Get the next verse ID that has commentary content
   */
  getNextVerseWithContent(currentVerseId: VerseId): VerseId | undefined {
    const row = this.sql.queryOne(
      `SELECT DISTINCT verse_id_start FROM commentary_entry
       WHERE verse_id_start > ?
       ORDER BY verse_id_start ASC
       LIMIT 1`,
      [currentVerseId]
    );

    return row ? (row.verse_id_start as number) : undefined;
  }

  /**
   * Get the previous verse ID that has commentary content
   */
  getPreviousVerseWithContent(currentVerseId: VerseId): VerseId | undefined {
    const row = this.sql.queryOne(
      `SELECT DISTINCT verse_id_start FROM commentary_entry
       WHERE verse_id_start < ?
       ORDER BY verse_id_start DESC
       LIMIT 1`,
      [currentVerseId]
    );

    return row ? (row.verse_id_start as number) : undefined;
  }

  /**
   * Get all entry summaries for tree view/navigation
   */
  getAllEntrySummaries(): CommentaryEntrySummary[] {
    const rows = this.sql.queryAll(
      `SELECT DISTINCT verse_id_start, verse_id_end, entry_level,
              SUM(word_count) as word_count
       FROM commentary_entry
       GROUP BY verse_id_start, verse_id_end, entry_level
       ORDER BY verse_id_start`
    );

    return rows.map(row => ({
      verseIdStart: row.verse_id_start as number,
      verseIdEnd: row.verse_id_end as number,
      entryLevel: row.entry_level as CommentaryEntryLevel,
      wordCount: row.word_count as number
    }));
  }

  // ========================================================================
  // Private Mapping Methods
  // ========================================================================

  protected mapRowToModuleInfo(row: ModuleInfoRow): CommentaryModuleInfo {
    return new CommentaryModuleInfo({
      ...mapModuleIdentity(row),
      infoId: row.info_id,
      abbreviation: row.abbreviation,
      fullName: row.full_name,
      author: row.author,
      yearPublished: row.year_published,
      copyright: row.copyright,
      description: row.description,
      languageCode: row.language_code,
      version: row.version,
      createdDate: row.created_date,
      metadata: parseJsonField(row.metadata)
    });
  }

  private mapRowToEntry(row: CommentaryEntryRow): CommentaryEntry {
    return new CommentaryEntry({
      entryId: row.entry_id,
      verseIdStart: row.verse_id_start,
      verseIdEnd: row.verse_id_end,
      entryLevel: row.entry_level as CommentaryEntryLevel,
      content: row.content as string,
      contentFile: row.content_file,
      wordCount: row.word_count,
      metadata: parseJsonField(row.metadata)
    });
  }
}
