import { ISql } from '../Core/ISql';
import { RepositoryQueryOptions } from '../Core/IRepository';
import { UserNote, VerseLink } from '../Models/User/UserNote';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import {
  VerseId, NoteType, ContentFormat, Visibility, LinkType, assertNoteType,
  resolveOptionalRangeEnd
} from '../Core/Types';
import { IUserNoteRepository, NoteSummary } from './IUserNoteRepository';
import { verseRangeContainsPoint, verseRangeOverlapsRange } from '../Core/VerseRangeQuery';
import { UserNoteRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';
import { buildSafeOrderBy, buildPagination } from '../Core/SafeQuery';
import { VerseLinkRepository } from './VerseLinkRepository';

/** Columns allowed in ORDER BY for user_note queries */
const USER_NOTE_COLUMNS = new Set(['modified_date', 'created_date', 'title', 'note_type', 'entry_date']);

/**
 * Project a unified `verse_link` row onto the legacy note-link shape.
 *
 * The unified table has no `word_start` / `word_end` columns, so those 0-based
 * inclusive word offsets round-trip through `metadata`.
 */
function verseLinkRecordToNoteLink(record: VerseLinkRecord, noteId: number): VerseLink {
  const meta = record.metadata as Record<string, unknown> | undefined;
  const wordStart = typeof meta?.wordStart === 'number' ? meta.wordStart : undefined;
  const wordEnd = typeof meta?.wordEnd === 'number' ? meta.wordEnd : undefined;

  return {
    linkId: record.linkId,
    noteId,
    verseIdStart: record.verseIdStart,
    verseIdEnd: record.verseIdEnd,
    // `cross_reference` is not part of the note-link vocabulary; fold it to the
    // nearest legacy value rather than emitting a type the interface forbids.
    linkType: record.linkType === 'cross_reference' ? 'reference' : record.linkType,
    wordStart,
    wordEnd,
    metadata: record.metadata
  };
}

/** Project the legacy note-link shape onto a unified `verse_link` row. */
function noteLinkToVerseLinkRecord(link: VerseLink, noteId: number, sortOrder: number): VerseLinkRecord {
  const metadata: Record<string, unknown> = { ...(link.metadata ?? {}) };
  if (link.wordStart !== undefined) metadata.wordStart = link.wordStart;
  if (link.wordEnd !== undefined) metadata.wordEnd = link.wordEnd;

  return new VerseLinkRecord({
    sourceType: 'note',
    sourceId: noteId,
    verseIdStart: link.verseIdStart,
    verseIdEnd: link.verseIdEnd,
    linkType: link.linkType as LinkType,
    sortOrder,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  });
}

/**
 * Repository for user note entities stored in a user database (user_*.db).
 *
 * Provides CRUD operations, verse-based queries, hierarchical note trees,
 * full-text search, and navigation helpers for the user_note table.
 * Notes support multiple types (verse_note, document, prayer, journal)
 * and can be linked to verses via the note_verse_link table.
 *
 * @example
 * ```typescript
 * const userDb = new SqliteProvider('data/users/user_john.db');
 * const noteRepo = new UserNoteRepository(userDb);
 *
 * // Get notes for a specific verse
 * const notes = noteRepo.getForVerse(43003016); // John 3:16
 *
 * // Create a new verse note
 * const note = new UserNote({
 *   verseIdStart: 43003016,
 *   content: '<p>This verse teaches...</p>',
 *   contentFormat: 'html',
 *   noteType: 'verse_note',
 *   visibility: 'private'
 * });
 * noteRepo.create(note);
 * ```
 */
export class UserNoteRepository implements IUserNoteRepository {
  /** Access to the unified `verse_link` table. */
  private readonly verseLinks: VerseLinkRepository;

  constructor(private sql: ISql) {
    this.verseLinks = new VerseLinkRepository(sql);
  }

  /**
   * Get a note by ID, including its linked verses and child notes.
   *
   * @param id - The note_id to look up
   * @returns The note with linked verses and children loaded, or undefined if not found
   */
  getById(id: number): UserNote | undefined {
    const row = this.sql.queryOne<UserNoteRow>(
      'SELECT * FROM user_note WHERE note_id = ?',
      [id]
    );

    if (!row) return undefined;

    const note = this.mapRowToEntity(row);
    this.loadLinkedVerses(note);
    this.loadChildNotes(note);
    return note;
  }

  /**
   * Get all notes
   */
  getAll(options?: RepositoryQueryOptions): UserNote[] {
    let sql = 'SELECT * FROM user_note';

    sql += buildSafeOrderBy(options?.orderBy, options?.orderDirection, USER_NOTE_COLUMNS, { column: 'modified_date', direction: 'DESC' });

    sql += buildPagination(options?.limit, options?.offset);

    const rows = this.sql.queryAll<UserNoteRow>(sql);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get notes by type
   */
  getByType(noteType: NoteType): UserNote[] {
    const rows = this.sql.queryAll<UserNoteRow>(
      'SELECT * FROM user_note WHERE note_type = ? ORDER BY modified_date DESC',
      [noteType]
    );

    const notes = rows.map(row => this.mapRowToEntity(row));

    // For prayers, sort by sortOrder from metadata if available
    if (noteType === 'prayer') {
      notes.sort((a, b) => {
        const sortOrderA = typeof a.metadata?.sortOrder === 'number' ? a.metadata.sortOrder : Number.MAX_SAFE_INTEGER;
        const sortOrderB = typeof b.metadata?.sortOrder === 'number' ? b.metadata.sortOrder : Number.MAX_SAFE_INTEGER;
        return sortOrderA - sortOrderB;
      });
    }

    return notes;
  }

  /**
   * Get all notes that cover a specific verse.
   * Matches notes where verseIdStart <= verseId <= verseIdEnd (range-aware).
   *
   * @param verseId - The calculated verse ID to find notes for
   * @returns Array of notes ordered by most recently modified first
   */
  getForVerse(verseId: VerseId): UserNote[] {
    const range = verseRangeContainsPoint('verse_id_start', 'verse_id_end', verseId);
    const rows = this.sql.queryAll<UserNoteRow>(
      `SELECT * FROM user_note
       WHERE ${range.sql}
       ORDER BY modified_date DESC`,
      range.params
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get all notes that overlap with a verse range.
   * Uses range-overlap logic: a note matches if its verse range intersects with
   * the query range (not just containment).
   *
   * @param startVerseId - Start of the query range (inclusive)
   * @param endVerseId - End of the query range (inclusive)
   * @returns Array of notes ordered by starting verse, then most recently modified
   */
  getForVerseRange(startVerseId: VerseId, endVerseId: VerseId): UserNote[] {
    const range = verseRangeOverlapsRange('verse_id_start', 'verse_id_end', startVerseId, endVerseId);
    const rows = this.sql.queryAll<UserNoteRow>(
      `SELECT * FROM user_note
       WHERE ${range.sql}
       ORDER BY verse_id_start, modified_date DESC`,
      range.params
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get top-level notes (no parent)
   */
  getTopLevelNotes(): UserNote[] {
    const rows = this.sql.queryAll<UserNoteRow>(
      'SELECT * FROM user_note WHERE parent_note_id IS NULL ORDER BY modified_date DESC'
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get child notes for a parent note
   */
  getChildNotes(parentNoteId: number): UserNote[] {
    const rows = this.sql.queryAll<UserNoteRow>(
      'SELECT * FROM user_note WHERE parent_note_id = ? ORDER BY created_date',
      [parentNoteId]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Full-text search across note content using SQLite FTS5.
   *
   * @param query - FTS5 query string (supports AND, OR, NOT, quoted phrases)
   * @returns Array of matching notes ordered by most recently modified first
   */
  search(query: string): UserNote[] {
    const rows = this.sql.queryAll<UserNoteRow>(
      `SELECT n.* FROM user_note n
       JOIN user_note_fts fts ON n.note_id = fts.rowid
       WHERE user_note_fts MATCH ?
       ORDER BY n.modified_date DESC`,
      [query]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get notes by tag
   */
  getByTag(tag: string): UserNote[] {
    const rows = this.sql.queryAll<UserNoteRow>(
      `SELECT * FROM user_note WHERE tags LIKE ? ORDER BY modified_date DESC`,
      [`%"${tag}"%`]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  getModifiedSince(since: string, limit?: number): UserNote[] {
    if (limit) {
      const rows = this.sql.queryAll<UserNoteRow>(
        `SELECT * FROM user_note WHERE modified_date > ? ORDER BY modified_date DESC LIMIT ?`,
        [since, limit]
      );
      return rows.map(row => this.mapRowToEntity(row));
    }
    const rows = this.sql.queryAll<UserNoteRow>(
      `SELECT * FROM user_note WHERE modified_date > ? ORDER BY modified_date DESC`,
      [since]
    );
    return rows.map(row => this.mapRowToEntity(row));
  }

  // ========================================================================
  // Navigation Operations
  // ========================================================================

  /**
   * Get the next verse ID that has a note
   */
  getNextVerseWithContent(currentVerseId: VerseId): VerseId | undefined {
    const row = this.sql.queryOne(
      `SELECT DISTINCT verse_id_start FROM user_note
       WHERE verse_id_start > ? AND verse_id_start IS NOT NULL
       ORDER BY verse_id_start ASC
       LIMIT 1`,
      [currentVerseId]
    );

    return row ? (row.verse_id_start as number) : undefined;
  }

  /**
   * Get the previous verse ID that has a note
   */
  getPreviousVerseWithContent(currentVerseId: VerseId): VerseId | undefined {
    const row = this.sql.queryOne(
      `SELECT DISTINCT verse_id_start FROM user_note
       WHERE verse_id_start < ? AND verse_id_start IS NOT NULL
       ORDER BY verse_id_start DESC
       LIMIT 1`,
      [currentVerseId]
    );

    return row ? (row.verse_id_start as number) : undefined;
  }

  /**
   * Get all note summaries for tree view/navigation
   */
  getAllNoteSummaries(): NoteSummary[] {
    const rows = this.sql.queryAll(
      `SELECT note_id, verse_id_start, verse_id_end, title, modified_date
       FROM user_note
       WHERE verse_id_start IS NOT NULL AND note_type = 'verse_note'
       ORDER BY verse_id_start`
    );

    return rows.map(row => ({
      noteId: row.note_id as number,
      verseIdStart: row.verse_id_start as number,
      verseIdEnd: row.verse_id_end as number | undefined,
      title: row.title as string | undefined,
      modifiedDate: row.modified_date as string
    }));
  }

  /**
   * Get verse IDs that have non-empty notes within a range.
   * Used for displaying note indicator icons in the Bible text view.
   *
   * Filters out whitespace-only notes (e.g., empty HTML like `<p></p>`)
   * by stripping HTML tags and checking for remaining non-whitespace content.
   *
   * @param startVerseId - Start of the verse range (inclusive)
   * @param endVerseId - End of the verse range (inclusive)
   * @returns Sorted array of verse IDs that have substantive notes
   */
  getVersesWithNotesInRange(startVerseId: VerseId, endVerseId: VerseId): VerseId[] {
    const rows = this.sql.queryAll(
      `SELECT DISTINCT verse_id_start, content FROM user_note
       WHERE verse_id_start IS NOT NULL
         AND note_type = 'verse_note'
         AND verse_id_start >= ? AND verse_id_start <= ?
       ORDER BY verse_id_start`,
      [startVerseId, endVerseId]
    );

    // Filter out whitespace-only notes (strip HTML and check for content)
    return rows
      .filter(row => {
        const content = row.content as string | null;
        if (!content) return false;
        // Strip HTML tags and check if any non-whitespace remains
        const textOnly = content.replace(/<[^>]*>/g, '').trim();
        return textOnly.length > 0;
      })
      .map(row => row.verse_id_start as number);
  }

  // ========================================================================
  // CRUD Operations
  // ========================================================================

  /**
   * Create a new note and persist it to the database.
   * Automatically sets created_date and modified_date if not provided.
   * Also saves any linked verses attached to the note.
   *
   * @param entity - The UserNote to create (noteId will be set from the insert result)
   * @returns The same entity with noteId populated
   */
  create(entity: UserNote): UserNote {
    // Wrap the note row + its verse-link tables in one transaction so a crash
    // between statements can't leave the link tables disagreeing with the note
    // (A5). better-sqlite3 nests this with a savepoint under saveLinkedVerses'
    // own transaction, so nesting is safe.
    return this.sql.transaction(() => {
      const result = this.sql.execute(
        `INSERT INTO user_note (
          user_commentary_id, parent_note_id, verse_id_start, verse_id_end,
          title, content, content_format, note_type, document_type, visibility,
          created_date, modified_date, tags, series_name, entry_date, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entity.userCommentaryId ?? null,
          entity.parentNoteId ?? null,
          entity.verseIdStart ?? null,
          // R-1: user_note's anchor is optional, but the two columns move together.
          resolveOptionalRangeEnd(entity.verseIdStart, entity.verseIdEnd),
          entity.title ?? null,
          entity.content,
          entity.contentFormat,
          assertNoteType(entity.noteType),
          entity.documentType ?? null,
          entity.visibility,
          entity.createdDate ?? new Date().toISOString(),
          entity.modifiedDate ?? new Date().toISOString(),
          stringifyJsonField(entity.tags),
          entity.seriesName ?? null,
          entity.entryDate ?? null,
          stringifyJsonField(entity.metadata)
        ]
      );

      entity.noteId = result.lastInsertRowId;

      // Insert linked verses
      this.saveLinkedVerses(entity);

      return entity;
    });
  }

  /**
   * Update an existing note in the database.
   * Automatically updates the modified_date via {@link UserNote.touch}.
   * Replaces all linked verses (deletes existing, inserts current).
   *
   * @param entity - The UserNote to update (must have noteId set)
   * @returns The updated entity
   * @throws Error if entity.noteId is not set
   */
  update(entity: UserNote): UserNote {
    if (!entity.noteId) {
      throw new Error('Cannot update note without ID');
    }
    // Capture the narrowed id - inside the transaction closure below TypeScript
    // can no longer prove entity.noteId is non-undefined.
    const noteId = entity.noteId;

    entity.touch();

    // One transaction for the note row + its verse-link tables so a crash
    // between statements can't desync them (A5). Nesting under
    // saveLinkedVerses' own transaction is savepoint-safe in better-sqlite3.
    return this.sql.transaction(() => {
      this.sql.execute(
        `UPDATE user_note SET
          user_commentary_id = ?, parent_note_id = ?, verse_id_start = ?, verse_id_end = ?,
          title = ?, content = ?, content_format = ?, note_type = ?, document_type = ?,
          visibility = ?, modified_date = ?, tags = ?, series_name = ?, entry_date = ?,
          metadata = ?
        WHERE note_id = ?`,
        [
          entity.userCommentaryId ?? null,
          entity.parentNoteId ?? null,
          entity.verseIdStart ?? null,
          // R-1: user_note's anchor is optional, but the two columns move together.
          resolveOptionalRangeEnd(entity.verseIdStart, entity.verseIdEnd),
          entity.title ?? null,
          entity.content,
          entity.contentFormat,
          assertNoteType(entity.noteType),
          entity.documentType ?? null,
          entity.visibility,
          entity.modifiedDate ?? null,
          stringifyJsonField(entity.tags),
          entity.seriesName ?? null,
          entity.entryDate ?? null,
          stringifyJsonField(entity.metadata),
          noteId
        ]
      );

      // Update linked verses
      this.saveLinkedVerses(entity);

      return entity;
    });
  }

  /**
   * Count all descendants (children, grandchildren, ...) of a note.
   *
   * `user_note.parent_note_id` is `ON DELETE CASCADE`, so deleting this note
   * silently removes its whole subtree. Callers use this to warn/confirm before
   * a cascade delete (A6). Returns 0 when the note has no children.
   */
  countDescendants(noteId: number): number {
    const row = this.sql.queryOne<{ count: number }>(
      `WITH RECURSIVE descendants(id) AS (
         SELECT note_id FROM user_note WHERE parent_note_id = ?
         UNION ALL
         SELECT n.note_id FROM user_note n
         JOIN descendants d ON n.parent_note_id = d.id
       )
       SELECT COUNT(*) AS count FROM descendants`,
      [noteId]
    );
    return row?.count ?? 0;
  }

  /**
   * Delete a note
   */
  delete(id: number): boolean {
    const result = this.sql.execute('DELETE FROM user_note WHERE note_id = ?', [id]);
    return result.changes > 0;
  }

  /**
   * Load the verses linked to a note from the unified `verse_link` table.
   */
  private loadLinkedVerses(note: UserNote): void {
    if (!note.noteId) return;

    const links = this.verseLinks
      .getForSource('note', note.noteId)
      .map(record => verseLinkRecordToNoteLink(record, note.noteId as number));
    note.setLinkedVerses(links);
  }

  /**
   * Save linked verses for a note (replace-all).
   */
  private saveLinkedVerses(note: UserNote): void {
    const noteId = note.noteId;
    if (!noteId) return;

    const links = note.getLinkedVerses();

    this.verseLinks.deleteForSource('note', noteId);
    this.verseLinks.createMany(
      links.map((link, index) => noteLinkToVerseLinkRecord(link, noteId, index))
    );
  }

  /**
   * Load child notes for a note
   */
  private loadChildNotes(note: UserNote): void {
    if (!note.noteId) return;

    const children = this.getChildNotes(note.noteId);
    for (const child of children) {
      note.addChild(child);
    }
  }

  /**
   * Map database row to UserNote entity
   */
  private mapRowToEntity(row: UserNoteRow): UserNote {
    return new UserNote({
      noteId: row.note_id,
      userCommentaryId: row.user_commentary_id,
      parentNoteId: row.parent_note_id,
      verseIdStart: row.verse_id_start,
      verseIdEnd: row.verse_id_end,
      title: row.title,
      content: row.content as string,
      contentFormat: row.content_format as ContentFormat,
      noteType: row.note_type as NoteType,
      documentType: row.document_type,
      visibility: row.visibility as Visibility,
      createdDate: row.created_date,
      modifiedDate: row.modified_date,
      tags: parseJsonField<string[]>(row.tags) ?? [],
      seriesName: row.series_name,
      entryDate: row.entry_date,
      metadata: parseJsonField(row.metadata)
    });
  }
}
