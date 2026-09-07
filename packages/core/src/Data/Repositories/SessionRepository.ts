import { ISql } from '../Core/ISql';
import { RepositoryQueryOptions } from '../Core/IRepository';
import { Session } from '../Models/User/Session';
import { ISessionRepository } from './ISessionRepository';
import { SessionRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField, parseBoolField, toBoolInt } from '../Core/JsonHelpers';
import { buildSafeOrderBy, buildPagination } from '../Core/SafeQuery';

/**
 * Repository for session entities
 * Provides CRUD operations and queries for study sessions
 */
export class SessionRepository implements ISessionRepository {
  constructor(private sql: ISql) {}

  /**
   * Get a session by ID
   */
  getById(id: number): Session | undefined {
    const row = this.sql.queryOne<SessionRow>(
      'SELECT * FROM session WHERE session_id = ?',
      [id]
    );

    if (!row) return undefined;

    return this.mapRowToEntity(row);
  }

  /**
   * Get all sessions
   */
  getAll(options?: RepositoryQueryOptions): Session[] {
    let sql = 'SELECT * FROM session';
    const ALLOWED_COLUMNS = new Set(['modified_date', 'created_date', 'last_opened', 'name']);

    sql += buildSafeOrderBy(options?.orderBy, options?.orderDirection, ALLOWED_COLUMNS, { column: 'last_opened', direction: 'DESC' });

    sql += buildPagination(options?.limit, options?.offset);

    const rows = this.sql.queryAll<SessionRow>(sql);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get a session by name
   */
  getByName(name: string): Session | undefined {
    const row = this.sql.queryOne<SessionRow>(
      'SELECT * FROM session WHERE name = ?',
      [name]
    );

    if (!row) return undefined;

    return this.mapRowToEntity(row);
  }

  /**
   * Get the default session
   */
  getDefaultSession(): Session | undefined {
    const row = this.sql.queryOne<SessionRow>(
      'SELECT * FROM session WHERE is_default = 1 LIMIT 1'
    );

    if (!row) return undefined;

    return this.mapRowToEntity(row);
  }

  /**
   * Get the autosave session
   */
  getAutosaveSession(): Session | undefined {
    const row = this.sql.queryOne<SessionRow>(
      'SELECT * FROM session WHERE is_autosave = 1 LIMIT 1'
    );

    if (!row) return undefined;

    return this.mapRowToEntity(row);
  }

  /**
   * Get recent sessions
   */
  getRecentSessions(limit: number = 10): Session[] {
    const rows = this.sql.queryAll<SessionRow>(
      'SELECT * FROM session ORDER BY last_opened DESC LIMIT ?',
      [limit]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Create a new session
   */
  create(entity: Session): Session {
    const now = new Date().toISOString();

    const result = this.sql.execute(
      `INSERT INTO session (
        name, description, created_date, modified_date, last_opened,
        is_autosave, is_default, session_data, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.name,
        entity.description ?? null,
        entity.createdDate ?? now,
        entity.modifiedDate ?? now,
        entity.lastOpened ?? null,
        toBoolInt(entity.isAutosave),
        toBoolInt(entity.isDefault),
        stringifyJsonField(entity.sessionData),
        stringifyJsonField(entity.metadata)
      ]
    );

    entity.sessionId = result.lastInsertRowId;

    // If this is set as default, unset all others
    if (entity.isDefault) {
      this.clearOtherDefaults(entity.sessionId);
    }

    return entity;
  }

  /**
   * Update an existing session
   */
  update(entity: Session): Session {
    if (!entity.sessionId) {
      throw new Error('Cannot update session without ID');
    }

    entity.touch();

    this.sql.execute(
      `UPDATE session SET
        name = ?, description = ?, modified_date = ?, last_opened = ?,
        is_autosave = ?, is_default = ?, session_data = ?, metadata = ?
      WHERE session_id = ?`,
      [
        entity.name,
        entity.description ?? null,
        entity.modifiedDate ?? null,
        entity.lastOpened ?? null,
        toBoolInt(entity.isAutosave),
        toBoolInt(entity.isDefault),
        stringifyJsonField(entity.sessionData),
        stringifyJsonField(entity.metadata),
        entity.sessionId
      ]
    );

    // If this is set as default, unset all others
    if (entity.isDefault) {
      this.clearOtherDefaults(entity.sessionId);
    }

    return entity;
  }

  /**
   * Delete a session
   */
  delete(id: number): boolean {
    const result = this.sql.execute('DELETE FROM session WHERE session_id = ?', [id]);
    return result.changes > 0;
  }

  /**
   * Set a session as the default session
   */
  setAsDefault(id: number): boolean {
    // First, clear all default flags
    this.sql.execute('UPDATE session SET is_default = 0');

    // Then set the specified session as default
    const result = this.sql.execute(
      'UPDATE session SET is_default = 1 WHERE session_id = ?',
      [id]
    );

    return result.changes > 0;
  }

  /**
   * Update the last opened time for a session
   */
  markSessionOpened(id: number): void {
    const now = new Date().toISOString();
    this.sql.execute(
      'UPDATE session SET last_opened = ? WHERE session_id = ?',
      [now, id]
    );
  }

  /**
   * Clear the default flag on all sessions except the specified one
   */
  private clearOtherDefaults(exceptId?: number): void {
    if (exceptId !== undefined) {
      this.sql.execute(
        'UPDATE session SET is_default = 0 WHERE session_id != ?',
        [exceptId]
      );
    }
  }

  /**
   * Map database row to Session entity
   */
  private mapRowToEntity(row: SessionRow): Session {
    return new Session({
      sessionId: row.session_id,
      name: row.name,
      description: row.description,
      createdDate: row.created_date,
      modifiedDate: row.modified_date,
      lastOpened: row.last_opened,
      isAutosave: parseBoolField(row.is_autosave),
      isDefault: parseBoolField(row.is_default),
      sessionData: parseJsonField(row.session_data) ?? {},
      metadata: parseJsonField(row.metadata)
    });
  }
}
