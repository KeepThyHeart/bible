import { ISql } from '../Core/ISql';
import { RepositoryQueryOptions } from '../Core/IRepository';
import { ModuleCatalog, CatalogSourceType } from '../Models/Main/ModuleCatalog';
import { IModuleCatalogRepository } from './IModuleCatalogRepository';
import { ModuleCatalogRow } from '../Core/RowTypes';
import { CatalogSignatureStatus } from '../Core/CatalogTypes';
import { parseJsonField, stringifyJsonField, parseBoolField, toBoolInt } from '../Core/JsonHelpers';
import { buildSafeOrderBy, buildPagination } from '../Core/SafeQuery';

/**
 * Repository for module catalog entities
 * Manages catalogs that contain downloadable modules
 */
export class ModuleCatalogRepository implements IModuleCatalogRepository {
  private static readonly ALLOWED_ORDER_COLUMNS = new Set(['name', 'priority', 'last_updated', 'type']);

  constructor(private sql: ISql) {}

  /**
   * Get a catalog by ID
   */
  getById(id: number): ModuleCatalog | undefined {
    const row = this.sql.queryOne<ModuleCatalogRow>(
      'SELECT * FROM module_repository WHERE repository_id = ?',
      [id]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get a catalog by URL
   */
  getByUrl(url: string): ModuleCatalog | undefined {
    const row = this.sql.queryOne<ModuleCatalogRow>(
      'SELECT * FROM module_repository WHERE url = ?',
      [url]
    );

    return row ? this.mapRowToEntity(row) : undefined;
  }

  /**
   * Get all catalogs
   */
  getAll(options?: RepositoryQueryOptions): ModuleCatalog[] {
    let sql = 'SELECT * FROM module_repository';

    sql += buildSafeOrderBy(
      options?.orderBy,
      options?.orderDirection,
      ModuleCatalogRepository.ALLOWED_ORDER_COLUMNS,
      { column: 'priority', direction: 'DESC' }
    );

    sql += buildPagination(options?.limit, options?.offset);

    const rows = this.sql.queryAll<ModuleCatalogRow>(sql);
    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get all enabled catalogs ordered by priority
   */
  getEnabled(): ModuleCatalog[] {
    const rows = this.sql.queryAll<ModuleCatalogRow>(
      'SELECT * FROM module_repository WHERE is_enabled = 1 ORDER BY priority DESC'
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Get catalogs by type
   */
  getByType(type: CatalogSourceType): ModuleCatalog[] {
    const rows = this.sql.queryAll<ModuleCatalogRow>(
      'SELECT * FROM module_repository WHERE type = ? ORDER BY priority DESC',
      [type]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Create a new catalog
   */
  create(entity: ModuleCatalog): ModuleCatalog {
    const result = this.sql.execute(
      `INSERT INTO module_repository (
        name, abbreviation, url, type, is_enabled, priority,
        catalog_json, last_updated, last_fetched, metadata,
        signature_status, signing_public_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.name,
        entity.abbreviation ?? null,
        entity.url,
        entity.type,
        toBoolInt(entity.isEnabled),
        entity.priority,
        entity.catalogJson ?? null,
        entity.lastUpdated ?? null,
        entity.lastFetched ?? null,
        stringifyJsonField(entity.metadata),
        entity.signatureStatus ?? null,
        entity.signingPublicKey ?? null
      ]
    );

    entity.catalogId = result.lastInsertRowId;
    return entity;
  }

  /**
   * Update an existing catalog
   */
  update(entity: ModuleCatalog): ModuleCatalog {
    if (!entity.catalogId) {
      throw new Error('Cannot update repository without ID');
    }

    this.sql.execute(
      `UPDATE module_repository SET
        name = ?, abbreviation = ?, url = ?, type = ?, is_enabled = ?,
        priority = ?, catalog_json = ?, last_updated = ?, last_fetched = ?,
        metadata = ?, signature_status = ?, signing_public_key = ?
      WHERE repository_id = ?`,
      [
        entity.name,
        entity.abbreviation ?? null,
        entity.url,
        entity.type,
        toBoolInt(entity.isEnabled),
        entity.priority,
        entity.catalogJson ?? null,
        entity.lastUpdated ?? null,
        entity.lastFetched ?? null,
        stringifyJsonField(entity.metadata),
        entity.signatureStatus ?? null,
        entity.signingPublicKey ?? null,
        entity.catalogId
      ]
    );

    return entity;
  }

  /**
   * Delete a catalog
   */
  delete(id: number): boolean {
    const result = this.sql.execute(
      'DELETE FROM module_repository WHERE repository_id = ?',
      [id]
    );
    return result.changes > 0;
  }

  /**
   * Enable or disable a catalog
   */
  setEnabled(repositoryId: number, enabled: boolean): void {
    this.sql.execute(
      'UPDATE module_repository SET is_enabled = ? WHERE repository_id = ?',
      [toBoolInt(enabled), repositoryId]
    );
  }

  /**
   * Update catalog data
   */
  updateCatalog(repositoryId: number, catalogJson: string): void {
    const now = new Date().toISOString();
    this.sql.execute(
      `UPDATE module_repository
       SET catalog_json = ?, last_fetched = ?
       WHERE repository_id = ?`,
      [catalogJson, now, repositoryId]
    );
  }

  /**
   * Get catalogs that need refresh (older than threshold)
   */
  getNeedingRefresh(thresholdDays: number = 7): ModuleCatalog[] {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - thresholdDays);
    const thresholdISO = thresholdDate.toISOString();

    const rows = this.sql.queryAll<ModuleCatalogRow>(
      `SELECT * FROM module_repository
       WHERE is_enabled = 1
         AND (last_fetched IS NULL OR last_fetched < ?)
       ORDER BY priority DESC`,
      [thresholdISO]
    );

    return rows.map(row => this.mapRowToEntity(row));
  }

  /**
   * Map database row to ModuleCatalog entity
   */
  private mapRowToEntity(row: ModuleCatalogRow): ModuleCatalog {
    return new ModuleCatalog({
      catalogId: row.repository_id,
      name: row.name,
      abbreviation: row.abbreviation,
      url: row.url,
      type: row.type as CatalogSourceType,
      isEnabled: parseBoolField(row.is_enabled),
      priority: row.priority,
      catalogJson: row.catalog_json,
      lastUpdated: row.last_updated,
      lastFetched: row.last_fetched,
      metadata: parseJsonField(row.metadata),
      signatureStatus: row.signature_status as CatalogSignatureStatus | undefined,
      signingPublicKey: row.signing_public_key
    });
  }
}
