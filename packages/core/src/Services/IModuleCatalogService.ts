import { RepositoryCatalog, CatalogModule, ModuleFilter, FetchedCatalog } from '../Data/Core/CatalogTypes';
import { ModuleCatalog } from '../Data/Models/Main/ModuleCatalog';

/**
 * Module catalog service interface
 * Handles fetching and managing module catalog sources
 */
export interface IModuleCatalogService {
  /**
   * Fetch a catalog and verify its detached signature.
   *
   * Rejects when the transport policy is violated (bad protocol, redirect
   * loop, oversized response) or when the signature is present but invalid.
   *
   * @param url - Repository catalog URL
   * @param expectedPublicKey - Key, or keys, the catalog must be signed by when
   *                            known (the key recorded on a previous fetch); any
   *                            one of them is accepted. Omit to accept any key.
   *                            The official catalog's pinned keys apply
   *                            regardless.
   * @param requireSignature - Reject an unsigned catalog outright.
   * @returns The parsed catalog plus its signature verification result
   */
  fetchCatalog(
    url: string,
    expectedPublicKey?: string | readonly string[],
    requireSignature?: boolean
  ): Promise<FetchedCatalog>;

  /**
   * Refresh catalog for a repository
   * @param repositoryId - Repository ID
   * @returns Updated repository entity
   */
  refreshCatalog(repositoryId: number): Promise<ModuleCatalog>;

  /**
   * Refresh all enabled repository catalogs
   * @returns Array of updated repositories
   */
  refreshAllCatalogs(): Promise<ModuleCatalog[]>;

  /**
   * Get cached catalog for a repository
   * @param repositoryId - Repository ID
   * @returns Parsed catalog or undefined
   */
  getCachedCatalog(repositoryId: number): RepositoryCatalog | undefined;

  /**
   * Search modules across all enabled repositories
   * @param filter - Module filter criteria
   * @returns Array of matching modules
   */
  searchModules(filter: ModuleFilter): CatalogModule[];

  /**
   * Get all available modules from all enabled repositories
   * @returns Array of all catalog modules
   */
  getAllAvailableModules(): CatalogModule[];

  /**
   * Get module by ID from catalogs
   * @param moduleId - Module identifier
   * @returns Module info or undefined
   */
  getModuleInfo(moduleId: string): CatalogModule | undefined;

  /**
   * Validate catalog JSON structure
   * @param catalogJson - JSON string to validate
   * @returns True if valid
   */
  validateCatalog(catalogJson: string): boolean;
}
