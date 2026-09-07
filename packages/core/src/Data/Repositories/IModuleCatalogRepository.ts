import { IRepository } from '../Core/IRepository';
import { ModuleCatalog, CatalogSourceType } from '../Models/Main/ModuleCatalog';

/**
 * Repository interface for module catalog entities
 */
export interface IModuleCatalogRepository extends IRepository<ModuleCatalog> {
  /**
   * Get a catalog by URL
   */
  getByUrl(url: string): ModuleCatalog | undefined;

  /**
   * Get all enabled catalogs ordered by priority
   */
  getEnabled(): ModuleCatalog[];

  /**
   * Get catalogs by type
   */
  getByType(type: CatalogSourceType): ModuleCatalog[];

  /**
   * Enable or disable a catalog
   */
  setEnabled(repositoryId: number, enabled: boolean): void;

  /**
   * Update catalog data
   */
  updateCatalog(repositoryId: number, catalogJson: string): void;

  /**
   * Get catalogs that need refresh (older than threshold)
   */
  getNeedingRefresh(thresholdDays?: number): ModuleCatalog[];
}
