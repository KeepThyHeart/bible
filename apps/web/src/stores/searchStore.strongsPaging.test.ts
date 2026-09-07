/**
 * Paging for Strong's occurrence lists.
 *
 * A common Hebrew or Greek word runs to hundreds or thousands of verses, but the
 * server only ever hands back one capped page. These tests pin down that the
 * store knows more exist (`totalAvailable`), asks for successively larger pages,
 * and cannot have a slow page land on top of a newer search.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchStore } from './searchStore';
import type { ISearchProvider } from '../providers/interfaces';
import type { SearchResultData, StrongsSearchResult } from '../types';

/** Server shape: StrongsSearchResult plus the unclamped occurrence count. */
type StrongsResponse = StrongsSearchResult & { totalAvailable?: number };

interface StrongsOptions {
  includeRelated?: boolean;
  modules?: string[];
  maxResults?: number;
}

function makeResults(count: number): SearchResultData[] {
  return Array.from({ length: count }, (_, i) => ({
    verseId: 1001001 + i,
    reference: `Gen 1:${i + 1}`,
    text: 'text',
    module: 'KJV',
    type: 'exact',
  })) as SearchResultData[];
}

/** Responds with min(maxResults, available) results out of `available` total. */
function respond(maxResults: number, available: number): StrongsResponse {
  const results = makeResults(Math.min(maxResults, available));
  return {
    entry: null,
    wordFamily: [],
    results,
    total: results.length,
    totalAvailable: available,
    groupedCounts: {},
  };
}

const AVAILABLE = 640;

let capturedOptions: StrongsOptions[] = [];
const strongsSearch = vi.fn((_number: string, options?: StrongsOptions): Promise<StrongsSearchResult> => {
  capturedOptions.push(options ?? {});
  return Promise.resolve(respond(options?.maxResults ?? 100, AVAILABLE));
});

const provider: ISearchProvider = {
  keywordSearch: vi.fn(() => Promise.resolve({ results: [], total: 0 })),
  semanticSearch: vi.fn(() => Promise.resolve({ results: [], total: 0 })),
  strongsSearch,
  warmupSemanticSearch: vi.fn(() => Promise.resolve()),
};

describe('searchStore Strong\'s paging', () => {
  beforeEach(() => {
    searchStore.clear();
    searchStore.init(provider);
    capturedOptions = [];
    strongsSearch.mockClear();
  });

  it('requests the first page and reports that more remain', async () => {
    await searchStore.performSearch('G25');

    expect(capturedOptions[0].maxResults).toBe(100);
    expect(searchStore.results.length).toBe(100);
    expect(searchStore.strongsTotalAvailable).toBe(AVAILABLE);
    expect(searchStore.canLoadMore).toBe(true);
    expect(searchStore.strongsRemaining).toBe(AVAILABLE - 100);
  });

  it('advances by one page per loadMoreStrongs call', async () => {
    await searchStore.performSearch('G25');
    await searchStore.loadMoreStrongs();

    expect(capturedOptions[1].maxResults).toBe(200);
    expect(searchStore.results.length).toBe(200);
    expect(searchStore.canLoadMore).toBe(true);

    await searchStore.loadMoreStrongs();
    expect(capturedOptions[2].maxResults).toBe(300);
    expect(searchStore.results.length).toBe(300);
  });

  it('fetches everything remaining on loadAllStrongs and stops offering more', async () => {
    await searchStore.performSearch('G25');
    await searchStore.loadAllStrongs();

    expect(capturedOptions[1].maxResults).toBe(5000);
    expect(searchStore.results.length).toBe(AVAILABLE);
    expect(searchStore.canLoadMore).toBe(false);
    expect(searchStore.strongsRemaining).toBe(0);
  });

  it('re-uses the searched modules when paging', async () => {
    await searchStore.performSearch('G25', undefined, ['KJV']);
    await searchStore.loadMoreStrongs();

    expect(capturedOptions[1].modules).toEqual(['KJV']);
  });

  it('does not page when the first response already had everything', async () => {
    strongsSearch.mockImplementationOnce((_n, options) => {
      capturedOptions.push(options ?? {});
      return Promise.resolve(respond(options?.maxResults ?? 100, 12));
    });
    await searchStore.performSearch('G25');

    expect(searchStore.canLoadMore).toBe(false);

    await searchStore.loadMoreStrongs();
    expect(strongsSearch).toHaveBeenCalledTimes(1);
  });

  it('falls back to total when the provider omits totalAvailable', async () => {
    strongsSearch.mockImplementationOnce((_n, options) => {
      capturedOptions.push(options ?? {});
      const { totalAvailable: _drop, ...rest } = respond(options?.maxResults ?? 100, AVAILABLE);
      return Promise.resolve(rest);
    });
    await searchStore.performSearch('G25');

    expect(searchStore.strongsTotalAvailable).toBe(100);
    expect(searchStore.canLoadMore).toBe(false);
  });

  it('stops offering more when a page comes back no larger than the last', async () => {
    await searchStore.performSearch('G25');
    // A server that ignores maxResults hands back the same page forever.
    strongsSearch.mockImplementationOnce(() => Promise.resolve(respond(100, AVAILABLE)));
    await searchStore.loadMoreStrongs();

    expect(searchStore.results.length).toBe(100);
    expect(searchStore.canLoadMore).toBe(false);
  });

  it('discards a page that lands after a newer search started', async () => {
    await searchStore.performSearch('G25');

    let releaseStalePage: (r: StrongsSearchResult) => void = () => {};
    strongsSearch.mockImplementationOnce(() => new Promise<StrongsSearchResult>((resolve) => {
      releaseStalePage = resolve;
    }));
    const pending = searchStore.loadMoreStrongs();

    // The user searched for something else while page 2 was still in flight.
    await searchStore.performSearch('G26');
    expect(searchStore.query).toBe('G26');

    releaseStalePage(respond(200, AVAILABLE));
    await pending;

    expect(searchStore.query).toBe('G26');
    expect(searchStore.results.length).toBe(100);
    expect(searchStore.loadingMore).toBe(false);
  });
});
