import { ISql } from '../Core/ISql';
import { RepositoryQueryOptions } from '../Core/IRepository';
import { ModuleMetadata, ModuleFeature } from '../Models/Main/ModuleMetadata';
import { ModuleType } from '../Core/Types';
import { IModuleMetadataRepository } from './IModuleMetadataRepository';
import { ModuleMetadataRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField, parseBoolField, toBoolInt } from '../Core/JsonHelpers';
import { buildSafeOrderBy, buildPagination } from '../Core/SafeQuery';

/**
 * Repository for module metadata entities
 * Provides CRUD operations and queries for installed modules
 */
export class ModuleMetadataRepository implements IModuleMetadataRepository {
  constructor(private sql: ISql) {}

  /**
   * Get a module by ID
   */
  getById(id: number): ModuleMetadata | undefined {
    const row = this.sql.queryOne<ModuleMetadataRow>(
      'SELECT * FROM module_metadata WHERE module_id = ?',
      [id]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get a module by its stable `module_uuid`.
   *
   * This is the identity lookup to prefer over `getByAbbreviation`: an
   * abbreviation is a display string that two publishers can collide on and
   * that changes when an edition is renamed, whereas the UUID is fixed for
   * the life of the module.
   */
  getByUuid(moduleUuid: string): ModuleMetadata | undefined {
    // Empty string is still guarded: no row can hold it, and letting it through
    // would be a query that can only ever return nothing.
    if (!moduleUuid) return undefined;

    const row = this.sql.queryOne<ModuleMetadataRow>(
      'SELECT * FROM module_metadata WHERE module_uuid = ?',
      [moduleUuid]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get a module by abbreviation
   */
  getByAbbreviation(abbreviation: string): ModuleMetadata | undefined {
    const row = this.sql.queryOne<ModuleMetadataRow>(
      'SELECT * FROM module_metadata WHERE abbreviation = ?',
      [abbreviation]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get all modules
   */
  getAll(options?: RepositoryQueryOptions): ModuleMetadata[] {
    let sql = 'SELECT * FROM module_metadata';
    const ALLOWED_COLUMNS = new Set(['module_name', 'module_type', 'abbreviation', 'installed_date', 'last_updated', 'language_code']);

    sql += buildSafeOrderBy(options?.orderBy, options?.orderDirection, ALLOWED_COLUMNS, { column: 'module_name', direction: 'ASC' });

    sql += buildPagination(options?.limit, options?.offset);

    const rows = this.sql.queryAll<ModuleMetadataRow>(sql);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get modules by type
   */
  getByType(moduleType: ModuleType): ModuleMetadata[] {
    const rows = this.sql.queryAll<ModuleMetadataRow>(
      'SELECT * FROM module_metadata WHERE module_type = ? ORDER BY module_name',
      [moduleType]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get modules by language
   */
  getByLanguage(languageCode: string): ModuleMetadata[] {
    const rows = this.sql.queryAll<ModuleMetadataRow>(
      'SELECT * FROM module_metadata WHERE language_code = ? ORDER BY module_name',
      [languageCode]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get modules that need indexing
   */
  getUnindexedModules(): ModuleMetadata[] {
    const rows = this.sql.queryAll<ModuleMetadataRow>(
      'SELECT * FROM module_metadata WHERE is_indexed = 0 ORDER BY installed_date'
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Create a new module
   */
  create(entity: ModuleMetadata): ModuleMetadata {
    const result = this.sql.execute(
      `INSERT INTO module_metadata (
        module_uuid, module_type, module_name, abbreviation, version, language_code,
        installed_date, last_updated, database_path, size_bytes, is_indexed,
        last_indexed_date, features, sword_metadata, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.moduleUuid,
        entity.moduleType,
        entity.moduleName,
        entity.abbreviation ?? null,
        entity.version ?? null,
        entity.languageCode ?? null,
        entity.installedDate ?? new Date().toISOString(),
        entity.lastUpdated ?? null,
        entity.databasePath,
        entity.sizeBytes ?? null,
        toBoolInt(entity.isIndexed),
        entity.lastIndexedDate ?? null,
        stringifyJsonField(entity.features),
        stringifyJsonField(entity.swordMetadata),
        stringifyJsonField(entity.metadata)
      ]
    );

    entity.moduleId = result.lastInsertRowId;
    return entity;
  }

  /**
   * Update an existing module
   */
  update(entity: ModuleMetadata): ModuleMetadata {
    if (!entity.moduleId) {
      throw new Error('Cannot update module without ID');
    }

    this.sql.execute(
      `UPDATE module_metadata SET
        module_uuid = ?, module_type = ?, module_name = ?, abbreviation = ?, version = ?,
        language_code = ?, last_updated = ?, database_path = ?, size_bytes = ?,
        is_indexed = ?, last_indexed_date = ?, features = ?, sword_metadata = ?,
        metadata = ?
      WHERE module_id = ?`,
      [
        entity.moduleUuid,
        entity.moduleType,
        entity.moduleName,
        entity.abbreviation ?? null,
        entity.version ?? null,
        entity.languageCode ?? null,
        entity.lastUpdated ?? new Date().toISOString(),
        entity.databasePath,
        entity.sizeBytes ?? null,
        toBoolInt(entity.isIndexed),
        entity.lastIndexedDate ?? null,
        stringifyJsonField(entity.features),
        stringifyJsonField(entity.swordMetadata),
        stringifyJsonField(entity.metadata),
        entity.moduleId
      ]
    );

    return entity;
  }

  /**
   * Delete a module
   */
  delete(id: number): boolean {
    const result = this.sql.execute(
      'DELETE FROM module_metadata WHERE module_id = ?',
      [id]
    );
    return result.changes > 0;
  }

  /**
   * Mark a module as indexed
   */
  markAsIndexed(moduleId: number): void {
    this.sql.execute(
      `UPDATE module_metadata
       SET is_indexed = 1, last_indexed_date = ?
       WHERE module_id = ?`,
      [new Date().toISOString(), moduleId]
    );
  }

  /**
   * Search modules by name
   */
  search(query: string): ModuleMetadata[] {
    const searchTerm = `%${query}%`;
    const rows = this.sql.queryAll<ModuleMetadataRow>(
      `SELECT * FROM module_metadata
       WHERE module_name LIKE ? OR abbreviation LIKE ?
       ORDER BY module_name`,
      [searchTerm, searchTerm]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get modules by feature
   */
  getByFeature(feature: ModuleFeature): ModuleMetadata[] {
    const rows = this.sql.queryAll<ModuleMetadataRow>(
      `SELECT * FROM module_metadata WHERE features LIKE ? ORDER BY module_name`,
      [`%"${feature}"%`]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Map database row to ModuleMetadata entity
   */
  private mapRowToEntity(row: ModuleMetadataRow): ModuleMetadata {
    return new ModuleMetadata({
      moduleId: row.module_id,
      moduleUuid: row.module_uuid,
      moduleType: row.module_type as ModuleType,
      moduleName: row.module_name,
      abbreviation: row.abbreviation,
      version: row.version,
      languageCode: row.language_code,
      installedDate: row.installed_date,
      lastUpdated: row.last_updated,
      databasePath: row.database_path,
      sizeBytes: row.size_bytes,
      isIndexed: parseBoolField(row.is_indexed),
      lastIndexedDate: row.last_indexed_date,
      features: parseJsonField<ModuleFeature[]>(row.features) ?? [],
      swordMetadata: parseJsonField(row.sword_metadata),
      metadata: parseJsonField(row.metadata)
    });
  }
}
