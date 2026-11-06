import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchStore } from './searchStore';
import { SEMANTIC_LOAD_MORE_STEP, SEMANTIC_MAX_RESULTS } from './searchPaging';
import type { ISearchProvider } from '../providers/interfaces';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
  verseId: 1001001 + i, reference: `Gen 1:${i + 1}`, text: 't', module: 'KJV', type: 'semantic',
}));

const sizes: number[] = [];
const provider = {
  keywordSearch: vi.fn(() => Promise.resolve({ results: [], total: 0 })),
  semanticSearch: vi.fn((_q: string, o?: { pageSize?: number }) => {
    sizes.push(o?.pageSize ?? 0);
    const n = Math.min(o?.pageSize ?? 20, 80);
    return Promise.resolve({ results: rows(n), total: n });
  }),
  strongsSearch: vi.fn(),
  warmupSemanticSearch: vi.fn(() => Promise.resolve()),
} as unknown as ISearchProvider;

describe('searchStore semantic paging', () => {
  beforeEach(() => {
    searchStore.clear();
    searchStore.init(provider);
    sizes.length = 0;
  });

  it('grows by the bounded step, clamped to the server cap, then stops offering more', async () => {
    await searchStore.performSearch('grace', 'semantic', ['KJV']);
    expect(sizes[0]).toBe(20);
    expect(searchStore.canLoadMore).toBe(true);

    await searchStore.loadMoreSemantic();
    expect(sizes[1]).toBe(Math.min(20 + SEMANTIC_LOAD_MORE_STEP, SEMANTIC_MAX_RESULTS));
    expect(sizes[1]).toBe(50);
    expect(searchStore.results.length).toBe(50);
    expect(searchStore.canLoadMore).toBe(false);
  });
});
