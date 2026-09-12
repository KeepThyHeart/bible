/**
 * `ModuleCatalogService.refreshAllCatalogs` picking up catalogs from the signed
 * official index.
 *
 * The pinned set is swapped for a key the test holds, and the catalog source
 * repository for an in-memory fake, so the whole path - index fetch, index
 * signature, new source rows, and each new catalog's own signature - runs for
 * real without a database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModuleCatalog, type ISql, type ModuleCatalogRepository } from '@bible/core';

import { ModuleCatalogService } from '../ModuleCatalogService';
import { CATALOG_INDEX_FORMAT, CATALOG_INDEX_VERSION } from '../CatalogIndex';
import { OFFICIAL_CATALOG_URL_PREFIXES, __setOfficialPublicKeysForTests } from '../trustedCatalogKeys';
import { FakeNetworkGateway, fetchResult } from './fakeNetworkGateway';
import { makeKey, signatureDocument, type TestKey } from './catalogSigningTestHelpers';

const stubSql = {} as unknown as ISql;

const SCOPE = OFFICIAL_CATALOG_URL_PREFIXES[0];
const INDEX_URL = `${SCOPE}index.json`;
const ROOT_CATALOG_URL = `${SCOPE}catalog.json`;
const SPANISH_CATALOG_URL = `${SCOPE}es/catalog.json`;

/** Just enough of `ModuleCatalogRepository` for the refresh path. */
class FakeCatalogRepository {
  readonly sources: ModuleCatalog[] = [];
  private nextId = 1;

  getAll(): ModuleCatalog[] {
    return [...this.sources];
  }

  getEnabled(): ModuleCatalog[] {
    return this.sources.filter((source) => source.isEnabled);
  }

  getById(id: number): ModuleCatalog | undefined {
    return this.sources.find((source) => source.catalogId === id);
  }

  create(entity: ModuleCatalog): ModuleCatalog {
    entity.catalogId = this.nextId++;
    this.sources.push(entity);
    return entity;
  }

  update(entity: ModuleCatalog): ModuleCatalog {
    return entity;
  }
}

function catalogJson(name: string): string {
  return JSON.stringify({
    repository: { name, url: SCOPE, version: '1.0' },
    modules: [{ module_id: `${name}-bible`, module_type: 'bible', name: `${name} Bible`, download_url: 'b.zip' }],
  });
}

const INDEX_JSON = JSON.stringify({
  format: CATALOG_INDEX_FORMAT,
  version: CATALOG_INDEX_VERSION,
  published: '2026-09-12T15:00:00Z',
  catalogs: [
    { url: 'catalog.json', name: 'English modules', abbreviation: 'EN' },
    { url: 'es/catalog.json', name: 'Módulos en español', abbreviation: 'ES' },
  ],
});

describe('ModuleCatalogService - official catalog index', () => {
  let pinned: TestKey;
  let gateway: FakeNetworkGateway;
  let repo: FakeCatalogRepository;
  let service: ModuleCatalogService;

  beforeEach(() => {
    pinned = makeKey();
    __setOfficialPublicKeysForTests([pinned.publicKeyHex]);
    gateway = new FakeNetworkGateway();
    repo = new FakeCatalogRepository();
    // The seeded official source, as `initMainDatabase` creates it.
    repo.create(new ModuleCatalog({ name: 'Official', url: SCOPE, type: 'official', priority: 100 }));
    service = new ModuleCatalogService(stubSql, gateway, {
      catalogRepository: repo as unknown as ModuleCatalogRepository,
    });
  });

  afterEach(() => {
    __setOfficialPublicKeysForTests(undefined);
  });

  /** Serve `files` by URL, each signed by `signer` unless overridden; anything else is a 404. */
  function serve(files: Record<string, string>, signatures: Record<string, string> = {}): void {
    const all: Record<string, string> = { ...files };
    for (const [url, body] of Object.entries(files)) {
      all[`${url}.sig`] = signatures[url] ?? signatureDocument(Buffer.from(body, 'utf-8'), pinned);
    }
    gateway.fetchBufferedImpl = async ({ url }) =>
      all[url] === undefined ? fetchResult(404) : fetchResult(200, all[url]);
  }

  function spanishSource(): ModuleCatalog | undefined {
    return repo.sources.find((source) => source.url === SPANISH_CATALOG_URL);
  }

  it('adds a catalog the signed index lists, and fetches it in the same refresh', async () => {
    serve({
      [INDEX_URL]: INDEX_JSON,
      [ROOT_CATALOG_URL]: catalogJson('English'),
      [SPANISH_CATALOG_URL]: catalogJson('Spanish'),
    });

    const refreshed = await service.refreshAllCatalogs();

    // The root catalog was already known through the seeded row - not added twice.
    expect(repo.sources).toHaveLength(2);
    const spanish = spanishSource();
    expect(spanish).toMatchObject({ name: 'Módulos en español', abbreviation: 'ES', type: 'official', isEnabled: true });
    expect(spanish?.signatureStatus).toBe('verified');
    expect(spanish?.signingPublicKey).toBe(pinned.publicKeyHex);
    expect(refreshed).toHaveLength(2);
  });

  it('adds nothing from an unsigned index', async () => {
    serve({ [INDEX_URL]: INDEX_JSON, [ROOT_CATALOG_URL]: catalogJson('English') }, { [INDEX_URL]: '' });

    await service.refreshAllCatalogs();

    expect(repo.sources).toHaveLength(1);
  });

  it('adds nothing from an index signed by a key it does not trust', async () => {
    const stranger = makeKey();
    serve(
      { [INDEX_URL]: INDEX_JSON, [ROOT_CATALOG_URL]: catalogJson('English') },
      { [INDEX_URL]: signatureDocument(Buffer.from(INDEX_JSON, 'utf-8'), stranger) },
    );

    await service.refreshAllCatalogs();

    expect(repo.sources).toHaveLength(1);
  });

  it('still refuses a listed catalog that is not signed by a trusted key', async () => {
    const stranger = makeKey();
    const spanish = catalogJson('Spanish');
    serve(
      { [INDEX_URL]: INDEX_JSON, [ROOT_CATALOG_URL]: catalogJson('English'), [SPANISH_CATALOG_URL]: spanish },
      { [SPANISH_CATALOG_URL]: signatureDocument(Buffer.from(spanish, 'utf-8'), stranger) },
    );

    const refreshed = await service.refreshAllCatalogs();

    // The source is listed, but its catalog never loads.
    expect(spanishSource()?.catalogJson).toBeUndefined();
    expect(refreshed.map((source) => source.url)).toEqual([SCOPE]);
  });

  it('leaves a catalog the user disabled alone', async () => {
    repo.create(
      new ModuleCatalog({ name: 'Spanish', url: SPANISH_CATALOG_URL, type: 'official', isEnabled: false }),
    );
    serve({
      [INDEX_URL]: INDEX_JSON,
      [ROOT_CATALOG_URL]: catalogJson('English'),
      [SPANISH_CATALOG_URL]: catalogJson('Spanish'),
    });

    await service.refreshAllCatalogs();

    expect(repo.sources).toHaveLength(2);
    expect(spanishSource()?.isEnabled).toBe(false);
  });

  it('refreshes as before when the server publishes no index', async () => {
    serve({ [ROOT_CATALOG_URL]: catalogJson('English') });

    const refreshed = await service.refreshAllCatalogs();

    expect(repo.sources).toHaveLength(1);
    expect(refreshed[0].signatureStatus).toBe('verified');
  });

  describe('a source that serves only an index', () => {
    const ENGLISH_CATALOG_URL = `${SCOPE}modules/en/catalog.json`;
    const ENGLISH_ONLY_INDEX = JSON.stringify({
      format: CATALOG_INDEX_FORMAT,
      version: CATALOG_INDEX_VERSION,
      catalogs: [{ url: 'modules/en/catalog.json', name: 'Official English Repository', abbreviation: 'EN' }],
    });
    const ENGLISH_CATALOG = JSON.stringify({
      repository: { name: 'English', url: SCOPE, version: '1.0' },
      modules: [{ module_id: 'kjv', module_type: 'bible', name: 'KJV', download_url: 'bible/bible_kjv.db.gz' }],
    });

    function englishSource(): ModuleCatalog | undefined {
      return repo.sources.find((source) => source.url === ENGLISH_CATALOG_URL);
    }

    it('becomes an index, and the catalogs it lists are added and fetched', async () => {
      serve({ [INDEX_URL]: ENGLISH_ONLY_INDEX, [ENGLISH_CATALOG_URL]: ENGLISH_CATALOG });

      const refreshed = await service.refreshAllCatalogs();

      const root = repo.sources[0];
      expect(root.signatureStatus).toBe('verified');
      expect(root.catalogJson).toBeUndefined();
      expect(englishSource()).toMatchObject({ name: 'Official English Repository', type: 'official' });
      expect(englishSource()?.signatureStatus).toBe('verified');
      expect(refreshed.map((source) => source.url)).toEqual([SCOPE, ENGLISH_CATALOG_URL]);
      // Served by the seeded source, so the official sync leaves it to that source.
      expect(gateway.fetchCalls.filter((call) => call.url === INDEX_URL)).toHaveLength(1);
    });

    it('resolves download URLs against the listed catalog document', async () => {
      serve({ [INDEX_URL]: ENGLISH_ONLY_INDEX, [ENGLISH_CATALOG_URL]: ENGLISH_CATALOG });

      await service.refreshAllCatalogs();

      expect(service.getAllAvailableModules().map((module) => module.download_url)).toEqual([
        `${SCOPE}modules/en/bible/bible_kjv.db.gz`,
      ]);
    });

    it('adds and fetches the listed catalogs when refreshed on its own', async () => {
      serve({ [INDEX_URL]: ENGLISH_ONLY_INDEX, [ENGLISH_CATALOG_URL]: ENGLISH_CATALOG });

      const root = await service.refreshCatalog(repo.sources[0].catalogId!);

      expect(root.signatureStatus).toBe('verified');
      expect(englishSource()?.signatureStatus).toBe('verified');
    });

    it('drops a catalog the source used to serve itself', async () => {
      serve({ [ROOT_CATALOG_URL]: catalogJson('English') });
      await service.refreshAllCatalogs();
      serve({ [INDEX_URL]: ENGLISH_ONLY_INDEX, [ENGLISH_CATALOG_URL]: ENGLISH_CATALOG });

      await service.refreshAllCatalogs();

      expect(repo.sources[0].catalogJson).toBeUndefined();
      expect(service.getAllAvailableModules().map((module) => module.module_id)).toEqual(['kjv']);
    });
  });

  it('fails a source that serves neither a catalog nor an index', async () => {
    serve({});

    await expect(service.refreshCatalog(repo.sources[0].catalogId!)).rejects.toThrow(
      /No catalog or catalog index/,
    );
  });

  it('reads the index of a source outside the official domain, within that source only', async () => {
    const base = 'https://example.org/repo/';
    const french = `${base}fr/catalog.json`;
    const index = JSON.stringify({
      format: CATALOG_INDEX_FORMAT,
      version: CATALOG_INDEX_VERSION,
      catalogs: [
        { url: 'fr/catalog.json', name: 'Français' },
        { url: '../elsewhere/catalog.json', name: 'Elsewhere' },
      ],
    });
    const third = repo.create(new ModuleCatalog({ name: 'Third party', url: base, type: 'third_party' }));
    // Unsigned throughout: a third-party source is trusted on first use.
    serve(
      { [`${base}index.json`]: index, [french]: catalogJson('French') },
      { [`${base}index.json`]: '', [french]: '' },
    );

    await service.refreshCatalog(third.catalogId!);

    expect(repo.sources.map((source) => source.url)).toEqual([SCOPE, base, french]);
    expect(repo.sources[2]).toMatchObject({ type: 'third_party', signatureStatus: 'unsigned' });
    expect(third.signatureStatus).toBe('unsigned');
  });
});
