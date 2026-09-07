/**
 * "Is this all of them?" for the search results list.
 *
 * The distribution chart has to be able to say plainly when what it is drawing
 * is not the whole search. Each mode signals that differently, and none of them
 * can be read off the response's `total` — which is simply `results.length`,
 * the page rather than the match set. Keyword search is the mode that knows
 * better: the server sends `totalAvailable` and `bookCounts` over everything it
 * matched, so the chart is complete while the list is still one page long.
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
/** What the server reports about the whole match set, when it reports anything. */
let keywordWholeSet: Pick<SearchResultSet, 'totalAvailable' | 'bookCounts'> = {};

const keywordSearch = vi.fn((_q: string, _mods: string[], options?: SearchOptions): Promise<SearchResultSet> => {
  capturedKeywordOptions = options;
  const results = makeResults(keywordCount);
  return Promise.resolve({ results, total: results.length, ...keywordWholeSet });
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
    keywordWholeSet = {};
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

  it('trusts the server\'s count over the size of the page it was sent', async () => {
    // A full page used to mean "possibly more". It still is more — but the
    // counts cover all of it, so the chart is not the thing that is short.
    keywordCount = 50;
    keywordWholeSet = { totalAvailable: 442, bookCounts: { 1: 12, 19: 120 } };
    await searchStore.performSearch('love', 'keyword', ['KJV']);

    expect(searchStore.resultsTruncated).toBe(false);
    expect(searchStore.bookCounts).toEqual({ 1: 12, 19: 120 });
    // The header counts the search, not the page.
    expect(searchStore.totalResults).toBe(442);
    expect(searchStore.keywordRemaining).toBe(392);
  });

  it('reports a search that ran into the server ceiling as counted short', async () => {
    keywordCount = 50;
    keywordWholeSet = { totalAvailable: 5000, bookCounts: { 1: 5000 } };
    await searchStore.performSearch('the', 'keyword', ['KJV']);
    expect(searchStore.resultsTruncated).toBe(true);
  });

  it('loads every remaining match in one go', async () => {
    keywordCount = 50;
    keywordWholeSet = { totalAvailable: 442, bookCounts: { 1: 442 } };
    await searchStore.performSearch('love', 'keyword', ['KJV']);

    keywordCount = 442;
    await searchStore.loadAllKeyword();

    // Asked for the server's ceiling: the endpoint has no offset, so a bigger
    // page is the only way to reach the end of the list.
    expect(capturedKeywordOptions?.pageSize).toBe(5000);
    expect(searchStore.results.length).toBe(442);
    expect(searchStore.keywordRemaining).toBe(0);
    expect(searchStore.loadingMore).toBe(false);
  });

  it('has nothing to load when the first page was the whole search', async () => {
    keywordCount = 12;
    keywordWholeSet = { totalAvailable: 12, bookCounts: { 1: 12 } };
    await searchStore.performSearch('mahershalalhashbaz', 'keyword', ['KJV']);
    expect(searchStore.keywordRemaining).toBe(0);

    keywordSearch.mockClear();
    await searchStore.loadAllKeyword();
    expect(keywordSearch).not.toHaveBeenCalled();
  });

  it('leaves the keyword list alone in the other search modes', async () => {
    semanticCount = 20;
    await searchStore.performSearch('love', 'semantic', ['KJV']);
    expect(searchStore.keywordRemaining).toBe(0);

    keywordSearch.mockClear();
    await searchStore.loadAllKeyword();
    expect(keywordSearch).not.toHaveBeenCalled();
  });

  it('counts the whole keyword match set in the banner beside semantic results', async () => {
    // The banner is an offer to switch modes; capping it at a page size
    // understated the alternative by orders of magnitude.
    semanticCount = 20;
    keywordCount = 50;
    keywordWholeSet = { totalAvailable: 442, bookCounts: { 1: 442 } };
    await searchStore.performSearch('love', 'semantic', ['KJV']);
    expect(searchStore.keywordMatchCount).toBe(442);
  });

  it('forgets the counts when the search is reset', async () => {
    keywordCount = 50;
    keywordWholeSet = { totalAvailable: 442, bookCounts: { 1: 442 } };
    await searchStore.performSearch('love', 'keyword', ['KJV']);
    searchStore.clear();
    expect(searchStore.bookCounts).toEqual({});
    expect(searchStore.keywordRemaining).toBe(0);
  });

  it('reports a short keyword page as complete', async () => {
    keywordCount = 12;
    await searchStore.performSearch('love', 'keyword', ['KJV']);
    expect(searchStore.results.length).toBe(12);
    expect(searchStore.resultsTruncated).toBe(false);
  });

  it('reports a full keyword page as possibly cut short without server counts', async () => {
    // The fallback for a server too old to send `totalAvailable`: a page that
    // came back exactly full cannot be distinguished from one the cap truncated,
    // so the chart's caption has to hedge.
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
