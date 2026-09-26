/**
 * `keywordIndexNotice`: the search-results side of F8's keyword-index UI
 * (task 0033 follow-up to 0027's F8). Purely informational - it never blocks,
 * slows or fails the search itself, which has already returned by the time
 * this is computed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SearchResult } from '@bible/core';

const performSearchMock = vi.fn();
vi.mock('../services/electronAPI', () => ({
  searchAPI: {
    performSearch: (...args: unknown[]) => performSearchMock(...args),
    semanticSearch: vi.fn(),
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

const getKeywordIndexStatusMock = vi.fn();
vi.mock('./module/moduleAPI', () => ({
  moduleAPI: {
    getKeywordIndexStatus: (...args: unknown[]) => getKeywordIndexStatusMock(...args),
  },
}));

import { useSearchStore } from './useSearchStore';
import { setResolveInstalledModuleId } from './crossStoreBridge';

/** Fake the installed-module library: KJV=1, ESV=2. NIV is not installed. */
const MODULE_IDS: Record<string, number> = { KJV: 1, ESV: 2 };

function resultFor(module: string, verseId = 1001001): SearchResult {
  return { verseId, module, type: 'exact', reference: 'Gen 1:1', text: 'In the beginning', matches: [], score: 1 } as SearchResult;
}

describe('useSearchStore - keywordIndexNotice', () => {
  beforeEach(() => {
    performSearchMock.mockReset();
    getKeywordIndexStatusMock.mockReset();
    setResolveInstalledModuleId((abbr) => MODULE_IDS[abbr]);
    useSearchStore.setState({
      query: '',
      resultsForQuery: '',
      searchResults: [],
      isSearching: false,
      error: null,
      keywordIndexNotice: null,
      retriedModules: [],
      isSemanticMode: false,
      semanticAvailable: false,
      autoSwitchedToSemantic: false,
    });
  });

  afterEach(() => {
    setResolveInstalledModuleId(null);
  });

  it('reports how many of the hit modules are not ready', async () => {
    performSearchMock.mockResolvedValue([resultFor('KJV'), resultFor('ESV', 1001002)]);
    getKeywordIndexStatusMock.mockImplementation((id: number) =>
      Promise.resolve(
        id === 1
          ? { moduleUuid: 'kjv', providerId: 'p', state: 'ready' }
          : { moduleUuid: 'esv', providerId: 'p', state: 'stale' }
      )
    );

    await useSearchStore.getState().performSearch('grace');
    await vi.waitFor(() => expect(useSearchStore.getState().keywordIndexNotice).not.toBeNull());

    expect(useSearchStore.getState().keywordIndexNotice).toEqual({ pending: 1, total: 2 });
  });

  it('is null once every hit module is ready', async () => {
    performSearchMock.mockResolvedValue([resultFor('KJV')]);
    getKeywordIndexStatusMock.mockResolvedValue({ moduleUuid: 'kjv', providerId: 'p', state: 'ready' });

    await useSearchStore.getState().performSearch('grace');
    await vi.waitFor(() => expect(getKeywordIndexStatusMock).toHaveBeenCalled());

    expect(useSearchStore.getState().keywordIndexNotice).toBeNull();
  });

  it('deduplicates a module that hit more than once', async () => {
    performSearchMock.mockResolvedValue([resultFor('ESV', 1), resultFor('ESV', 2), resultFor('ESV', 3)]);
    getKeywordIndexStatusMock.mockResolvedValue({ moduleUuid: 'esv', providerId: 'p', state: 'unbuilt' });

    await useSearchStore.getState().performSearch('grace');
    await vi.waitFor(() => expect(useSearchStore.getState().keywordIndexNotice).not.toBeNull());

    expect(getKeywordIndexStatusMock).toHaveBeenCalledTimes(1);
    expect(useSearchStore.getState().keywordIndexNotice).toEqual({ pending: 1, total: 1 });
  });

  it('excludes a module whose status lookup fails, rather than counting it as pending', async () => {
    performSearchMock.mockResolvedValue([resultFor('KJV'), resultFor('ESV', 2)]);
    getKeywordIndexStatusMock.mockImplementation((id: number) =>
      id === 1 ? Promise.reject(new Error('boom')) : Promise.resolve({ moduleUuid: 'esv', providerId: 'p', state: 'failed' })
    );

    await useSearchStore.getState().performSearch('grace');
    await vi.waitFor(() => expect(useSearchStore.getState().keywordIndexNotice).not.toBeNull());

    expect(useSearchStore.getState().keywordIndexNotice).toEqual({ pending: 1, total: 1 });
  });

  it('is null when no hit module resolves to an installed module id', async () => {
    performSearchMock.mockResolvedValue([resultFor('NIV')]);

    await useSearchStore.getState().performSearch('grace');

    expect(getKeywordIndexStatusMock).not.toHaveBeenCalled();
    expect(useSearchStore.getState().keywordIndexNotice).toBeNull();
  });

  it('does not fail or block the search itself when the status lookups fail', async () => {
    performSearchMock.mockResolvedValue([resultFor('KJV')]);
    getKeywordIndexStatusMock.mockRejectedValue(new Error('boom'));

    await useSearchStore.getState().performSearch('grace');

    const state = useSearchStore.getState();
    expect(state.error).toBeNull();
    expect(state.searchResults).toHaveLength(1);
  });

  it('is cleared when the results are cleared', async () => {
    useSearchStore.setState({ keywordIndexNotice: { pending: 1, total: 2 }, searchResults: [resultFor('KJV')] as never });
    useSearchStore.getState().clearResults();
    expect(useSearchStore.getState().keywordIndexNotice).toBeNull();
  });
});
