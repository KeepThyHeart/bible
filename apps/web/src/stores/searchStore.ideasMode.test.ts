/**
 * Choosing Ideas mode must not fire a search on its own.
 *
 * `setSearchType('semantic')` used to re-run whatever query was already on
 * screen the instant the menu item was clicked. The reader picks the mode in
 * order to reword the term for it, so the search has to wait for an explicit
 * submit (Enter), which goes through `performSearch`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchStore } from './searchStore';
import type { ISearchProvider } from '../providers/interfaces';

const emptySet = { results: [], total: 0 };

function makeProvider(overrides: Partial<ISearchProvider> = {}): ISearchProvider {
  return {
    keywordSearch: vi.fn(() => Promise.resolve(emptySet)),
    semanticSearch: vi.fn(() => Promise.resolve(emptySet)),
    strongsSearch: vi.fn(() => Promise.resolve({
      entry: null, wordFamily: [], results: [], total: 0, groupedCounts: {},
    } as never)),
    warmupSemanticSearch: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

const verseHit = {
  verseId: 43003016, module: 'KJV', type: 'verse', text: 'For God so loved the world',
} as never;

describe('searchStore.setSearchType (Ideas mode)', () => {
  let provider: ISearchProvider;

  beforeEach(() => {
    provider = makeProvider({
      keywordSearch: vi.fn(() => Promise.resolve({ results: [verseHit], total: 1 })) as never,
    });
    searchStore.clear();
    searchStore.init(provider);
    searchStore.searchType = 'keyword';
  });

  it('does not run a search when Ideas is selected with a query on screen', async () => {
    await searchStore.performSearch('God so loved the world', 'keyword', ['KJV']);
    expect(searchStore.results).toHaveLength(1);
    (provider.keywordSearch as ReturnType<typeof vi.fn>).mockClear();

    searchStore.setSearchType('semantic');

    expect(searchStore.searchType).toBe('semantic');
    expect(provider.semanticSearch).not.toHaveBeenCalled();
    expect(provider.keywordSearch).not.toHaveBeenCalled();
    expect(searchStore.loading).toBe(false);
  });

  it('drops the other mode’s results but keeps the panel open', async () => {
    await searchStore.performSearch('God so loved the world', 'keyword', ['KJV']);
    searchStore.setSearchType('semantic');

    expect(searchStore.query).toBe('');
    expect(searchStore.results).toEqual([]);
    expect(searchStore.totalResults).toBe(0);
    expect(searchStore.isOpen).toBe(true);
  });

  it('searches on the next explicit submit, in Ideas mode', async () => {
    await searchStore.performSearch('God so loved the world', 'keyword', ['KJV']);
    searchStore.setSearchType('semantic');

    // What the header does on Enter: performSearch with no explicit type.
    await searchStore.performSearch('sacrificial love', undefined, ['KJV']);

    expect(provider.semanticSearch).toHaveBeenCalledTimes(1);
    expect((provider.semanticSearch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('sacrificial love');
  });

  it('does not let a keyword search still in flight land its results after the switch', async () => {
    let finish!: (v: { results: never[]; total: number }) => void;
    provider = makeProvider({
      keywordSearch: vi.fn(() => new Promise(res => { finish = res as never; })) as never,
    });
    searchStore.init(provider);

    const pending = searchStore.performSearch('love', 'keyword', ['KJV']);
    searchStore.setSearchType('semantic');
    finish({ results: [verseHit], total: 1 } as never);
    await pending;

    expect(searchStore.results).toEqual([]);
    expect(searchStore.loading).toBe(false);
  });

  it('still re-queries when switching back to keyword with a query on screen', async () => {
    await searchStore.performSearch('love', 'semantic', ['KJV']);
    (provider.keywordSearch as ReturnType<typeof vi.fn>).mockClear();

    searchStore.setSearchType('keyword');
    await Promise.resolve();

    expect(provider.keywordSearch).toHaveBeenCalled();
  });
});
