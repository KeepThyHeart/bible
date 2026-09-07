/**
 * `searchSeq` is what the app shells key "reveal the results panel" off.
 *
 * `isOpen` alone is not enough: it stays true once results exist, so a user who
 * clicked a Strong's number (which swaps the right pane to Dictionary) and then
 * typed a fresh query would get no false→true edge, and pressing Enter would
 * look like it did nothing. These tests pin the counter down.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchStore } from './searchStore';
import type { ISearchProvider } from '../providers/interfaces';

const emptySet = { results: [], total: 0 };

const provider: ISearchProvider = {
  keywordSearch: vi.fn(() => Promise.resolve(emptySet)),
  semanticSearch: vi.fn(() => Promise.resolve(emptySet)),
  strongsSearch: vi.fn(() => Promise.resolve({
    entry: null,
    wordFamily: [],
    results: [],
    total: 0,
    groupedCounts: {},
  } as never)),
  warmupSemanticSearch: vi.fn(() => Promise.resolve()),
};

describe('searchStore.searchSeq', () => {
  beforeEach(() => {
    searchStore.clear();
    searchStore.init(provider);
    searchStore.searchSeq = 0;
  });

  it('bumps on a search', async () => {
    await searchStore.performSearch('love', 'keyword', ['KJV']);
    expect(searchStore.searchSeq).toBe(1);
  });

  it('bumps again while the results are already open', async () => {
    await searchStore.performSearch('love', 'keyword', ['KJV']);
    expect(searchStore.isOpen).toBe(true);

    // The user wandered off to the Dictionary tab without closing the results,
    // so `isOpen` never went back to false — the counter is the only signal.
    await searchStore.performSearch('mercy', 'keyword', ['KJV']);
    expect(searchStore.isOpen).toBe(true);
    expect(searchStore.searchSeq).toBe(2);
  });

  it('bumps for a Strong’s number search', async () => {
    await searchStore.performSearch('G25');
    expect(searchStore.searchSeq).toBe(1);
    expect(searchStore.strongsMode).toBe(true);
  });

  it('does not bump for an empty query', async () => {
    await searchStore.performSearch('   ');
    expect(searchStore.searchSeq).toBe(0);
  });
});
