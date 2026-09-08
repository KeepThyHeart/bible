import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResult } from '@bible/core';

// `retrySearchInModule` and `performSearch` both go through `searchAPI.performSearch`
// (IPC to the main process in the real app). Mock the whole electronAPI service
// module so these tests exercise only the store's own logic.
const performSearchMock = vi.fn();
const semanticSearchMock = vi.fn();

vi.mock('../../services/electronAPI', () => ({
  searchAPI: {
    performSearch: (...args: unknown[]) => performSearchMock(...args),
    semanticSearch: (...args: unknown[]) => semanticSearchMock(...args),
    semanticAvailable: vi.fn().mockResolvedValue(false),
    getSavedSearches: vi.fn(),
    saveSearch: vi.fn(),
    loadSavedSearch: vi.fn(),
    deleteSavedSearch: vi.fn(),
    buildIndex: vi.fn(),
  },
  dictionaryAPI: {
    getAvailableDictionaries: vi.fn().mockResolvedValue([]),
    getEntryByKey: vi.fn(),
  },
}));

import { useSearchStore, searchResultId, semanticResultId, type SemanticResult } from '../useSearchStore';

describe('useSearchStore - result interaction', () => {
  beforeEach(() => {
    performSearchMock.mockReset();
    semanticSearchMock.mockReset();
    useSearchStore.setState({
      query: '',
      resultsForQuery: '',
      searchResults: [],
      isSearching: false,
      error: null,
      retriedModules: [],
      lastClickedId: null,
      isSemanticMode: false,
      semanticResults: [],
      semanticAvailable: false,
      autoSwitchedToSemantic: false,
    });
  });

  describe('searchResultId', () => {
    it('builds a stable id from module/type/verseId', () => {
      const result = { verseId: 43003016, module: 'KJV', type: 'exact' } as SearchResult;
      expect(searchResultId(result)).toBe('keyword|KJV|exact|43003016|43003016');
    });

    it('uses the last verseIds entry as the range end for multi-verse results', () => {
      const result = {
        verseId: 43003016,
        verseIds: [43003016, 43003017, 43003018],
        module: 'KJV',
        type: 'exact',
      } as SearchResult;
      expect(searchResultId(result)).toBe('keyword|KJV|exact|43003016|43003018');
    });

    it('gives distinct ids to different modules of the same verse', () => {
      const kjv = { verseId: 43003016, module: 'KJV', type: 'exact' } as SearchResult;
      const esv = { verseId: 43003016, module: 'ESV', type: 'exact' } as SearchResult;
      expect(searchResultId(kjv)).not.toBe(searchResultId(esv));
    });
  });

  describe('semanticResultId', () => {
    it('namespaces by id so it can never collide with a keyword id', () => {
      const result = { id: '43003016' } as SemanticResult;
      expect(semanticResultId(result)).toBe('semantic|43003016');
    });
  });

  describe('retrySearchInModule', () => {
    it('searches the given module via the allOpenModules/openModules path and records it as retried', async () => {
      performSearchMock.mockResolvedValue([
        { verseId: 1001001, module: 'ESV', type: 'exact', reference: 'Gen 1:1', text: 'In the beginning', matches: [], score: 1 },
      ]);
      useSearchStore.setState({ resultsForQuery: 'agape', query: 'agape' });

      await useSearchStore.getState().retrySearchInModule('ESV');

      // `openModules` (not `modules`) is what the main-process handler reads
      // to register a not-yet-searched module before querying it.
      expect(performSearchMock).toHaveBeenCalledWith(
        'agape',
        expect.objectContaining({ scope: 'allOpenModules', openModules: ['ESV'] })
      );

      const state = useSearchStore.getState();
      expect(state.searchResults).toHaveLength(1);
      expect(state.resultsForQuery).toBe('agape');
      expect(state.isSearching).toBe(false);
      expect(state.error).toBeNull();
      expect(state.retriedModules).toEqual(['ESV']);
    });

    it('does not add the same module to retriedModules twice', async () => {
      performSearchMock.mockResolvedValue([]);
      useSearchStore.setState({ resultsForQuery: 'agape', retriedModules: ['ESV'] });

      await useSearchStore.getState().retrySearchInModule('ESV');

      expect(useSearchStore.getState().retriedModules).toEqual(['ESV']);
    });

    it('accumulates distinct retried modules across repeated zero-result retries', async () => {
      performSearchMock.mockResolvedValue([]);
      useSearchStore.setState({ resultsForQuery: 'agape' });

      await useSearchStore.getState().retrySearchInModule('ESV');
      await useSearchStore.getState().retrySearchInModule('NIV');

      expect(useSearchStore.getState().retriedModules).toEqual(['ESV', 'NIV']);
    });

    it('sets an error and stops loading when the retry search fails', async () => {
      performSearchMock.mockRejectedValue(new Error('boom'));
      useSearchStore.setState({ resultsForQuery: 'agape' });

      await useSearchStore.getState().retrySearchInModule('ESV');

      const state = useSearchStore.getState();
      expect(state.error).toBe('boom');
      expect(state.isSearching).toBe(false);
    });

    it('is a no-op when there is no query to retry', async () => {
      useSearchStore.setState({ resultsForQuery: '', query: '' });

      await useSearchStore.getState().retrySearchInModule('ESV');

      expect(performSearchMock).not.toHaveBeenCalled();
    });
  });

  describe('setLastClickedId', () => {
    it('sets the id directly', () => {
      useSearchStore.getState().setLastClickedId('keyword|KJV|exact|43003016|43003016');
      expect(useSearchStore.getState().lastClickedId).toBe('keyword|KJV|exact|43003016|43003016');
    });

    it('clears with null', () => {
      useSearchStore.setState({ lastClickedId: 'keyword|KJV|exact|1|1' });
      useSearchStore.getState().setLastClickedId(null);
      expect(useSearchStore.getState().lastClickedId).toBeNull();
    });
  });

  describe('performSearch resets retry/last-clicked bookkeeping', () => {
    it('clears retriedModules and lastClickedId when a new top-level search starts', async () => {
      performSearchMock.mockResolvedValue([]);
      useSearchStore.setState({
        retriedModules: ['ESV', 'NIV'],
        lastClickedId: 'keyword|KJV|exact|1001001|1001001',
      });

      await useSearchStore.getState().performSearch('grace');

      const state = useSearchStore.getState();
      expect(state.retriedModules).toEqual([]);
      expect(state.lastClickedId).toBeNull();
    });
  });
});
