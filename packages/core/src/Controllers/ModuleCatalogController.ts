import { ISql } from '../Data/Core/ISql';
import { ModuleCatalog, CatalogSourceType } from '../Data/Models/Main/ModuleCatalog';
import { ModuleCatalogRepository } from '../Data/Repositories/ModuleCatalogRepository';
import { IModuleCatalogService } from '../Services/IModuleCatalogService';
import { RepositoryCatalog } from '../Data/Core/CatalogTypes';

/**
 * Module Catalog Controller
 * Manages module catalog sources and catalog operations.
 * A 'catalog' is an online or local source of downloadable modules,
 * distinct from the data-access Repository pattern.
 */
export class ModuleCatalogController {
  private catalogRepo: ModuleCatalogRepository;

  constructor(
    mainDb: ISql,
    private repositoryService: IModuleCatalogService
  ) {
    this.catalogRepo = new ModuleCatalogRepository(mainDb);
  }

  /**
   * Get all repositories
   */
  getRepositories(): ModuleCatalog[] {
    return this.catalogRepo.getAll();
  }

  /**
   * Get enabled repositories.
   * An enabled catalog is included in module discovery and refresh operations.
   * Disabling a catalog hides its modules from the UI without deleting the entry.
   */
  getEnabledRepositories(): ModuleCatalog[] {
    return this.catalogRepo.getEnabled();
  }

  /**
   * Get repository by ID
   */
  getRepository(repositoryId: number): ModuleCatalog | undefined {
    return this.catalogRepo.getById(repositoryId);
  }

  /**
   * Add a new repository
   */
  async addRepository(
    name: string,
    url: string,
    type: CatalogSourceType,
    abbreviation?: string
  ): Promise<ModuleCatalog> {
    // Check if catalog source already exists (URL = a remote or local catalog endpoint serving module .db files)
    const existing = this.catalogRepo.getByUrl(url);
    if (existing) {
      throw new Error('Repository already exists');
    }

    // Fetch catalog to validate the source. No expected key is passed: adding
    // a catalog is the trust-on-first-use moment, so whatever key signs it now
    // becomes the key required on every later refresh.
    const fetched = await this.repositoryService.fetchCatalog(url);

    // Create repository entity
    const repository = new ModuleCatalog({
      name,
      abbreviation,
      url,
      type,
      isEnabled: true,
      priority: type === 'official' ? 100 : 0
    });

    // Set catalog and record the signature state observed on first use
    repository.setCatalog(fetched.catalog);
    repository.signatureStatus = fetched.signature.status;
    repository.signingPublicKey = fetched.signature.publicKey;

    // Save to database
    return this.catalogRepo.create(repository);
  }

  /**
   * Remove a repository
   */
  removeRepository(repositoryId: number): boolean {
    // Prevent removal of official repository
    const repository = this.catalogRepo.getById(repositoryId);
    if (repository && repository.isOfficial()) {
      throw new Error('Cannot remove official repository');
    }

    return this.catalogRepo.delete(repositoryId);
  }

  /**
   * Enable or disable a repository
   */
  setRepositoryEnabled(repositoryId: number, enabled: boolean): void {
    this.catalogRepo.setEnabled(repositoryId, enabled);
  }

  /**
   * Refresh repository catalog
   */
  async refreshCatalog(repositoryId: number): Promise<ModuleCatalog> {
    return this.repositoryService.refreshCatalog(repositoryId);
  }

  /**
   * Refresh all enabled repository catalogs
   */
  async refreshAllCatalogs(): Promise<ModuleCatalog[]> {
    return this.repositoryService.refreshAllCatalogs();
  }

  /**
   * Get catalog for a repository
   */
  getCatalog(repositoryId: number): RepositoryCatalog | undefined {
    return this.repositoryService.getCachedCatalog(repositoryId);
  }

  /**
   * Update a repository's properties
   */
  updateRepository(repository: ModuleCatalog): ModuleCatalog {
    return this.catalogRepo.update(repository);
  }

  /**
   * Get repositories that need refresh
   */
  getRepositoriesNeedingRefresh(thresholdDays: number = 7): ModuleCatalog[] {
    return this.catalogRepo.getNeedingRefresh(thresholdDays);
  }

  /**
   * Update repository priority
   */
  updateRepositoryPriority(repositoryId: number, priority: number): void {
    const repository = this.catalogRepo.getById(repositoryId);
    if (!repository) {
      throw new Error('Repository not found');
    }

    repository.priority = priority;
    this.catalogRepo.update(repository);
  }

  /**
   * Get official repository
   */
  getOfficialRepository(): ModuleCatalog | undefined {
    const officialRepos = this.catalogRepo.getByType('official');
    return officialRepos.length > 0 ? officialRepos[0] : undefined;
  }
}

/**
 * Module catalog setup requirements:
 *
 * A catalog URL must serve a JSON manifest (`catalog.json`) listing available
 * modules with their metadata and download URLs. The catalog can be hosted as
 * static files on any web server - no Node.js or server-side logic is required.
 * See CatalogTypes.ts for the expected JSON structure.
 *
 * Optionally (and recommended for public catalogs) the host also serves a
 * detached Ed25519 signature at `catalog.json.sig`, which may carry several
 * signatures during a key rotation. Because the catalog carries each module's
 * download URL and SHA-256 checksum, a verified catalog signature transitively
 * authenticates every module download it describes. Sign with
 * `scripts/yubikey-sign.py`, which also stamps `repository.published`.
 *
 * The official catalog may also serve `catalog.json.vouches`: statements by
 * trusted keys vouching for new ones, consulted only when no trusted key signed
 * the catalog, and only with the user's approval (desktop `CatalogKeyVouches`).
 *
 * The official domain may also serve a signed `index.json` listing further
 * catalogs under it (one per language, say), so each can be signed on its own;
 * the desktop adds any it does not know yet on refresh (desktop `CatalogIndex`).
 *
 * Unsigned catalogs remain supported: their modules may only be downloaded from
 * the catalog's own origin (see ModuleCatalogService.getAllAvailableModules).
 */
