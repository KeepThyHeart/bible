import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainTestHelper } from './helpers/MainTestHelper';
import { ModuleCatalogRepository } from '../Data/Repositories/ModuleCatalogRepository';
import { ModuleCatalog } from '../Data/Models/Main/ModuleCatalog';
import { CatalogSourceType } from '../Data/Models/Main/ModuleCatalog';

describe('ModuleCatalogRepository', () => {
  let repo: ModuleCatalogRepository;

  beforeAll(() => {
    MainTestHelper.initializeWithFullSchema();
    repo = new ModuleCatalogRepository(MainTestHelper.getProvider());
  });

  afterAll(() => {
    MainTestHelper.cleanup();
  });

  beforeEach(() => {
    MainTestHelper.clearData();
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  function createTestRepo(overrides: Partial<{
    name: string;
    abbreviation: string;
    url: string;
    type: CatalogSourceType;
    isEnabled: boolean;
    priority: number;
    catalogJson: string;
    lastUpdated: string;
    lastFetched: string;
    metadata: Record<string, unknown>;
  }> = {}): ModuleCatalog {
    return new ModuleCatalog({
      name: overrides.name ?? 'Test Repository',
      abbreviation: overrides.abbreviation,
      url: overrides.url ?? 'https://example.com/repo',
      type: overrides.type ?? 'official',
      isEnabled: overrides.isEnabled,
      priority: overrides.priority,
      catalogJson: overrides.catalogJson,
      lastUpdated: overrides.lastUpdated,
      lastFetched: overrides.lastFetched,
      metadata: overrides.metadata,
    });
  }

  // ==========================================================================
  // CRUD Tests
  // ==========================================================================

  describe('create', () => {
    it('should create a repository and return it with catalogId set', () => {
      const entity = createTestRepo({ name: 'My Repo', url: 'https://my.repo/modules' });
      const created = repo.create(entity);

      expect(created.catalogId).toBeDefined();
      expect(created.catalogId).toBeGreaterThan(0);
      expect(created.name).toBe('My Repo');
      expect(created.url).toBe('https://my.repo/modules');
      expect(created.type).toBe('official');
      expect(created.isEnabled).toBe(true);
      expect(created.priority).toBe(0);
    });

    it('should persist all optional fields', () => {
      const entity = createTestRepo({
        name: 'Full Repo',
        abbreviation: 'FR',
        url: 'https://full.repo',
        type: 'crosswire',
        isEnabled: false,
        priority: 50,
        catalogJson: '{"modules":[]}',
        lastUpdated: '2025-01-15T10:00:00.000Z',
        lastFetched: '2025-01-15T12:00:00.000Z',
        metadata: { source: 'test', version: 2 },
      });
      const created = repo.create(entity);

      const fetched = repo.getById(created.catalogId!);
      expect(fetched).toBeDefined();
      expect(fetched!.abbreviation).toBe('FR');
      expect(fetched!.type).toBe('crosswire');
      expect(fetched!.isEnabled).toBe(false);
      expect(fetched!.priority).toBe(50);
      expect(fetched!.catalogJson).toBe('{"modules":[]}');
      expect(fetched!.lastUpdated).toBe('2025-01-15T10:00:00.000Z');
      expect(fetched!.lastFetched).toBe('2025-01-15T12:00:00.000Z');
    });
  });

  describe('getById', () => {
    it('should return the repository when found', () => {
      const created = repo.create(createTestRepo({ name: 'Find Me' }));
      const found = repo.getById(created.catalogId!);

      expect(found).toBeDefined();
      expect(found!.name).toBe('Find Me');
    });

    it('should return undefined for non-existent ID', () => {
      const found = repo.getById(99999);
      expect(found).toBeUndefined();
    });
  });

  describe('getByUrl', () => {
    it('should return the repository matching the URL', () => {
      repo.create(createTestRepo({ name: 'URL Repo', url: 'https://unique.url/repo' }));
      const found = repo.getByUrl('https://unique.url/repo');

      expect(found).toBeDefined();
      expect(found!.name).toBe('URL Repo');
    });

    it('should return undefined for non-existent URL', () => {
      const found = repo.getByUrl('https://does-not-exist.com');
      expect(found).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update all mutable fields', () => {
      const created = repo.create(createTestRepo({ name: 'Original' }));
      created.name = 'Updated';
      created.abbreviation = 'UPD';
      created.type = 'third_party';
      created.priority = 100;

      const updated = repo.update(created);
      expect(updated.name).toBe('Updated');

      const fetched = repo.getById(created.catalogId!);
      expect(fetched!.name).toBe('Updated');
      expect(fetched!.abbreviation).toBe('UPD');
      expect(fetched!.type).toBe('third_party');
      expect(fetched!.priority).toBe(100);
    });

    it('should throw when updating without an ID', () => {
      const entity = createTestRepo({ name: 'No ID' });
      expect(() => repo.update(entity)).toThrow('Cannot update repository without ID');
    });
  });

  describe('delete', () => {
    it('should delete an existing repository and return true', () => {
      const created = repo.create(createTestRepo());
      const result = repo.delete(created.catalogId!);

      expect(result).toBe(true);
      expect(repo.getById(created.catalogId!)).toBeUndefined();
    });

    it('should return false when deleting a non-existent ID', () => {
      const result = repo.delete(99999);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Query / Filter Tests
  // ==========================================================================

  describe('getAll', () => {
    it('should return all repositories ordered by priority DESC by default', () => {
      repo.create(createTestRepo({ name: 'Low', priority: 1, url: 'https://low.com' }));
      repo.create(createTestRepo({ name: 'High', priority: 100, url: 'https://high.com' }));
      repo.create(createTestRepo({ name: 'Mid', priority: 50, url: 'https://mid.com' }));

      const all = repo.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].name).toBe('High');
      expect(all[1].name).toBe('Mid');
      expect(all[2].name).toBe('Low');
    });

    it('should support pagination with limit and offset', () => {
      for (let i = 1; i <= 5; i++) {
        repo.create(createTestRepo({
          name: `Repo ${i}`,
          priority: i * 10,
          url: `https://repo${i}.com`,
        }));
      }

      const page = repo.getAll({ limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
      // priority DESC: 50, 40, 30, 20, 10 -> offset 1 gives [40, 30]
      expect(page[0].name).toBe('Repo 4');
      expect(page[1].name).toBe('Repo 3');
    });

    it('should support custom orderBy', () => {
      repo.create(createTestRepo({ name: 'Zebra', url: 'https://z.com' }));
      repo.create(createTestRepo({ name: 'Alpha', url: 'https://a.com' }));

      const sorted = repo.getAll({ orderBy: 'name', orderDirection: 'ASC' });
      expect(sorted[0].name).toBe('Alpha');
      expect(sorted[1].name).toBe('Zebra');
    });
  });

  describe('getEnabled', () => {
    it('should return only enabled repositories ordered by priority DESC', () => {
      repo.create(createTestRepo({ name: 'Enabled High', isEnabled: true, priority: 90, url: 'https://e-high.com' }));
      repo.create(createTestRepo({ name: 'Disabled', isEnabled: false, priority: 100, url: 'https://disabled.com' }));
      repo.create(createTestRepo({ name: 'Enabled Low', isEnabled: true, priority: 10, url: 'https://e-low.com' }));

      const enabled = repo.getEnabled();
      expect(enabled).toHaveLength(2);
      expect(enabled[0].name).toBe('Enabled High');
      expect(enabled[1].name).toBe('Enabled Low');
    });

    it('should return empty array when none are enabled', () => {
      repo.create(createTestRepo({ isEnabled: false, url: 'https://d1.com' }));
      repo.create(createTestRepo({ isEnabled: false, url: 'https://d2.com' }));

      const enabled = repo.getEnabled();
      expect(enabled).toHaveLength(0);
    });
  });

  describe('getByType', () => {
    it('should return only repositories of the specified type', () => {
      repo.create(createTestRepo({ name: 'Official', type: 'official', url: 'https://off.com' }));
      repo.create(createTestRepo({ name: 'CrossWire', type: 'crosswire', url: 'https://cw.com' }));
      repo.create(createTestRepo({ name: 'Local', type: 'local', url: 'https://local.com' }));
      repo.create(createTestRepo({ name: 'Third Party', type: 'third_party', url: 'https://tp.com' }));

      const crosswire = repo.getByType('crosswire');
      expect(crosswire).toHaveLength(1);
      expect(crosswire[0].name).toBe('CrossWire');

      const local = repo.getByType('local');
      expect(local).toHaveLength(1);
      expect(local[0].name).toBe('Local');
    });

    it('should return empty array for type with no matches', () => {
      repo.create(createTestRepo({ type: 'official', url: 'https://off.com' }));
      const result = repo.getByType('local');
      expect(result).toHaveLength(0);
    });
  });

  // ==========================================================================
  // setEnabled Tests
  // ==========================================================================

  describe('setEnabled', () => {
    it('should disable an enabled repository', () => {
      const created = repo.create(createTestRepo({ isEnabled: true }));
      repo.setEnabled(created.catalogId!, false);

      const fetched = repo.getById(created.catalogId!);
      expect(fetched!.isEnabled).toBe(false);
    });

    it('should enable a disabled repository', () => {
      const created = repo.create(createTestRepo({ isEnabled: false }));
      repo.setEnabled(created.catalogId!, true);

      const fetched = repo.getById(created.catalogId!);
      expect(fetched!.isEnabled).toBe(true);
    });
  });

  // ==========================================================================
  // updateCatalog Tests
  // ==========================================================================

  describe('updateCatalog', () => {
    it('should set catalogJson and update last_fetched', () => {
      const created = repo.create(createTestRepo());
      expect(created.lastFetched).toBeUndefined();

      const catalog = JSON.stringify({ modules: [{ id: 'kjv', name: 'KJV' }] });
      const beforeUpdate = new Date().toISOString();
      repo.updateCatalog(created.catalogId!, catalog);

      const fetched = repo.getById(created.catalogId!);
      expect(fetched!.catalogJson).toBe(catalog);
      expect(fetched!.lastFetched).toBeDefined();
      // last_fetched should be at or after the time we captured
      expect(fetched!.lastFetched! >= beforeUpdate).toBe(true);
    });
  });

  // ==========================================================================
  // getNeedingRefresh Tests
  // ==========================================================================

  describe('getNeedingRefresh', () => {
    it('should return enabled repos with null last_fetched', () => {
      repo.create(createTestRepo({ name: 'Never Fetched', isEnabled: true, url: 'https://nf.com' }));
      repo.create(createTestRepo({ name: 'Disabled No Fetch', isEnabled: false, url: 'https://dnf.com' }));

      const needing = repo.getNeedingRefresh();
      expect(needing).toHaveLength(1);
      expect(needing[0].name).toBe('Never Fetched');
    });

    it('should return enabled repos with old last_fetched', () => {
      const old = repo.create(createTestRepo({
        name: 'Stale',
        isEnabled: true,
        url: 'https://stale.com',
      }));
      // Manually set last_fetched to 30 days ago
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      MainTestHelper.getProvider().execute(
        'UPDATE module_repository SET last_fetched = ? WHERE repository_id = ?',
        [thirtyDaysAgo.toISOString(), old.catalogId!]
      );

      const needing = repo.getNeedingRefresh(7);
      expect(needing).toHaveLength(1);
      expect(needing[0].name).toBe('Stale');
    });

    it('should NOT return repos with recent last_fetched', () => {
      const fresh = repo.create(createTestRepo({
        name: 'Fresh',
        isEnabled: true,
        url: 'https://fresh.com',
      }));
      // Set last_fetched to now
      repo.updateCatalog(fresh.catalogId!, '{}');

      const needing = repo.getNeedingRefresh(7);
      expect(needing).toHaveLength(0);
    });

    it('should respect custom threshold days', () => {
      const entity = repo.create(createTestRepo({
        name: 'Two Days Old',
        isEnabled: true,
        url: 'https://twodays.com',
      }));
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      MainTestHelper.getProvider().execute(
        'UPDATE module_repository SET last_fetched = ? WHERE repository_id = ?',
        [twoDaysAgo.toISOString(), entity.catalogId!]
      );

      // With 7-day threshold, 2-day-old should NOT need refresh
      expect(repo.getNeedingRefresh(7)).toHaveLength(0);

      // With 1-day threshold, 2-day-old SHOULD need refresh
      expect(repo.getNeedingRefresh(1)).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Boolean and Metadata Round-Trip Tests
  // ==========================================================================

  describe('boolean isEnabled round-trip', () => {
    it('should correctly store and retrieve isEnabled as true', () => {
      const created = repo.create(createTestRepo({ isEnabled: true }));
      const fetched = repo.getById(created.catalogId!);
      expect(fetched!.isEnabled).toBe(true);
      expect(typeof fetched!.isEnabled).toBe('boolean');
    });

    it('should correctly store and retrieve isEnabled as false', () => {
      const created = repo.create(createTestRepo({ isEnabled: false }));
      const fetched = repo.getById(created.catalogId!);
      expect(fetched!.isEnabled).toBe(false);
      expect(typeof fetched!.isEnabled).toBe('boolean');
    });
  });

  describe('metadata JSON round-trip', () => {
    it('should persist and retrieve complex metadata', () => {
      const metadata = {
        source: 'sword',
        version: 3,
        tags: ['curated', 'verified'],
        nested: { key: 'value' },
      };
      const created = repo.create(createTestRepo({ metadata, url: 'https://meta.com' }));
      const fetched = repo.getById(created.catalogId!);

      expect(fetched!.metadata).toEqual(metadata);
    });

    it('should handle undefined metadata gracefully', () => {
      const created = repo.create(createTestRepo());
      const fetched = repo.getById(created.catalogId!);
      expect(fetched!.metadata).toBeUndefined();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle default isEnabled as true when not specified', () => {
      const entity = new ModuleCatalog({ name: 'Defaults', url: 'https://defaults.com', type: 'official' });
      expect(entity.isEnabled).toBe(true);
      expect(entity.priority).toBe(0);

      const created = repo.create(entity);
      const fetched = repo.getById(created.catalogId!);
      expect(fetched!.isEnabled).toBe(true);
      expect(fetched!.priority).toBe(0);
    });

    it('should return empty array from getAll when table is empty', () => {
      const all = repo.getAll();
      expect(all).toHaveLength(0);
    });
  });
});
