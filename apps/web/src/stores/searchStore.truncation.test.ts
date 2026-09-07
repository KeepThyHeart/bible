/**
 * "Is this all of them?" for the search results list.
 *
 * The distribution chart counts the rows the panel is holding, not the Bible, so
 * it has to be able to say plainly when a fetch limit cut the list short. Each
 * search mode signals that differently, and none of them can be read off the
 * response's `total` — which for keyword search is simply `results.length`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchStore } from './searchStore';
import type { ISearchProvider } from '../providers/interfaces';
import type { SearchOptions, SearchResultData, SearchResultSet } from '../types';

function makeResults(count: number): SearchResultData[] {
  return Array.from({ length: count }, (_, i) => ({
    verseId: 1001001 + i,
    reference: `Gen 1:${i + 1}`,
    text: 'text',
    module: 'KJV',
    type: 'exact' as const,
  }));
}

let keywordCount = 0;
let capturedKeywordOptions: SearchOptions | undefined;
let semanticCount = 0;

const keywordSearch = vi.fn((_q: string, _mods: string[], options?: SearchOptions): Promise<SearchResultSet> => {
  capturedKeywordOptions = options;
  const results = makeResults(keywordCount);
  return Promise.resolve({ results, total: results.length });
});

const semanticSearch = vi.fn((_q: string, _options?: SearchOptions): Promise<SearchResultSet> => {
  const results = makeResults(semanticCount);
  return Promise.resolve({ results, total: results.length });
});

const provider: ISearchProvider = {
  keywordSearch,
  semanticSearch,
  strongsSearch: vi.fn(),
  warmupSemanticSearch: vi.fn(() => Promise.resolve()),
} as unknown as ISearchProvider;

describe('searchStore.resultsTruncated', () => {
  beforeEach(() => {
    searchStore.clear();
    searchStore.init(provider);
    capturedKeywordOptions = undefined;
    keywordSearch.mockClear();
    semanticSearch.mockClear();
  });

  it('asks the keyword endpoint for an explicit page size', async () => {
    // Without this the limit is the server's own default and the client has
    // nothing to compare a full page against.
    keywordCount = 3;
    await searchStore.performSearch('love', 'keyword', ['KJV']);
    expect(capturedKeywordOptions?.pageSize).toBe(50);
  });

  it('reports a short keyword page as complete', async () => {
    keywordCount = 12;
    await searchStore.performSearch('love', 'keyword', ['KJV']);
    expect(searchStore.results.length).toBe(12);
    expect(searchStore.resultsTruncated).toBe(false);
  });

  it('reports a full keyword page as possibly cut short', async () => {
    // A page that came back exactly full cannot be distinguished from one the
    // cap truncated, so the chart's caption has to hedge.
    keywordCount = 50;
    await searchStore.performSearch('love', 'keyword', ['KJV']);
    expect(searchStore.resultsTruncated).toBe(true);
  });

  it('follows the load-more signal in semantic mode', async () => {
    semanticCount = 20; // a full first page
    await searchStore.performSearch('love', 'semantic', ['KJV']);
    expect(searchStore.canLoadMore).toBe(true);
    expect(searchStore.resultsTruncated).toBe(true);

    semanticCount = 7;
    await searchStore.performSearch('love', 'semantic', ['KJV']);
    expect(searchStore.resultsTruncated).toBe(false);
  });

  it('clears the keyword flag when the search is reset', async () => {
    keywordCount = 50;
    await searchStore.performSearch('love', 'keyword', ['KJV']);
    expect(searchStore.resultsTruncated).toBe(true);
    searchStore.clear();
    expect(searchStore.resultsTruncated).toBe(false);
  });
});
