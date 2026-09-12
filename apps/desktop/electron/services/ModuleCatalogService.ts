import log from 'electron-log/main';
import type { ISql } from '@bible/core';
import type {
  RepositoryCatalog,
  CatalogModule,
  CatalogVerificationResult,
  ModuleFilter,
  FeaturePack,
  FetchedCatalog,
  StarterPack,
} from '@bible/core';
import {
  ModuleCatalog,
  ModuleCatalogRepository,
  parseFeaturePacks,
  parseStarterPacks,
  selectStarterPacksForLanguage,
} from '@bible/core';
import type { IModuleCatalogService } from '@bible/core';
import {
  CATALOG_INDEX_MAX_RESPONSE_BYTES,
  CATALOG_MAX_RESPONSE_BYTES,
  CATALOG_SIGNATURE_MAX_RESPONSE_BYTES,
  CATALOG_VOUCHES_MAX_RESPONSE_BYTES,
} from '../config/constants';
import { getNetworkGateway, type INetworkGateway } from './NetworkGateway';
import { verifyCatalogSignature, isCatalogUsable } from './CatalogSignatureVerifier';
import { findVouchedKey, type KeyVouch } from './CatalogKeyVouches';
import { CATALOG_INDEX_FILENAME, parseCatalogIndex } from './CatalogIndex';
import { MemoryApprovedCatalogKeyStore, type ApprovedCatalogKeyStore } from './ApprovedCatalogKeys';
import {
  OFFICIAL_CATALOG_URL_PREFIXES,
  isPinnedOfficialCatalog,
  isSignatureRequired,
  officialCatalogScope,
  resolveExpectedKeys,
} from './trustedCatalogKeys';

/** What the user is asked to approve: a new official-catalog key and the vouches leading to it. */
export interface VouchedKeyApprovalRequest {
  catalogUrl: string;
  newKey: string;
  chain: KeyVouch[];
}

export type VouchedKeyApprover = (request: VouchedKeyApprovalRequest) => Promise<boolean>;

export interface ModuleCatalogServiceOptions {
  /**
   * Asks the user whether to trust a key vouched for by an already-trusted
   * key. Defaults to declining, so an instance with no way to ask can never
   * widen trust.
   */
  approveVouchedKey?: VouchedKeyApprover;
  /** Where approved keys are kept. Defaults to memory (forgotten on exit). */
  approvedKeys?: ApprovedCatalogKeyStore;
  /** Test seam: the catalog source repository. Defaults to one over `mainDb`. */
  catalogRepository?: ModuleCatalogRepository;
}

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
  private readonly approveVouchedKey: VouchedKeyApprover;
  private readonly approvedKeys: ApprovedCatalogKeyStore;

  constructor(
    mainDb: ISql,
    gateway: INetworkGateway = getNetworkGateway(),
    options: ModuleCatalogServiceOptions = {},
  ) {
    this.catalogRepo = options.catalogRepository ?? new ModuleCatalogRepository(mainDb);
    this.gateway = gateway;
    this.approveVouchedKey = options.approveVouchedKey ?? (async () => false);
    this.approvedKeys = options.approvedKeys ?? new MemoryApprovedCatalogKeyStore();
  }

  /**
   * Resolve a catalog source URL to the concrete catalog document URL.
   * A bare directory URL gets `/catalog.json` appended.
   */
  private static resolveCatalogUrl(url: string): string {
    return url.endsWith('.json') ? url : url.replace(/\/$/, '') + '/catalog.json';
  }

  /**
   * Where a source's catalog index would be served, or undefined when the
   * source URL names a catalog document. A directory may serve an index
   * beside (or instead of) its `catalog.json`; a URL naming `index.json` is
   * the index itself.
   */
  private static indexUrlFor(url: string): string | undefined {
    if (/\/index\.json$/i.test(url)) return url;
    if (url.endsWith('.json')) return undefined;
    return `${url.replace(/\/$/, '')}/${CATALOG_INDEX_FILENAME}`;
  }

  /**
   * Fetch a catalog and verify its detached signature.
   *
   * Transport hardening (bounded redirects, TLS enforcement, timeouts, size
   * caps) is enforced by the injected `NetworkGateway` - catalog URLs are
   * user-supplied, so they are treated as untrusted input.
   *
   * The official catalog's pins apply here whatever the caller passes, so every
   * path - including adding a catalog, which has no recorded key yet - is held
   * to them.
   */
  async fetchCatalog(
    url: string,
    expectedPublicKey?: string | readonly string[],
    requireSignature = false,
  ): Promise<FetchedCatalog> {
    const fetched = await this.tryFetchCatalog(url, expectedPublicKey, requireSignature);
    if (!fetched) {
      throw new Error('Failed to fetch catalog: HTTP 404');
    }
    return fetched;
  }

  /** `fetchCatalog`, but a catalog that is not there (HTTP 404) yields undefined. */
  private async tryFetchCatalog(
    url: string,
    expectedPublicKey: string | readonly string[] | undefined,
    requireSignature: boolean,
  ): Promise<FetchedCatalog | undefined> {
    const catalogUrl = ModuleCatalogService.resolveCatalogUrl(url);

    const response = await this.gateway.fetchBuffered({
      url: catalogUrl,
      method: 'GET',
      maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
      context: 'catalog fetch',
    });

    if (response.status === 404) {
      return undefined;
    }
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

    // `repository.published` sits inside the signed bytes, ready for a future
    // freshness check. Nothing is rejected for its age today.
    const published = catalog.repository.published;
    if (published !== undefined && Number.isNaN(Date.parse(published))) {
      log.warn(`[ModuleCatalog] ${catalogUrl} has an unreadable repository.published: ${String(published)}`);
    }

    // -- Fetch and verify the detached signature --------------------------
    // Verification runs against the exact bytes received, not a re-serialized
    // object, so formatting differences can never break the digest.
    const signature = await this.verifySignedDocument(
      url,
      catalogUrl,
      response.body,
      expectedPublicKey,
      requireSignature,
    );

    if (!isCatalogUsable(signature)) {
      throw new Error(`Catalog signature check failed for ${catalogUrl}: ${signature.message}`);
    }

    if (signature.status === 'unsigned') {
      log.warn(`[ModuleCatalog] ${catalogUrl} is unsigned — cross-origin downloads disabled.`);
    }

    return { catalog, signature };
  }

  /**
   * Verify the detached `.sig` beside a catalog or catalog index.
   *
   * When `sourceUrl` is official, its pins (plus keys the user approved) apply
   * and a signature is required. If every signature is valid but none is by a
   * key this install trusts, a vouch may bridge the gap - if the user agrees.
   *
   * @param sourceUrl   - The URL that decides the trust rules (official or not).
   * @param documentUrl - The document itself; `.sig`/`.vouches` sit beside it.
   */
  private async verifySignedDocument(
    sourceUrl: string,
    documentUrl: string,
    body: Buffer,
    expectedPublicKey: string | readonly string[] | undefined,
    requireSignature: boolean,
  ): Promise<CatalogVerificationResult> {
    const officialScope = isPinnedOfficialCatalog(sourceUrl) ? officialCatalogScope(sourceUrl) : undefined;
    const expectedKeys = resolveExpectedKeys(
      sourceUrl,
      expectedPublicKey,
      officialScope ? this.approvedKeys.list(officialScope) : [],
    );
    const signatureJson = await this.fetchSidecar(
      `${documentUrl}.sig`,
      CATALOG_SIGNATURE_MAX_RESPONSE_BYTES,
      'catalog signature fetch',
    );
    const signature = verifyCatalogSignature(body, signatureJson, {
      expectedPublicKey: expectedKeys,
      requireSignature: isSignatureRequired(sourceUrl, requireSignature),
    });

    if (signature.status === 'untrusted_key' && officialScope) {
      return this.tryVouchedKey(documentUrl, officialScope, expectedKeys ?? [], signature);
    }
    return signature;
  }

  /**
   * Add every catalog listed in a signed official index that this install does
   * not know yet (see `CatalogIndex.ts`).
   *
   * Runs at the start of a refresh-all, for installs whose official source
   * names a catalog rather than the directory serving the index. A scope whose
   * index an enabled source already serves is left to that source's own
   * refresh (`refreshSource`), so the index is fetched once.
   *
   * Never throws - a missing, unsigned or malformed index just adds nothing.
   *
   * @returns The catalog sources that were added.
   */
  async syncOfficialIndexes(): Promise<ModuleCatalog[]> {
    const servedBySource = new Set(
      this.catalogRepo.getEnabled().map((source) => ModuleCatalogService.indexUrlFor(source.url)?.toLowerCase()),
    );
    const added: ModuleCatalog[] = [];
    for (const scope of OFFICIAL_CATALOG_URL_PREFIXES) {
      const indexUrl = `${scope.replace(/\/$/, '')}/${CATALOG_INDEX_FILENAME}`;
      if (!isPinnedOfficialCatalog(scope) || servedBySource.has(indexUrl.toLowerCase())) continue;
      try {
        added.push(...((await this.syncIndex(scope, indexUrl, 'official'))?.added ?? []));
      } catch (error) {
        log.warn(`[ModuleCatalog] Could not use the catalog index for ${scope}:`, error);
      }
    }
    return added;
  }

  /**
   * Fetch and verify the catalog index at `indexUrl`, and add every catalog it
   * lists that this install does not know yet (see `CatalogIndex.ts`).
   *
   * New sources are created enabled and empty, each naming its catalog
   * document - never a directory, so one index cannot lead to another. Nothing
   * is removed or re-enabled: a catalog dropped from the index keeps its row,
   * and one the user disabled stays disabled.
   *
   * An index under the official prefix is held to the pinned keys and may only
   * list catalogs under that prefix. Any other is held to `expectedPublicKey`
   * (trust on first use) and may only list catalogs beside or below itself.
   *
   * @param sourceUrl - The URL that decides the trust rules (official or not).
   * @param type      - Source type for the catalogs added from a non-official index.
   * @returns undefined when no index is served (HTTP 404). Throws when one is
   *          served but cannot be used.
   */
  private async syncIndex(
    sourceUrl: string,
    indexUrl: string,
    type: ModuleCatalog['type'],
    expectedPublicKey?: string,
    requireSignature = false,
  ): Promise<{ signature: CatalogVerificationResult; added: ModuleCatalog[] } | undefined> {
    const response = await this.gateway.fetchBuffered({
      url: indexUrl,
      method: 'GET',
      maxResponseBytes: CATALOG_INDEX_MAX_RESPONSE_BYTES,
      context: 'catalog index fetch',
    });
    if (response.status === 404) {
      return undefined; // The server does not publish an index.
    }
    if (response.status !== 200) {
      throw new Error(`Failed to fetch catalog index: HTTP ${response.status}`);
    }

    const signature = await this.verifySignedDocument(
      sourceUrl,
      indexUrl,
      response.body,
      expectedPublicKey,
      requireSignature,
    );
    if (!isCatalogUsable(signature)) {
      throw new Error(`Catalog index signature check failed for ${indexUrl}: ${signature.message}`);
    }

    const officialScope = isPinnedOfficialCatalog(sourceUrl) ? officialCatalogScope(sourceUrl) : undefined;
    const scope = officialScope ?? new URL('./', indexUrl).toString();
    const { entries, rejected } = parseCatalogIndex(response.body.toString('utf-8'), indexUrl, scope);
    for (const problem of rejected) {
      log.warn(`[ModuleCatalog] Ignoring catalog index entry ${problem}`);
    }

    const known = new Set(
      this.catalogRepo.getAll().map((source) => ModuleCatalogService.resolveCatalogUrl(source.url).toLowerCase()),
    );
    const added: ModuleCatalog[] = [];
    for (const entry of entries) {
      const catalogUrl = ModuleCatalogService.resolveCatalogUrl(entry.url);
      if (known.has(catalogUrl.toLowerCase())) continue;

      known.add(catalogUrl.toLowerCase());
      added.push(
        this.catalogRepo.create(
          new ModuleCatalog({
            name: entry.name,
            abbreviation: entry.abbreviation,
            url: catalogUrl,
            type: officialScope ? 'official' : type,
            isEnabled: true,
            priority: officialScope ? 100 : 0,
          }),
        ),
      );
      log.info(`[ModuleCatalog] Added ${catalogUrl} from the catalog index at ${indexUrl}.`);
    }
    return { signature, added };
  }

  /**
   * Try to reach one of the catalog's signing keys through a chain of vouches
   * starting at a trusted key, and ask the user before trusting it.
   *
   * Only reached for the official catalog, and only when no signature on it is
   * by a trusted key - a vouch never overrides a working pin. Returns the
   * `untrusted_key` result it was given (so the fetch fails) when there is no
   * usable vouch or the user declines.
   */
  private async tryVouchedKey(
    catalogUrl: string,
    scope: string,
    trustedKeys: readonly string[],
    result: CatalogVerificationResult,
  ): Promise<CatalogVerificationResult> {
    const vouchesJson = await this.fetchSidecar(
      `${catalogUrl}.vouches`,
      CATALOG_VOUCHES_MAX_RESPONSE_BYTES,
      'catalog key vouch fetch',
    );
    if (vouchesJson === undefined) return result;

    const vouched = findVouchedKey(vouchesJson, {
      trustedKeys,
      signers: result.signers ?? [],
      scope,
    });
    if (!vouched) return result;

    const approved = await this.approveVouchedKey({
      catalogUrl,
      newKey: vouched.newKey,
      chain: vouched.chain,
    });
    if (!approved) {
      log.warn(`[ModuleCatalog] New signing key ${vouched.newKey} for ${catalogUrl} was not approved.`);
      return {
        ...result,
        message:
          'The official catalog is signed by a new key that you did not approve. ' +
          'Refresh again to review it, or update the app.',
      };
    }

    const link = vouched.chain[vouched.chain.length - 1];
    this.approvedKeys.add({
      publicKey: vouched.newKey,
      scope,
      vouchedBy: link.vouchingKey,
      issued: link.issued,
      approvedAt: new Date().toISOString(),
    });
    log.info(
      `[ModuleCatalog] User approved signing key ${vouched.newKey} for ${scope} ` +
        `(vouched for by ${link.vouchingKey}).`,
    );
    return {
      status: 'verified',
      publicKey: vouched.newKey,
      signers: result.signers,
      message: 'Catalog signature verified against a new key you approved.',
    };
  }

  /**
   * Fetch a small document that sits beside the catalog (`.sig`, `.vouches`).
   *
   * A missing document is not an error here - it yields `undefined` and the
   * caller decides what its absence means (for `.sig`, the verifier decides
   * whether "unsigned" is acceptable). Network failures are logged and also
   * yield `undefined`.
   */
  private async fetchSidecar(
    url: string,
    maxResponseBytes: number,
    context: string,
  ): Promise<string | undefined> {
    try {
      const response = await this.gateway.fetchBuffered({
        url,
        method: 'GET',
        maxResponseBytes,
        context,
      });

      if (response.status !== 200) {
        // Most commonly 404 - the publisher does not serve this document.
        return undefined;
      }
      return response.body.toString('utf-8');
    } catch (error) {
      log.warn(`[ModuleCatalog] Could not retrieve ${url}:`, error);
      return undefined;
    }
  }

  /**
   * Refresh catalog for a catalog source, and any catalogs its index adds
   * (see `refreshSource`).
   */
  async refreshCatalog(catalogId: number): Promise<ModuleCatalog> {
    const entry = this.catalogRepo.getById(catalogId);
    if (!entry) {
      throw new Error(`Catalog source ${catalogId} not found`);
    }

    const [refreshed] = await this.refreshSource(entry);
    return refreshed;
  }

  /**
   * Refresh one catalog source.
   *
   * A source URL names a catalog, a catalog index, or a directory that may
   * serve either or both (`index.json`, `catalog.json`) - so a site root can
   * be a source whether it publishes one catalog or an index of several. A
   * directory's index is read first, and the catalogs it adds are fetched
   * straight away; then its own catalog is fetched as before. A missing
   * catalog is expected beside an index: the source is then an index only, and
   * lists no modules itself.
   *
   * Requires the same key this source used before; `fetchCatalog` swaps in the
   * pinned keys for the official catalog. A catalog that starts signing with
   * a different key, or stops signing entirely, fails instead of silently
   * losing its trust level.
   *
   * @returns The source first, then each catalog its index added that loaded.
   */
  private async refreshSource(entry: ModuleCatalog): Promise<ModuleCatalog[]> {
    const refreshed: ModuleCatalog[] = [entry];
    const indexUrl = ModuleCatalogService.indexUrlFor(entry.url);

    let index: { signature: CatalogVerificationResult; added: ModuleCatalog[] } | undefined;
    let indexError: unknown;
    if (indexUrl) {
      try {
        index = await this.syncIndex(entry.url, indexUrl, entry.type, entry.signingPublicKey, entry.hasBeenSigned());
      } catch (error) {
        // A broken index must not take down a working catalog served beside it.
        indexError = error;
        log.warn(`[ModuleCatalog] Could not use the catalog index at ${indexUrl}:`, error);
      }

      for (const added of index?.added ?? []) {
        try {
          refreshed.push(...(await this.refreshSource(added)));
        } catch (error) {
          // One listed catalog failing must not fail the index that listed it.
          log.error(`Failed to refresh catalog ${added.name}:`, error);
        }
      }
    }

    // A URL naming the index itself has no catalog of its own to look for.
    const fetched = indexUrl === entry.url
      ? undefined
      : await this.tryFetchCatalog(entry.url, entry.signingPublicKey, entry.hasBeenSigned());

    if (fetched) {
      entry.setCatalog(fetched.catalog);
      ModuleCatalogService.recordSignature(entry, fetched.signature);
    } else if (index) {
      // An index only. A catalog this source served before is dropped rather
      // than left to go stale.
      entry.catalogJson = undefined;
      entry.lastFetched = new Date().toISOString();
      ModuleCatalogService.recordSignature(entry, index.signature);
    } else {
      const reason = indexError instanceof Error ? indexError.message : 'HTTP 404';
      throw new Error(`No catalog or catalog index at ${entry.url} (${reason})`);
    }
    this.catalogRepo.update(entry);

    return refreshed;
  }

  /** Keep the signature state a fetch observed, and the signing key when one verified. */
  private static recordSignature(entry: ModuleCatalog, signature: CatalogVerificationResult): void {
    entry.signatureStatus = signature.status;
    if (signature.publicKey) {
      entry.signingPublicKey = signature.publicKey;
    }
  }

  /**
   * Refresh all enabled catalog sources, and the catalogs their indexes add.
   */
  async refreshAllCatalogs(): Promise<ModuleCatalog[]> {
    // Pick up catalogs the official index lists first, so a newly published
    // catalog is fetched in this same pass.
    await this.syncOfficialIndexes();

    const refreshed: ModuleCatalog[] = [];
    for (const entry of this.catalogRepo.getEnabled()) {
      try {
        refreshed.push(...(await this.refreshSource(entry)));
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
        // Relative download URLs resolve against the catalog document, as a
        // browser would: a source may name the document, not just its directory.
        const catalogUrl = ModuleCatalogService.resolveCatalogUrl(entry.url);
        const resolved = catalog.modules.map((m: CatalogModule) => ({
          ...m,
          download_url: new URL(m.download_url, catalogUrl).toString()
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
