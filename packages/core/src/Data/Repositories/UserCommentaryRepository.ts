import { ISql } from '../Core/ISql';
import { RepositoryQueryOptions } from '../Core/IRepository';
import { UserCommentary } from '../Models/User/UserCommentary';
import { IUserCommentaryRepository } from './IUserCommentaryRepository';
import { UserCommentaryRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField, parseBoolField, toBoolInt } from '../Core/JsonHelpers';
import { buildSafeOrderBy, buildPagination } from '../Core/SafeQuery';

/**
 * Repository for user commentary collections
 * Provides CRUD operations and queries for user commentary collections
 */
export class UserCommentaryRepository implements IUserCommentaryRepository {
  constructor(private sql: ISql) {}

  /**
   * Get a commentary by ID
   */
  getById(id: number): UserCommentary | undefined {
    const row = this.sql.queryOne<UserCommentaryRow>(
      'SELECT * FROM user_commentary WHERE user_commentary_id = ?',
      [id]
    );

    if (!row) return undefined;

    return this.mapRowToEntity(row);
  }

  /**
   * Get all commentary collections
   */
  private static readonly ALLOWED_ORDER_COLUMNS = new Set(['modified_date', 'created_date', 'name']);

  getAll(options?: RepositoryQueryOptions): UserCommentary[] {
    let sql = 'SELECT * FROM user_commentary';

    sql += buildSafeOrderBy(
      options?.orderBy,
      options?.orderDirection,
      UserCommentaryRepository.ALLOWED_ORDER_COLUMNS,
      { column: 'name', direction: 'ASC' }
    );

    sql += buildPagination(options?.limit, options?.offset);

    const rows = this.sql.queryAll<UserCommentaryRow>(sql);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get the default commentary collection
   */
  getDefault(): UserCommentary | undefined {
    const row = this.sql.queryOne<UserCommentaryRow>(
      'SELECT * FROM user_commentary WHERE is_default = 1 LIMIT 1'
    );

    if (!row) return undefined;

    return this.mapRowToEntity(row);
  }

  /**
   * Set a commentary as the default
   */
  setDefault(id: number): boolean {
    this.sql.transaction(() => {
      // Clear all defaults
      this.sql.execute('UPDATE user_commentary SET is_default = 0');

      // Set the new default
      this.sql.execute(
        'UPDATE user_commentary SET is_default = 1 WHERE user_commentary_id = ?',
        [id]
      );
    });

    return true;
  }

  /**
   * Get commentary collections by type (from metadata)
   */
  getByType(type: string): UserCommentary[] {
    const rows = this.sql.queryAll<UserCommentaryRow>(
      `SELECT * FROM user_commentary WHERE metadata LIKE ? ORDER BY name ASC`,
      [`%"type":"${type}"%`]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Count notes in a commentary collection
   */
  countNotes(commentaryId: number): number {
    const row = this.sql.queryOne(
      'SELECT COUNT(*) as count FROM user_note WHERE user_commentary_id = ?',
      [commentaryId]
    );

    return row ? (row.count as number) : 0;
  }

  /**
   * Create a new commentary collection
   */
  create(entity: UserCommentary): UserCommentary {
    const result = this.sql.execute(
      `INSERT INTO user_commentary (
        name, description, created_date, modified_date, is_default, color, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.name,
        entity.description ?? null,
        entity.createdDate ?? new Date().toISOString(),
        entity.modifiedDate ?? new Date().toISOString(),
        toBoolInt(entity.isDefault),
        entity.color ?? null,
        stringifyJsonField(entity.metadata)
      ]
    );

    entity.userCommentaryId = result.lastInsertRowId;
    return entity;
  }

  /**
   * Update an existing commentary collection
   */
  update(entity: UserCommentary): UserCommentary {
    if (!entity.userCommentaryId) {
      throw new Error('Cannot update commentary without ID');
    }

    entity.touch();

    this.sql.execute(
      `UPDATE user_commentary SET
        name = ?, description = ?, modified_date = ?, is_default = ?, color = ?, metadata = ?
      WHERE user_commentary_id = ?`,
      [
        entity.name,
        entity.description ?? null,
        entity.modifiedDate ?? null,
        toBoolInt(entity.isDefault),
        entity.color ?? null,
        stringifyJsonField(entity.metadata),
        entity.userCommentaryId
      ]
    );

    return entity;
  }

  /**
   * Delete a commentary collection
   */
  delete(id: number): boolean {
    const result = this.sql.execute(
      'DELETE FROM user_commentary WHERE user_commentary_id = ?',
      [id]
    );
    return result.changes > 0;
  }

  /**
   * Map database row to UserCommentary entity
   */
  private mapRowToEntity(row: UserCommentaryRow): UserCommentary {
    return new UserCommentary({
      userCommentaryId: row.user_commentary_id,
      name: row.name,
      description: row.description,
      createdDate: row.created_date,
      modifiedDate: row.modified_date,
      isDefault: parseBoolField(row.is_default),
      color: row.color,
      metadata: parseJsonField(row.metadata)
    });
  }
}
