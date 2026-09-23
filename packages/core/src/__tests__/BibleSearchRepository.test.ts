import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainTestHelper } from './helpers/MainTestHelper';
import { BibleSearchRepository } from '../Data/Repositories/BibleSearchRepository';
import { SavedSearch } from '../Data/Models/Main/SavedSearch';

describe('BibleSearchRepository', () => {
  let repo: BibleSearchRepository;

  beforeAll(() => {
    MainTestHelper.initializeWithFullSchema();
    repo = new BibleSearchRepository(MainTestHelper.getProvider());
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

  function createSavedSearch(overrides: Partial<{
    name: string;
    query: string;
    searchType: SavedSearch['searchType'];
    scope: SavedSearch['scope'];
    options: SavedSearch['options'];
    lastUsed: string;
    useCount: number;
    metadata: Record<string, unknown>;
  }> = {}): SavedSearch {
    return new SavedSearch({
      name: overrides.name ?? 'Test Search',
      query: overrides.query ?? 'beginning',
      searchType: overrides.searchType ?? 'multi-word',
      scope: overrides.scope ?? { scope: 'currentModule' },
      options: overrides.options ?? {},
      lastUsed: overrides.lastUsed,
      useCount: overrides.useCount,
      metadata: overrides.metadata,
    });
  }

  // ==========================================================================
  // Saved Searches
  // ==========================================================================

  describe('Saved Searches', () => {
    it('should save a search and return it with searchId and createdDate', () => {
      const search = createSavedSearch({ name: 'Find love', query: 'love' });
      const saved = repo.saveSearch(search);

      expect(saved.searchId).toBeDefined();
      expect(saved.searchId).toBeGreaterThan(0);
      expect(saved.name).toBe('Find love');
      expect(saved.query).toBe('love');
      expect(saved.createdDate).toBeDefined();
      expect(saved.useCount).toBe(0);
    });

    it('should retrieve all saved searches ordered by name', () => {
      repo.saveSearch(createSavedSearch({ name: 'Zebra' }));
      repo.saveSearch(createSavedSearch({ name: 'Apple' }));
      repo.saveSearch(createSavedSearch({ name: 'Mango' }));

      const all = repo.getSavedSearches();
      expect(all.length).toBe(3);
      expect(all[0].name).toBe('Apple');
      expect(all[1].name).toBe('Mango');
      expect(all[2].name).toBe('Zebra');
    });

    it('should retrieve a saved search by ID', () => {
      const saved = repo.saveSearch(createSavedSearch({ name: 'By ID test' }));
      const found = repo.getSavedSearch(saved.searchId!);

      expect(found).toBeDefined();
      expect(found!.name).toBe('By ID test');
      expect(found!.searchType).toBe('multi-word');
    });

    it('should return undefined for non-existent search ID', () => {
      const found = repo.getSavedSearch(99999);
      expect(found).toBeUndefined();
    });

    it('should update a saved search', () => {
      const saved = repo.saveSearch(createSavedSearch({ name: 'Original' }));
      saved.name = 'Updated';
      saved.query = 'new query';
      saved.lastUsed = new Date().toISOString();
      saved.useCount = 5;

      repo.updateSavedSearch(saved);

      const found = repo.getSavedSearch(saved.searchId!);
      expect(found!.name).toBe('Updated');
      expect(found!.query).toBe('new query');
      expect(found!.useCount).toBe(5);
      expect(found!.lastUsed).toBeDefined();
    });

    it('should delete a saved search and return true', () => {
      const saved = repo.saveSearch(createSavedSearch());
      const deleted = repo.deleteSavedSearch(saved.searchId!);

      expect(deleted).toBe(true);
      expect(repo.getSavedSearch(saved.searchId!)).toBeUndefined();
    });

    it('should return false when deleting non-existent search', () => {
      const deleted = repo.deleteSavedSearch(99999);
      expect(deleted).toBe(false);
    });

    it('should get recent saved searches ordered by last_used DESC (only non-null)', () => {
      const s1 = repo.saveSearch(createSavedSearch({ name: 'Old' }));
      s1.lastUsed = '2025-01-01T00:00:00.000Z';
      repo.updateSavedSearch(s1);

      const s2 = repo.saveSearch(createSavedSearch({ name: 'New' }));
      s2.lastUsed = '2025-06-01T00:00:00.000Z';
      repo.updateSavedSearch(s2);

      // s3 has no lastUsed - should NOT appear
      repo.saveSearch(createSavedSearch({ name: 'Never Used' }));

      const recent = repo.getRecentSavedSearches(10);
      expect(recent.length).toBe(2);
      expect(recent[0].name).toBe('New');
      expect(recent[1].name).toBe('Old');
    });

    it('should respect limit on getRecentSavedSearches', () => {
      for (let i = 0; i < 5; i++) {
        const s = repo.saveSearch(createSavedSearch({ name: `S${i}` }));
        s.lastUsed = `2025-0${i + 1}-01T00:00:00.000Z`;
        repo.updateSavedSearch(s);
      }

      const recent = repo.getRecentSavedSearches(2);
      expect(recent.length).toBe(2);
    });

    it('should get popular saved searches ordered by use_count DESC', () => {
      const s1 = repo.saveSearch(createSavedSearch({ name: 'Low' }));
      s1.useCount = 3;
      repo.updateSavedSearch(s1);

      const s2 = repo.saveSearch(createSavedSearch({ name: 'High' }));
      s2.useCount = 100;
      repo.updateSavedSearch(s2);

      const s3 = repo.saveSearch(createSavedSearch({ name: 'Mid' }));
      s3.useCount = 20;
      repo.updateSavedSearch(s3);

      const popular = repo.getPopularSavedSearches(10);
      expect(popular.length).toBe(3);
      expect(popular[0].name).toBe('High');
      expect(popular[1].name).toBe('Mid');
      expect(popular[2].name).toBe('Low');
    });

    it('should round-trip scope and options JSON correctly', () => {
      const search = createSavedSearch({
        name: 'Complex scope',
        searchType: 'proximity',
        scope: {
          scope: 'range',
          modules: ['kjv', 'esv'],
          range: { startBook: 1, endBook: 5, predefinedRange: 'Pentateuch' },
        },
        options: {
          caseSensitive: true,
          wholeWord: true,
          proximityDistance: 5,
          maxResults: 50,
          includeContext: true,
        },
      });

      const saved = repo.saveSearch(search);
      const found = repo.getSavedSearch(saved.searchId!);

      expect(found!.scope.scope).toBe('range');
      expect(found!.scope.modules).toEqual(['kjv', 'esv']);
      expect(found!.scope.range!.predefinedRange).toBe('Pentateuch');
      expect(found!.options.caseSensitive).toBe(true);
      expect(found!.options.proximityDistance).toBe(5);
      expect(found!.options.maxResults).toBe(50);
    });

    it('should preserve metadata JSON on update', () => {
      const saved = repo.saveSearch(createSavedSearch({ name: 'With meta' }));
      saved.metadata = { color: 'blue', pinned: true };
      repo.updateSavedSearch(saved);

      const found = repo.getSavedSearch(saved.searchId!);
      expect(found!.metadata).toBeDefined();
      expect(found!.metadata!.color).toBe('blue');
      expect(found!.metadata!.pinned).toBe(true);
    });

    it('should handle empty saved search list gracefully', () => {
      expect(repo.getSavedSearches()).toEqual([]);
      expect(repo.getRecentSavedSearches()).toEqual([]);
      expect(repo.getPopularSavedSearches()).toEqual([]);
    });
  });
});
