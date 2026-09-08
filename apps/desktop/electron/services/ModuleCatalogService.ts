import log from 'electron-log/main';
import type { ISql } from '@bible/core';
import type {
  RepositoryCatalog,
  CatalogModule,
  ModuleFilter,
  FeaturePack,
  FetchedCatalog,
  StarterPack,
} from '@bible/core';
import {
  ModuleCatalogRepository,
  parseFeaturePacks,
  parseStarterPacks,
  selectStarterPacksForLanguage,
} from '@bible/core';
import type { ModuleCatalog } from '@bible/core';
import type { IModuleCatalogService } from '@bible/core';
import { CATALOG_MAX_RESPONSE_BYTES, CATALOG_SIGNATURE_MAX_RESPONSE_BYTES } from '../config/constants';
import { getNetworkGateway, type INetworkGateway } from './NetworkGateway';
import { verifyCatalogSignature, isCatalogUsable } from './CatalogSignatureVerifier';
import { resolveExpectedKey, isSignatureRequired } from './trustedCatalogKeys';

/**
 * Module catalog service implementation.
 * Handles fetching and managing module catalog sources.
 * A "catalog" is an online or local endpoint serving downloadable modules -
 * distinct from the data-access Repository pattern.
 *
 * All network egress goes through the injected `NetworkGateway` (Electron
 * `net`, proxy-honoring). The gateway owns redirect/scheme/downgrade policy
 * and the master offline switch; this service only issues the request,
 * validates the JSON it gets back, and verifies the catalog's detached
 * signature (see `CatalogSignatureVerifier`).
 */
export class ModuleCatalogService implements IModuleCatalogService {
  private catalogRepo: ModuleCatalogRepository;
  private readonly gateway: INetworkGateway;

  constructor(mainDb: ISql, gateway: INetworkGateway = getNetworkGateway()) {
    this.catalogRepo = new ModuleCatalogRepository(mainDb);
    this.gateway = gateway;
  }

  /**
   * Resolve a catalog source URL to the concrete catalog document URL.
   * A bare directory URL gets `/catalog.json` appended.
   */
  private static resolveCatalogUrl(url: string): string {
    return url.endsWith('.json') ? url : url.replace(/\/$/, '') + '/catalog.json';
  }

  /**
   * Fetch a catalog and verify its detached signature.
   *
   * Transport hardening (bounded redirects, TLS enforcement, timeouts, size
   * caps) is enforced by the injected `NetworkGateway` - catalog URLs are
   * user-supplied, so they are treated as untrusted input.
   */
  async fetchCatalog(
    url: string,
    expectedPublicKey?: string,
    requireSignature = false,
  ): Promise<FetchedCatalog> {
    const catalogUrl = ModuleCatalogService.resolveCatalogUrl(url);

    const response = await this.gateway.fetchBuffered({
      url: catalogUrl,
      method: 'GET',
      maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
      context: 'catalog fetch',
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch catalog: HTTP ${response.status}`);
    }

    // -- Parse and structurally validate ----------------------------------
    const data = response.body.toString('utf-8');
    let catalog: RepositoryCatalog;
    try {
      catalog = JSON.parse(data) as RepositoryCatalog;
    } catch {
      throw new Error('Failed to parse catalog JSON');
    }

    if (!this.validateCatalog(data)) {
      throw new Error('Invalid catalog format');
    }

    // -- Fetch and verify the detached signature --------------------------
    // Verification runs against the exact bytes received, not a re-serialized
    // object, so formatting differences can never break the digest.
    const signatureJson = await this.fetchSignature(catalogUrl);
    const signature = verifyCatalogSignature(response.body, signatureJson, {
      expectedPublicKey,
      requireSignature,
    });

    if (!isCatalogUsable(signature)) {
      throw new Error(`Catalog signature check failed for ${catalogUrl}: ${signature.message}`);
    }

    if (signature.status === 'unsigned') {
      log.warn(`[ModuleCatalog] ${catalogUrl} is unsigned — cross-origin downloads disabled.`);
    }

    return { catalog, signature };
  }

  /**
   * Fetch the detached signature that sits beside the catalog.
   *
   * A missing signature is not an error here - it yields `undefined` and the
   * verifier decides whether "unsigned" is acceptable for this source. Only
   * `NetworkGateway`-level failures (offline, redirect/scheme violations)
   * propagate.
   */
  private async fetchSignature(catalogUrl: string): Promise<string | undefined> {
    const sigUrl = `${catalogUrl}.sig`;
    try {
      const response = await this.gateway.fetchBuffered({
        url: sigUrl,
        method: 'GET',
        maxResponseBytes: CATALOG_SIGNATURE_MAX_RESPONSE_BYTES,
        context: 'catalog signature fetch',
      });

      if (response.status !== 200) {
        // Most commonly 404 - the publisher has not signed the catalog.
        return undefined;
      }
      return response.body.toString('utf-8');
    } catch (error) {
      log.warn(`[ModuleCatalog] Could not retrieve ${sigUrl}:`, error);
      return undefined;
    }
  }

  /**
   * Refresh catalog for a catalog source
   */
  async refreshCatalog(catalogId: number): Promise<ModuleCatalog> {
    const entry = this.catalogRepo.getById(catalogId);
    if (!entry) {
      throw new Error(`Catalog source ${catalogId} not found`);
    }

    // Require the same key this source used before (or the pinned official
    // key). A catalog that starts signing with a different key, or stops
    // signing entirely, fails instead of silently losing its trust level.
    const expectedKey = resolveExpectedKey(entry.url, entry.signingPublicKey);
    const mustBeSigned = isSignatureRequired(entry.url, entry.hasBeenSigned());

    // Fetch fresh catalog
    const fetched = await this.fetchCatalog(entry.url, expectedKey, mustBeSigned);

    // Update with new catalog and the observed signature state
    entry.setCatalog(fetched.catalog);
    entry.signatureStatus = fetched.signature.status;
    if (fetched.signature.publicKey) {
      entry.signingPublicKey = fetched.signature.publicKey;
    }
    this.catalogRepo.update(entry);

    return entry;
  }

  /**
   * Refresh all enabled catalog sources
   */
  async refreshAllCatalogs(): Promise<ModuleCatalog[]> {
    const catalogs = this.catalogRepo.getEnabled();
    const refreshed: ModuleCatalog[] = [];

    for (const entry of catalogs) {
      try {
        const updated = await this.refreshCatalog(entry.catalogId!);
        refreshed.push(updated);
      } catch (error) {
        // Log error but continue with other catalogs
        log.error(`Failed to refresh catalog ${entry.name}:`, error);
      }
    }

    return refreshed;
  }

  /**
   * Get cached catalog for a catalog source
   */
  getCachedCatalog(catalogId: number): RepositoryCatalog | undefined {
    const entry = this.catalogRepo.getById(catalogId);
    if (!entry) {
      return undefined;
    }

    return entry.getParsedCatalog();
  }

  /**
   * Search modules across all enabled catalog sources
   */
  searchModules(filter: ModuleFilter): CatalogModule[] {
    const allModules = this.getAllAvailableModules();

    return allModules.filter(module => {
      // Filter by module type
      if (filter.moduleType) {
        const types = Array.isArray(filter.moduleType) ? filter.moduleType : [filter.moduleType];
        if (!types.includes(module.module_type)) {
          return false;
        }
      }

      // Filter by language
      if (filter.languageCode) {
        const languages = Array.isArray(filter.languageCode) ? filter.languageCode : [filter.languageCode];
        if (!languages.includes(module.language_code)) {
          return false;
        }
      }

      // Filter by license
      if (filter.license) {
        const licenses = Array.isArray(filter.license) ? filter.license : [filter.license];
        if (!licenses.includes(module.license)) {
          return false;
        }
      }

      // Filter by features
      if (filter.features) {
        const requiredFeatures = Array.isArray(filter.features) ? filter.features : [filter.features];
        if (!requiredFeatures.every(feature => module.features.includes(feature))) {
          return false;
        }
      }

      // Filter by tags
      if (filter.tags) {
        const requiredTags = Array.isArray(filter.tags) ? filter.tags : [filter.tags];
        if (!requiredTags.some(tag => module.tags.includes(tag))) {
          return false;
        }
      }

      // Filter by recommended
      if (filter.recommended !== undefined) {
        if (module.recommended !== filter.recommended) {
          return false;
        }
      }

      // Filter by size
      if (filter.minSize !== undefined && module.installed_size_bytes < filter.minSize) {
        return false;
      }
      if (filter.maxSize !== undefined && module.installed_size_bytes > filter.maxSize) {
        return false;
      }

      // Filter by search query (name, description, author)
      if (filter.searchQuery) {
        const query = filter.searchQuery.toLowerCase();
        const searchableText = [
          module.name,
          module.abbreviation,
          module.description,
          module.author || '',
          module.publisher || ''
        ].join(' ').toLowerCase();

        if (!searchableText.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get all available modules from all enabled catalog sources
   */
  getAllAvailableModules(): CatalogModule[] {
    const catalogs = this.catalogRepo.getEnabled();
    const allModules: CatalogModule[] = [];

    for (const entry of catalogs) {
      const catalog = entry.getParsedCatalog();
      if (catalog && catalog.modules) {
        // Resolve relative download URLs against the catalog base URL
        const baseUrl = entry.url.replace(/\/$/, '');
        const resolved = catalog.modules.map((m: CatalogModule) => ({
          ...m,
          download_url: m.download_url.startsWith('http')
            ? m.download_url
            : `${baseUrl}/${m.download_url}`
        }));
        allModules.push(...resolved);
      }
    }

    return allModules;
  }

  /**
   * Get every validated feature pack across all enabled catalog sources.
   *
   * Feature packs are optional capabilities (the semantic-search index and its
   * embedding model), not study content, so they live in their own catalog
   * section and never touch `module_metadata`. Each entry is put through
   * `parseFeaturePacks` here - the raw section is typed `unknown[]` precisely so
   * that unvalidated network data cannot reach a caller by accident. Malformed
   * entries are dropped with a log line rather than failing the whole catalog:
   * one bad listing must not hide the rest.
   */
  getAvailableFeaturePacks(): FeaturePack[] {
    const catalogs = this.catalogRepo.getEnabled();
    const packs: FeaturePack[] = [];

    for (const entry of catalogs) {
      const catalog = entry.getParsedCatalog();
      if (!catalog?.feature_packs) continue;

      const { packs: valid, rejected } = parseFeaturePacks(catalog.feature_packs);
      for (const rejection of rejected) {
        log.warn(
          `[ModuleCatalog] Ignoring feature pack #${rejection.index} from ${entry.name}: ${rejection.errors.join('; ')}`
        );
      }

      // Unlike `modules`, artifact URLs are NOT resolved against the catalog
      // base - `parseFeaturePack` requires them to be absolute http(s) already.
      // A validated pack is therefore fully self-describing, with no ambient
      // base URL needed to interpret it, which is what lets the installer treat
      // the parsed object as the single source of truth for what to fetch.
      packs.push(...valid);
    }

    return packs;
  }

  /**
   * Find a validated feature pack by id across all enabled catalogs.
   */
  getFeaturePack(packId: string): FeaturePack | undefined {
    return this.getAvailableFeaturePacks().find(pack => pack.pack_id === packId);
  }

  /**
   * Every validated starter pack across all enabled catalogs.
   *
   * Same trust discipline as `getAvailableFeaturePacks`: the raw section is
   * `unknown[]`, each entry goes through `parseStarterPacks`, and a malformed
   * entry is dropped with a log line rather than poisoning the rest.
   *
   * Unlike feature packs, a starter pack carries no artifact URLs - it names
   * `module_id`s that must resolve against the catalog that declared them.
   * Resolution happens in `getStarterPackModules` rather than here so that
   * listing packs stays cheap for the first-run screen.
   */
  getAvailableStarterPacks(): StarterPack[] {
    const catalogs = this.catalogRepo.getEnabled();
    const packs: StarterPack[] = [];

    for (const entry of catalogs) {
      const catalog = entry.getParsedCatalog();
      if (!catalog?.starter_packs) continue;

      const { packs: valid, rejected } = parseStarterPacks(catalog.starter_packs);
      for (const rejection of rejected) {
        log.warn(
          `[ModuleCatalog] Ignoring starter pack #${rejection.index} from ${entry.name}: ${rejection.errors.join('; ')}`
        );
      }
      packs.push(...valid);
    }

    return packs;
  }

  /**
   * Starter packs offered for a UI locale, best match first.
   *
   * An empty array is a normal, expected answer - several supported UI
   * languages have no public-domain study content we can legally ship yet
   * (see `SUPPORTED_CONTENT_LANGUAGES` in `StarterPackTypes.ts`). Callers
   * must render that as "nothing to suggest", never as an error.
   */
  getStarterPacksForLanguage(languageCode: string): StarterPack[] {
    return selectStarterPacksForLanguage(this.getAvailableStarterPacks(), languageCode);
  }

  /**
   * Resolve a starter pack's `module_ids` to the catalog entries they name.
   *
   * Ids that resolve to nothing are dropped with a warning rather than
   * failing the pack: a catalog that withdraws a module (a licence lapsed, a
   * file was found corrupt) should degrade the pack to the modules that ARE
   * still available, not present the user with a pack that refuses to
   * install. The caller can compare `modules.length` against
   * `pack.module_ids.length` when it wants to say so.
   */
  getStarterPackModules(packId: string): { pack?: StarterPack; modules: CatalogModule[] } {
    const pack = this.getAvailableStarterPacks().find(p => p.pack_id === packId);
    if (!pack) return { modules: [] };

    const available = this.getAllAvailableModules();
    const byId = new Map(available.map(m => [m.module_id, m]));

    const modules: CatalogModule[] = [];
    for (const moduleId of pack.module_ids) {
      const match = byId.get(moduleId);
      if (!match) {
        log.warn(`[ModuleCatalog] Starter pack "${packId}" references unknown module "${moduleId}" — skipping.`);
        continue;
      }
      modules.push(match);
    }

    return { pack, modules };
  }

  /**
   * Get module by ID from catalogs
   */
  getModuleInfo(moduleId: string): CatalogModule | undefined {
    const allModules = this.getAllAvailableModules();
    return allModules.find(module => module.module_id === moduleId);
  }

  /**
   * Validate catalog JSON structure
   */
  validateCatalog(catalogJson: string): boolean {
    try {
      const catalog = JSON.parse(catalogJson);

      // Check required top-level fields
      if (!catalog.repository || !catalog.modules) {
        return false;
      }

      // Check repository info
      const repo = catalog.repository;
      if (!repo.name || !repo.url || !repo.version) {
        return false;
      }

      // Check modules array
      if (!Array.isArray(catalog.modules)) {
        return false;
      }

      // Validate first few modules (sample check)
      for (let i = 0; i < Math.min(3, catalog.modules.length); i++) {
        const module = catalog.modules[i];
        if (!module.module_id || !module.module_type || !module.name || !module.download_url) {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}
