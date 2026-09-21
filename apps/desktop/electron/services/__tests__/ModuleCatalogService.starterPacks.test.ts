/**
 * `ModuleCatalogService` starter-pack provenance and same-catalog resolution.
 *
 * Covers the gaps `design-pack-trust.md` calls out:
 *  - first run only ever offers packs from the verified official catalog -
 *    third-party and unsigned catalogs are excluded outright;
 *  - `getStarterPackModules` resolves a pack's `module_ids` against ITS OWN
 *    catalog only, so a same-id module published by a different (even
 *    official-looking) catalog can never shadow it;
 *  - `getModuleInfo(id, catalogId)` has the same same-catalog discipline, used
 *    by `installModule` for a starter-pack install.
 *
 * Uses the pinned-official-catalog test hook (`__setOfficialPublicKeysForTests`)
 * and the same `FakeCatalogRepository` shape as
 * `ModuleCatalogService.refreshAll.test.ts`, so no real network or database is
 * involved - only the catalog-row bookkeeping these methods read.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModuleCatalog, BUNDLED_STARTER_PACKS, type ISql, type ModuleCatalogRepository } from '@bible/core';

import { ModuleCatalogService } from '../ModuleCatalogService';
import { FakeNetworkGateway } from './fakeNetworkGateway';
import {
  OFFICIAL_CATALOG_URL_PREFIXES,
  __setOfficialPublicKeysForTests,
} from '../trustedCatalogKeys';

const stubSql = {} as unknown as ISql;
const OFFICIAL_URL = `${OFFICIAL_CATALOG_URL_PREFIXES[0]}catalog.json`;
const OFFICIAL_KEY = 'a'.repeat(64);

/** Just enough of `ModuleCatalogRepository` for these read-only methods. */
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

function starterPackCatalogJson(moduleId: string, moduleName: string, packId = 'en-starter'): string {
  return JSON.stringify({
    repository: { name: 'Official', url: OFFICIAL_URL, version: '1.0' },
    modules: [
      {
        module_id: moduleId,
        module_type: 'bible',
        name: moduleName,
        download_url: `${moduleId}.db.gz`,
        download_size_bytes: 1000,
        checksum: 'sha256:abc',
      },
    ],
    starter_packs: [
      {
        pack_id: packId,
        languages: ['en'],
        name: 'English starter',
        description: 'A starter pack.',
        version: '1.0.0',
        module_ids: [moduleId],
      },
    ],
  });
}

describe('ModuleCatalogService starter packs and same-catalog resolution', () => {
  let repo: FakeCatalogRepository;
  let service: ModuleCatalogService;

  beforeEach(() => {
    __setOfficialPublicKeysForTests([OFFICIAL_KEY]);
    repo = new FakeCatalogRepository();
    service = new ModuleCatalogService(stubSql, new FakeNetworkGateway(), {
      catalogRepository: repo as unknown as ModuleCatalogRepository,
    });
  });

  afterEach(() => {
    __setOfficialPublicKeysForTests(undefined);
  });

  function addCatalog(opts: {
    url: string;
    catalogJson: string;
    signatureStatus?: 'verified' | 'unsigned' | 'untrusted_key' | 'invalid' | 'error';
    type?: 'official' | 'third_party';
    isEnabled?: boolean;
  }): ModuleCatalog {
    const entry = new ModuleCatalog({
      name: opts.type === 'third_party' ? 'Third party' : 'Official',
      url: opts.url,
      type: opts.type ?? 'official',
      isEnabled: opts.isEnabled ?? true,
    });
    const created = repo.create(entry);
    created.setCatalog(JSON.parse(opts.catalogJson));
    created.signatureStatus = opts.signatureStatus ?? 'verified';
    return created;
  }

  describe('getStarterPacksForLanguage / getAvailableStarterPacks', () => {
    it('offers a pack from the verified official catalog, carrying its source', () => {
      addCatalog({ url: OFFICIAL_URL, catalogJson: starterPackCatalogJson('official-kjv', 'Official KJV') });

      const packs = service.getStarterPacksForLanguage('en').filter(p => p.pack_id === 'en-starter');
      expect(packs).toHaveLength(1);
      expect(packs[0].source.verifiedOfficial).toBe(true);
      expect(packs[0].source.catalogId).toBe(repo.sources[0].catalogId);
    });

    describe('the bundled packs (starter-packs.json)', () => {
      const bundledIds = () => BUNDLED_STARTER_PACKS.map(p => p.pack_id);
      const catalogWithoutPacks = () => JSON.stringify({
        repository: { name: 'Official', url: OFFICIAL_URL, version: '1.0' },
        modules: [
          { module_id: 'bible_kjv', module_type: 'bible', name: 'KJV', download_url: 'bible_kjv.db.gz', download_size_bytes: 1, checksum: 'sha256:a' },
          { module_id: 'commentary_mhc', module_type: 'commentary', name: 'MHC', download_url: 'commentary_mhc.db.gz', download_size_bytes: 1, checksum: 'sha256:b' },
        ],
      });

      it('are offered on the verified official catalog even when it publishes no packs', () => {
        addCatalog({ url: OFFICIAL_URL, catalogJson: catalogWithoutPacks() });

        const offered = service.getStarterPacksForLanguage('en');
        expect(offered.map(p => p.pack_id)).toEqual(expect.arrayContaining(bundledIds()));
        expect(offered.every(p => p.source.verifiedOfficial)).toBe(true);
      });

      it('are not offered from a third-party or unverified catalog', () => {
        addCatalog({ url: 'https://third-party.example/catalog.json', catalogJson: catalogWithoutPacks(), type: 'third_party' });
        addCatalog({ url: OFFICIAL_URL, catalogJson: catalogWithoutPacks(), signatureStatus: 'unsigned' });

        expect(service.getStarterPacksForLanguage('en')).toEqual([]);
      });

      it('are resolved against that catalog only, skipping ids it does not offer', () => {
        const catalog = addCatalog({ url: OFFICIAL_URL, catalogJson: catalogWithoutPacks() });

        const { pack, modules } = service.getStarterPackModules('essentials', catalog.catalogId!);

        expect(pack?.pack_id).toBe('essentials');
        // The catalog offers only two of the pack's modules; the rest are dropped.
        expect(modules.map(m => m.module_id)).toEqual(['bible_kjv', 'commentary_mhc']);
      });

      it('yield to a pack the catalog publishes under the same id', () => {
        const catalog = addCatalog({
          url: OFFICIAL_URL,
          catalogJson: starterPackCatalogJson('bible_kjv', 'KJV', 'essentials'),
        });

        const offered = service.getStarterPacksForLanguage('en').filter(p => p.pack_id === 'essentials');
        expect(offered).toHaveLength(1);
        expect(offered[0].name).toBe('English starter');
        expect(service.getStarterPackModules('essentials', catalog.catalogId!).modules.map(m => m.module_id)).toEqual(['bible_kjv']);
      });
    });

    it('excludes a pack from a third-party catalog', () => {
      addCatalog({
        url: 'https://third-party.example/catalog.json',
        catalogJson: starterPackCatalogJson('third-party-kjv', 'Third-party KJV'),
        type: 'third_party',
        signatureStatus: 'verified',
      });

      expect(service.getStarterPacksForLanguage('en')).toEqual([]);
    });

    it('excludes a pack from the official URL when its signature is not (yet) verified', () => {
      addCatalog({
        url: OFFICIAL_URL,
        catalogJson: starterPackCatalogJson('official-kjv', 'Official KJV'),
        signatureStatus: 'unsigned',
      });

      expect(service.getStarterPacksForLanguage('en')).toEqual([]);
    });

    it('excludes a disabled catalog even if it is otherwise the verified official one', () => {
      addCatalog({
        url: OFFICIAL_URL,
        catalogJson: starterPackCatalogJson('official-kjv', 'Official KJV'),
        isEnabled: false,
      });

      expect(service.getStarterPacksForLanguage('en')).toEqual([]);
    });
  });

  describe('getStarterPackModules (same-catalog resolution)', () => {
    it('ignores a same-id module published by a different catalog', () => {
      const official = addCatalog({ url: OFFICIAL_URL, catalogJson: starterPackCatalogJson('shared-id', 'Official Bible') });
      addCatalog({
        url: 'https://shadow.example/catalog.json',
        catalogJson: starterPackCatalogJson('shared-id', 'Malicious shadow module', 'shadow-pack'),
        type: 'third_party',
      });

      const { pack, modules } = service.getStarterPackModules('en-starter', official.catalogId!);
      expect(pack?.pack_id).toBe('en-starter');
      expect(modules).toHaveLength(1);
      expect(modules[0].name).toBe('Official Bible');
    });

    it('returns no modules when catalogId is disabled', () => {
      const official = addCatalog({ url: OFFICIAL_URL, catalogJson: starterPackCatalogJson('official-kjv', 'Official KJV') });
      official.isEnabled = false;
      repo.update(official);

      const { modules } = service.getStarterPackModules('en-starter', official.catalogId!);
      expect(modules).toEqual([]);
    });

    it('returns no modules when catalogId no longer resolves', () => {
      const { modules } = service.getStarterPackModules('en-starter', 9999);
      expect(modules).toEqual([]);
    });
  });

  describe('getModuleInfo(id, catalogId)', () => {
    it('resolves only within the given catalog, never across every enabled catalog', () => {
      addCatalog({ url: OFFICIAL_URL, catalogJson: starterPackCatalogJson('shared-id', 'Official Bible') });
      const shadow = addCatalog({
        url: 'https://shadow.example/catalog.json',
        catalogJson: starterPackCatalogJson('shared-id', 'Malicious shadow module', 'shadow-pack'),
        type: 'third_party',
      });

      const found = service.getModuleInfo('shared-id', shadow.catalogId!);
      expect(found?.name).toBe('Malicious shadow module');
      expect(found?.download_url).toContain('shadow.example');
    });

    it('still searches every enabled catalog when catalogId is omitted (Module Manager behaviour, unchanged)', () => {
      addCatalog({ url: OFFICIAL_URL, catalogJson: starterPackCatalogJson('official-kjv', 'Official KJV') });

      expect(service.getModuleInfo('official-kjv')?.name).toBe('Official KJV');
      expect(service.getModuleInfo('does-not-exist')).toBeUndefined();
    });
  });
});
