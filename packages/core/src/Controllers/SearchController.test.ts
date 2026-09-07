import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchController } from './SearchController';
import { MockBibleSearchRepository } from '../__tests__/helpers/MockRepositories';
import { ISearchService } from '../Services/ISearchService';
import { SearchResult } from '../types/search';

/**
 * Minimal mock of ISearchService for testing SearchController.
 * Only the methods called by SearchController need real logic.
 */
function createMockSearchService(overrides?: Partial<ISearchService>): ISearchService {
  return {
    search: vi.fn(async () => []),
    parseQuery: vi.fn(() => ({
      originalQuery: '',
      searchType: 'multi-word' as const,
      terms: [],
    })),
    getSuggestions: vi.fn(async () => []),
    getIndexStatus: vi.fn(async () => new Map()),
    buildIndex: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('SearchController', () => {
  let ctrl: SearchController;
  let mockSearchService: ISearchService;
  let mockSearchRepo: MockBibleSearchRepository;

  beforeEach(() => {
    mockSearchRepo = new MockBibleSearchRepository();
    mockSearchService = createMockSearchService();
    ctrl = new SearchController(mockSearchService, mockSearchRepo);
  });

  // ==========================================================================
  // Constructor & Initial State
  // ==========================================================================

  describe('initial state', () => {
    it('should not be searching initially', () => {
      expect(ctrl.getIsSearching()).toBe(false);
    });

    it('should have empty current query', () => {
      expect(ctrl.getCurrentQuery()).toBe('');
    });
  });

  // ==========================================================================
  // detectQueryType
  // ==========================================================================

  describe('detectQueryType', () => {
    it('should detect Bible references', () => {
      const result = ctrl.detectQueryType('John 3:16');
      expect(result.isReference).toBe(true);
      expect(result.query).toBe('John 3:16');
    });

    it('should detect references with book number prefix', () => {
      expect(ctrl.detectQueryType('1 Corinthians 13').isReference).toBe(true);
      expect(ctrl.detectQueryType('2 Kings 5').isReference).toBe(true);
    });

    it('should detect non-references (search queries)', () => {
      const result = ctrl.detectQueryType('love your neighbor');
      expect(result.isReference).toBe(false);
    });

    it('should trim whitespace', () => {
      const result = ctrl.detectQueryType('  John 3:16  ');
      expect(result.query).toBe('John 3:16');
    });
  });

  // ==========================================================================
  // performSearch
  // ==========================================================================

  describe('performSearch', () => {
    it('should call search service and return results', async () => {
      const mockResults: SearchResult[] = [
        {
          verseId: 43003016,
          module: 'kjv',
          reference: 'John 3:16',
          text: 'For God so loved...',
          matches: [],
          score: 1.0,
          type: 'exact',
        },
      ];
      mockSearchService = createMockSearchService({
        search: vi.fn(async () => mockResults),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      const results = await ctrl.performSearch('love', {});

      expect(results).toHaveLength(1);
      expect(results[0].verseId).toBe(43003016);
      expect(mockSearchService.search).toHaveBeenCalledWith('love', {});
    });

    it('should set isSearching flag during search', async () => {
      let resolveSearch: () => void;
      const searchPromise = new Promise<SearchResult[]>(resolve => {
        resolveSearch = () => resolve([]);
      });
      mockSearchService = createMockSearchService({
        search: vi.fn(() => searchPromise),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      const promise = ctrl.performSearch('test', {});
      expect(ctrl.getIsSearching()).toBe(true);

      resolveSearch!();
      await promise;
      expect(ctrl.getIsSearching()).toBe(false);
    });

    it('should reject concurrent searches', async () => {
      let resolveSearch: () => void;
      const searchPromise = new Promise<SearchResult[]>(resolve => {
        resolveSearch = () => resolve([]);
      });
      mockSearchService = createMockSearchService({
        search: vi.fn(() => searchPromise),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      const first = ctrl.performSearch('first', {});

      await expect(ctrl.performSearch('second', {})).rejects.toThrow(
        'Search already in progress'
      );

      resolveSearch!();
      await first;
    });

    it('should clear isSearching flag even on error', async () => {
      mockSearchService = createMockSearchService({
        search: vi.fn(async () => {
          throw new Error('Search failed');
        }),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      await expect(ctrl.performSearch('test', {})).rejects.toThrow('Search failed');
      expect(ctrl.getIsSearching()).toBe(false);
    });

    it('should reject empty query', async () => {
      await expect(ctrl.performSearch('', {})).rejects.toThrow();
    });

    it('should reject query with unmatched quotes', async () => {
      await expect(ctrl.performSearch('"unmatched', {})).rejects.toThrow();
    });

    it('should update currentQuery', async () => {
      await ctrl.performSearch('test query', {});
      expect(ctrl.getCurrentQuery()).toBe('test query');
    });
  });

  // ==========================================================================
  // cancelSearch
  // ==========================================================================

  describe('cancelSearch', () => {
    it('should reset isSearching flag', () => {
      // Manually put into searching state
      ctrl.cancelSearch();
      expect(ctrl.getIsSearching()).toBe(false);
    });
  });

  // ==========================================================================
  // getSuggestions
  // ==========================================================================

  describe('getSuggestions', () => {
    it('should delegate to search service', async () => {
      mockSearchService = createMockSearchService({
        getSuggestions: vi.fn(async () => ['love', 'lover', 'loved']),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      const suggestions = await ctrl.getSuggestions('lov', 3);

      expect(suggestions).toEqual(['love', 'lover', 'loved']);
      expect(mockSearchService.getSuggestions).toHaveBeenCalledWith('lov', 3);
    });
  });

  // ==========================================================================
  // Saved Searches
  // ==========================================================================

  describe('saved searches', () => {
    it('should save current search', async () => {
      await ctrl.performSearch('love', {});

      const saved = ctrl.saveCurrentSearch('Love search', {
        scope: 'currentModule',
        caseSensitive: false,
      });

      expect(saved.searchId).toBeDefined();
      expect(saved.name).toBe('Love search');
      expect(saved.query).toBe('love');
    });

    it('should list saved searches', async () => {
      await ctrl.performSearch('love', {});
      ctrl.saveCurrentSearch('Search 1', {});

      await ctrl.performSearch('faith', {});
      ctrl.saveCurrentSearch('Search 2', {});

      const saved = ctrl.getSavedSearches();
      expect(saved).toHaveLength(2);
    });

    it('should load a saved search and mark it as used', async () => {
      await ctrl.performSearch('love', {});
      const saved = ctrl.saveCurrentSearch('Love', { scope: 'allBibles' });

      const loaded = ctrl.loadSavedSearch(saved.searchId!);

      expect(loaded).toBeDefined();
      expect(loaded!.query).toBe('love');
      expect(loaded!.options.scope).toBe('allBibles');

      // Verify use count incremented
      const updated = mockSearchRepo.getSavedSearch(saved.searchId!);
      expect(updated!.useCount).toBe(1);
    });

    it('should return undefined for non-existent saved search', () => {
      const loaded = ctrl.loadSavedSearch(999);
      expect(loaded).toBeUndefined();
    });

    it('should delete a saved search', async () => {
      await ctrl.performSearch('love', {});
      const saved = ctrl.saveCurrentSearch('Love', {});

      const deleted = ctrl.deleteSavedSearch(saved.searchId!);
      expect(deleted).toBe(true);
      expect(ctrl.getSavedSearches()).toHaveLength(0);
    });

    it('should get recent saved searches', async () => {
      await ctrl.performSearch('love', {});
      ctrl.saveCurrentSearch('Love', {});

      const recent = ctrl.getRecentSavedSearches(5);
      expect(recent).toHaveLength(1);
    });

    it('should get popular saved searches', async () => {
      await ctrl.performSearch('love', {});
      const saved = ctrl.saveCurrentSearch('Love', {});

      // Use it a few times
      ctrl.loadSavedSearch(saved.searchId!);
      ctrl.loadSavedSearch(saved.searchId!);

      const popular = ctrl.getPopularSavedSearches(5);
      expect(popular).toHaveLength(1);
      expect(popular[0].useCount).toBe(2);
    });
  });

  // ==========================================================================
  // Search History

  // ==========================================================================
  // Index Management
  // ==========================================================================

  describe('index management', () => {
    it('should get index status', async () => {
      const statusMap = new Map([
        ['kjv', { indexed: true, lastIndexed: '2025-01-01', booksIndexed: 66, totalBooks: 66 }],
      ]);
      mockSearchService = createMockSearchService({
        getIndexStatus: vi.fn(async () => statusMap),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      const status = await ctrl.getIndexStatus(['kjv']);
      expect(status.get('kjv')!.indexed).toBe(true);
    });

    it('should detect when indexing is needed', async () => {
      const statusMap = new Map([
        ['kjv', { indexed: false }],
      ]);
      mockSearchService = createMockSearchService({
        getIndexStatus: vi.fn(async () => statusMap),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      expect(await ctrl.needsIndexing(['kjv'])).toBe(true);
    });

    it('should detect when indexing is not needed', async () => {
      const statusMap = new Map([
        ['kjv', { indexed: true }],
      ]);
      mockSearchService = createMockSearchService({
        getIndexStatus: vi.fn(async () => statusMap),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      expect(await ctrl.needsIndexing(['kjv'])).toBe(false);
    });

    it('should build index for modules', async () => {
      await ctrl.buildIndex(['kjv', 'esv']);
      expect(mockSearchService.buildIndex).toHaveBeenCalledTimes(2);
    });

    it('should pass progress callback through to service', async () => {
      const progressUpdates: any[] = [];
      mockSearchService = createMockSearchService({
        buildIndex: vi.fn(async (_module, _books, onProgress) => {
          if (onProgress) {
            onProgress({ current: 1, total: 66, bookName: 'Genesis' });
          }
        }),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      await ctrl.buildIndex(['kjv'], (progress) => {
        progressUpdates.push(progress);
      });

      expect(progressUpdates).toHaveLength(1);
      expect(progressUpdates[0].module).toBe('kjv');
      expect(progressUpdates[0].bookName).toBe('Genesis');
    });
  });

  // ==========================================================================
  // Query Helpers
  // ==========================================================================

  describe('validateQuery', () => {
    it('should return undefined for valid query', () => {
      expect(ctrl.validateQuery('love')).toBeUndefined();
    });

    it('should return error for empty query', () => {
      expect(ctrl.validateQuery('')).toBeDefined();
    });

    it('should return error for unmatched quotes', () => {
      expect(ctrl.validateQuery('"unmatched')).toBeDefined();
    });

    it('should return error for unmatched parens', () => {
      expect(ctrl.validateQuery('(unmatched')).toBeDefined();
    });
  });

  describe('parseQuery', () => {
    it('should parse multi-word query', () => {
      const parsed = ctrl.parseQuery('love faith');
      expect(parsed.searchType).toBe('multi-word');
      expect(parsed.terms).toEqual(['love', 'faith']);
    });

    it('should parse phrase query', () => {
      const parsed = ctrl.parseQuery('"exact phrase"');
      expect(parsed.searchType).toBe('phrase');
      expect(parsed.phrase).toBe('exact phrase');
    });

    it('should parse strongs query', () => {
      const parsed = ctrl.parseQuery('G26');
      expect(parsed.searchType).toBe('strongs');
      expect(parsed.strongs).toBe('G26');
    });
  });

  describe('extractPhrases', () => {
    it('should extract quoted phrases', () => {
      const phrases = ctrl.extractPhrases('"love your" neighbor "as yourself"');
      expect(phrases).toEqual(['love your', 'as yourself']);
    });

    it('should return empty for no phrases', () => {
      expect(ctrl.extractPhrases('no quotes here')).toEqual([]);
    });
  });

  describe('getSpellingSuggestions', () => {
    it('should suggest KJV spellings', () => {
      const suggestions = ctrl.getSpellingSuggestions('neighbor');
      expect(suggestions).toContain('neighbour');
    });

    it('should return empty for unknown words', () => {
      const suggestions = ctrl.getSpellingSuggestions('xyz');
      expect(suggestions).toEqual([]);
    });
  });

  // ==========================================================================
  // Error Recovery & Edge Cases (Hardening)
  // ==========================================================================

  describe('error recovery', () => {
    it('should reset isSearching when search service throws', async () => {
      mockSearchService = createMockSearchService({
        search: vi.fn(async () => { throw new Error('DB connection lost'); }),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      await expect(ctrl.performSearch('love', {})).rejects.toThrow('DB connection lost');

      // isSearching should be reset so future searches work
      expect(ctrl.getIsSearching()).toBe(false);
    });

    it('should allow a new search after a failed one', async () => {
      let callCount = 0;
      mockSearchService = createMockSearchService({
        search: vi.fn(async () => {
          callCount++;
          if (callCount === 1) throw new Error('transient error');
          return []; // second call succeeds
        }),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      await expect(ctrl.performSearch('love', {})).rejects.toThrow('transient error');

      // Second search should succeed
      const results = await ctrl.performSearch('love', {});
      expect(results).toEqual([]);
    });

    it('should reject concurrent searches', async () => {
      let resolveSearch: () => void;
      const searchPromise = new Promise<void>(resolve => { resolveSearch = resolve; });

      mockSearchService = createMockSearchService({
        search: vi.fn(async () => {
          await searchPromise;
          return [];
        }),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      // Start first search (won't resolve until we call resolveSearch)
      const first = ctrl.performSearch('love', {});

      // Attempt concurrent search should throw
      await expect(ctrl.performSearch('faith', {})).rejects.toThrow('Search already in progress');

      // Clean up: resolve the first search
      resolveSearch!();
      await first;
    });

    it('cancelSearch resets isSearching flag', async () => {
      let resolveSearch: () => void;
      const searchPromise = new Promise<void>(resolve => { resolveSearch = resolve; });

      mockSearchService = createMockSearchService({
        search: vi.fn(async () => {
          await searchPromise;
          return [];
        }),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      // Start a search
      const searchP = ctrl.performSearch('love', {});
      expect(ctrl.getIsSearching()).toBe(true);

      // Cancel it
      ctrl.cancelSearch();
      expect(ctrl.getIsSearching()).toBe(false);

      // Resolve the pending search to clean up
      resolveSearch!();
      await searchP.catch(() => {}); // may throw since state was cleared
    });

    it('should throw validation error for invalid queries and reset state', async () => {
      await expect(ctrl.performSearch('', {})).rejects.toThrow();
      expect(ctrl.getIsSearching()).toBe(false);
    });

    it('should update currentQuery even when search fails', async () => {
      mockSearchService = createMockSearchService({
        search: vi.fn(async () => { throw new Error('fail'); }),
      });
      ctrl = new SearchController(mockSearchService, mockSearchRepo);

      await ctrl.performSearch('my query', {}).catch(() => {});
      expect(ctrl.getCurrentQuery()).toBe('my query');
    });
  });
});
