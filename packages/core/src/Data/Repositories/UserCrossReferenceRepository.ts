import { ISql } from '../Core/ISql';
import { UserCrossReference } from '../Models/User/UserCrossReference';
import { VerseId } from '../Core/Types';
import { UserCrossReferenceRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';
import { IUserCrossReferenceRepository } from './IUserCrossReferenceRepository';

/**
 * Repository for user cross-references (user_*.db)
 *
 * Handles user-created cross-references between Bible PASSAGES: both ends are
 * inclusive ranges, with a single verse expressed as `end === start`. Lookups
 * are therefore containment probes, not equality tests - asking for John 3:16
 * returns a cross-reference recorded against John 3:14-18.
 *
 * These are stored in the user database alongside built-in cross-references.
 *
 * @example
 * ```typescript
 * const userDb = new SqliteProvider('data/users/user_john.db');
 * const repo = new UserCrossReferenceRepository(userDb);
 *
 * // Get all cross-references for John 3:16
 * const refs = repo.getForVerse(43003016);
 *
 * // Create a new cross-reference
 * const newRef = new UserCrossReference({
 *   fromVerseIdStart: 43003016,
 *   toVerseIdStart: 45008028,
 *   notes: 'Both speak of God\'s love'
 * });
 * repo.create(newRef);
 *
 * // Passage to passage - the Beatitudes to Psalm 1
 * repo.create(new UserCrossReference({
 *   fromVerseIdStart: 40005003, fromVerseIdEnd: 40005012,
 *   toVerseIdStart: 19001001, toVerseIdEnd: 19001006
 * }));
 * ```
 */
export class UserCrossReferenceRepository implements IUserCrossReferenceRepository {
  constructor(private sql: ISql) {}

  /**
   * Get a cross-reference by ID
   */
  getById(userXrefId: number): UserCrossReference | undefined {
    const row = this.sql.queryOne<UserCrossReferenceRow>(
      'SELECT * FROM user_cross_reference WHERE user_xref_id = ?',
      [userXrefId]
    );

    return row ? this.mapRowToXref(row) : undefined;
  }

  /**
   * Get all cross-references involving a specific verse (both from and to)
   */
  getForVerse(verseId: VerseId): UserCrossReference[] {
    const rows = this.sql.queryAll<UserCrossReferenceRow>(
      `SELECT * FROM user_cross_reference
       WHERE (from_verse_id_start <= ? AND from_verse_id_end >= ?)
          OR (to_verse_id_start   <= ? AND to_verse_id_end   >= ?)
       ORDER BY created_date DESC`,
      [verseId, verseId, verseId, verseId]
    );

    return rows.map(row => this.mapRowToXref(row));
  }

  /**
   * Get all cross-references originating from a specific verse
   */
  getFromVerse(fromVerseId: VerseId): UserCrossReference[] {
    const rows = this.sql.queryAll<UserCrossReferenceRow>(
      `SELECT * FROM user_cross_reference
       WHERE from_verse_id_start <= ? AND from_verse_id_end >= ?
       ORDER BY created_date DESC`,
      [fromVerseId, fromVerseId]
    );

    return rows.map(row => this.mapRowToXref(row));
  }

  /**
   * Get all cross-references pointing to a specific verse
   */
  /**
   * Get every user cross-reference whose SOURCE overlaps an inclusive verse
   * range. One query for a whole chapter, in place of one per verse.
   *
   * Overlap, not containment: a cross-reference whose source passage merely
   * straddles the requested range is still relevant to it. So a row spanning
   * Matthew 5:3-12 is returned when asking for Matthew 5:10-20.
   */
  getFromVerseRange(startVerseId: VerseId, endVerseId: VerseId): UserCrossReference[] {
    const rows = this.sql.queryAll<UserCrossReferenceRow>(
      `SELECT * FROM user_cross_reference
       WHERE from_verse_id_start <= ? AND from_verse_id_end >= ?
       ORDER BY created_date DESC`,
      [endVerseId, startVerseId]
    );

    return rows.map(row => this.mapRowToXref(row));
  }

  getToVerse(toVerseId: VerseId): UserCrossReference[] {
    const rows = this.sql.queryAll<UserCrossReferenceRow>(
      `SELECT * FROM user_cross_reference
       WHERE to_verse_id_start <= ? AND to_verse_id_end >= ?
       ORDER BY created_date DESC`,
      [toVerseId, toVerseId]
    );

    return rows.map(row => this.mapRowToXref(row));
  }

  /**
   * Get all cross-references
   */
  getAll(): UserCrossReference[] {
    const rows = this.sql.queryAll<UserCrossReferenceRow>(
      'SELECT * FROM user_cross_reference ORDER BY created_date DESC'
    );

    return rows.map(row => this.mapRowToXref(row));
  }

  /**
   * Create a new cross-reference
   */
  create(xref: UserCrossReference): UserCrossReference {
    const result = this.sql.execute(
      `INSERT INTO user_cross_reference (
         from_verse_id_start, from_verse_id_end, to_verse_id_start, to_verse_id_end, notes, metadata
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        xref.fromVerseIdStart,
        xref.fromVerseIdEnd,
        xref.toVerseIdStart,
        xref.toVerseIdEnd,
        xref.notes ?? null,
        stringifyJsonField(xref.metadata)
      ]
    );

    xref.userXrefId = result.lastInsertRowId as number;
    return xref;
  }

  /**
   * Update an existing cross-reference
   */
  update(xref: UserCrossReference): UserCrossReference {
    if (!xref.userXrefId) {
      throw new Error('Cannot update cross-reference without ID');
    }

    this.sql.execute(
      `UPDATE user_cross_reference
       SET from_verse_id_start = ?, from_verse_id_end = ?,
           to_verse_id_start = ?, to_verse_id_end = ?,
           notes = ?, metadata = ?
       WHERE user_xref_id = ?`,
      [
        xref.fromVerseIdStart,
        xref.fromVerseIdEnd,
        xref.toVerseIdStart,
        xref.toVerseIdEnd,
        xref.notes ?? null,
        stringifyJsonField(xref.metadata),
        xref.userXrefId
      ]
    );

    return xref;
  }

  /**
   * Delete a cross-reference by ID
   */
  delete(userXrefId: number): boolean {
    const result = this.sql.execute(
      'DELETE FROM user_cross_reference WHERE user_xref_id = ?',
      [userXrefId]
    );

    return result.changes > 0;
  }

  /**
   * Delete every cross-reference whose source or target passage contains the
   * given verse.
   *
   * Note this deletes whole rows: a cross-reference spanning Matthew 5:3-12 is
   * removed in full when deleting for Matthew 5:5. There is no way to excise a
   * single verse from a range, and a partial passage link would be meaningless.
   */
  deleteForVerse(verseId: VerseId): number {
    const result = this.sql.execute(
      `DELETE FROM user_cross_reference
       WHERE (from_verse_id_start <= ? AND from_verse_id_end >= ?)
          OR (to_verse_id_start   <= ? AND to_verse_id_end   >= ?)`,
      [verseId, verseId, verseId, verseId]
    );

    return result.changes;
  }

  /**
   * Map database row to UserCrossReference model
   */
  private mapRowToXref(row: UserCrossReferenceRow): UserCrossReference {
    return new UserCrossReference({
      userXrefId: row.user_xref_id,
      fromVerseIdStart: row.from_verse_id_start,
      fromVerseIdEnd: row.from_verse_id_end,
      toVerseIdStart: row.to_verse_id_start,
      toVerseIdEnd: row.to_verse_id_end,
      notes: row.notes,
      createdDate: row.created_date,
      metadata: parseJsonField(row.metadata)
    });
  }
}
