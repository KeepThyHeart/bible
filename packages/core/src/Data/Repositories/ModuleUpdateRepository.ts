import { ISql } from '../Core/ISql';
import { RepositoryQueryOptions } from '../Core/IRepository';
import { ModuleUpdate } from '../Models/Main/ModuleUpdate';
import { IModuleUpdateRepository } from './IModuleUpdateRepository';
import { ModuleUpdateRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField, parseBoolField, toBoolInt } from '../Core/JsonHelpers';
import { buildSafeOrderBy, buildPagination } from '../Core/SafeQuery';

/**
 * Repository for module update entities
 * Manages available updates for installed modules
 */
export class ModuleUpdateRepository implements IModuleUpdateRepository {
  private static readonly ALLOWED_ORDER_COLUMNS = new Set(['release_date', 'module_id', 'available_version', 'is_critical']);

  constructor(private sql: ISql) {}

  /**
   * Get an update by ID
   */
  getById(id: number): ModuleUpdate | undefined {
    const row = this.sql.queryOne<ModuleUpdateRow>(
      'SELECT * FROM module_update WHERE update_id = ?',
      [id]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get all updates
   */
  getAll(options?: RepositoryQueryOptions): ModuleUpdate[] {
    let sql = 'SELECT * FROM module_update';

    sql += buildSafeOrderBy(
      options?.orderBy,
      options?.orderDirection,
      ModuleUpdateRepository.ALLOWED_ORDER_COLUMNS,
      { column: 'release_date', direction: 'DESC' }
    );

    sql += buildPagination(options?.limit, options?.offset);

    const rows = this.sql.queryAll<ModuleUpdateRow>(sql);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get updates for a specific module
   */
  getByModule(moduleId: number): ModuleUpdate[] {
    const rows = this.sql.queryAll<ModuleUpdateRow>(
      'SELECT * FROM module_update WHERE module_id = ? ORDER BY release_date DESC',
      [moduleId]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get unignored updates
   */
  getUnignored(): ModuleUpdate[] {
    const rows = this.sql.queryAll<ModuleUpdateRow>(
      'SELECT * FROM module_update WHERE user_ignored = 0 ORDER BY is_critical DESC, release_date DESC'
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get critical updates
   */
  getCritical(): ModuleUpdate[] {
    const rows = this.sql.queryAll<ModuleUpdateRow>(
      'SELECT * FROM module_update WHERE is_critical = 1 AND user_ignored = 0 ORDER BY release_date DESC'
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Create a new update record
   */
  create(entity: ModuleUpdate): ModuleUpdate {
    const result = this.sql.execute(
      `INSERT INTO module_update (
        module_id, current_version, available_version, release_date, changelog,
        download_url, download_size_bytes, is_critical, user_ignored,
        notified_date, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.moduleId,
        entity.currentVersion,
        entity.availableVersion,
        entity.releaseDate ?? null,
        entity.changelog ?? null,
        entity.downloadUrl,
        entity.downloadSizeBytes ?? null,
        toBoolInt(entity.isCritical),
        toBoolInt(entity.userIgnored),
        entity.notifiedDate ?? null,
        stringifyJsonField(entity.metadata)
      ]
    );

    entity.updateId = result.lastInsertRowId;
    return entity;
  }

  /**
   * Update an existing update record
   */
  update(entity: ModuleUpdate): ModuleUpdate {
    if (!entity.updateId) {
      throw new Error('Cannot update module update without ID');
    }

    this.sql.execute(
      `UPDATE module_update SET
        module_id = ?, current_version = ?, available_version = ?, release_date = ?,
        changelog = ?, download_url = ?, download_size_bytes = ?, is_critical = ?,
        user_ignored = ?, notified_date = ?, metadata = ?
      WHERE update_id = ?`,
      [
        entity.moduleId,
        entity.currentVersion,
        entity.availableVersion,
        entity.releaseDate ?? null,
        entity.changelog ?? null,
        entity.downloadUrl,
        entity.downloadSizeBytes ?? null,
        toBoolInt(entity.isCritical),
        toBoolInt(entity.userIgnored),
        entity.notifiedDate ?? null,
        stringifyJsonField(entity.metadata),
        entity.updateId
      ]
    );

    return entity;
  }

  /**
   * Delete an update
   */
  delete(id: number): boolean {
    const result = this.sql.execute(
      'DELETE FROM module_update WHERE update_id = ?',
      [id]
    );
    return result.changes > 0;
  }

  /**
   * Ignore an update
   */
  ignoreUpdate(updateId: number): void {
    this.sql.execute(
      'UPDATE module_update SET user_ignored = 1 WHERE update_id = ?',
      [updateId]
    );
  }

  /**
   * Mark update as notified
   */
  markNotified(updateId: number): void {
    this.sql.execute(
      'UPDATE module_update SET notified_date = ? WHERE update_id = ?',
      [new Date().toISOString(), updateId]
    );
  }

  /**
   * Check if update exists for module
   */
  hasUpdate(moduleId: number): boolean {
    const row = this.sql.queryOne(
      'SELECT COUNT(*) as count FROM module_update WHERE module_id = ? AND user_ignored = 0',
      [moduleId]
    );
    return row ? (row.count as number) > 0 : false;
  }

  /**
   * Delete updates for a specific module
   */
  deleteByModule(moduleId: number): number {
    const result = this.sql.execute(
      'DELETE FROM module_update WHERE module_id = ?',
      [moduleId]
    );
    return result.changes;
  }

  /**
   * Map database row to ModuleUpdate entity
   */
  private mapRowToEntity(row: ModuleUpdateRow): ModuleUpdate {
    return new ModuleUpdate({
      updateId: row.update_id,
      moduleId: row.module_id,
      currentVersion: row.current_version!,
      availableVersion: row.available_version!,
      releaseDate: row.release_date,
      changelog: row.changelog,
      downloadUrl: row.download_url!,
      downloadSizeBytes: row.download_size_bytes,
      isCritical: parseBoolField(row.is_critical),
      userIgnored: parseBoolField(row.user_ignored),
      notifiedDate: row.notified_date,
      metadata: parseJsonField(row.metadata)
    });
  }
}
