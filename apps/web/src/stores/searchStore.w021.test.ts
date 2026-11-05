/** W-021 / W-022 / W-035: stale-response guards and validation message in searchStore. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchStore } from './searchStore';
import type { ISearchProvider } from '../providers/interfaces';

function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const row = (id: number, text: string) => ({ verseId: id, reference: `r${id}`, text, module: 'KJV', type: 'exact' }) as never;

describe('searchStore stale guards', () => {
  let provider: ISearchProvider;
  beforeEach(() => {
    provider = {
      keywordSearch: vi.fn(), semanticSearch: vi.fn(), strongsSearch: vi.fn(),
      warmupSemanticSearch: vi.fn(() => Promise.resolve()),
    } as never;
    searchStore.clear();
    searchStore.init(provider);
  });

  it('W-021: a slow keyword search does not overwrite a later Strong\'s search', async () => {
    const kw = deferred<never>();
    (provider.keywordSearch as any).mockReturnValue(kw.promise);
    (provider.strongsSearch as any).mockResolvedValue({
      entry: null, wordFamily: [], results: [row(2, 'strongs')], total: 1, groupedCounts: {},
    });
    const p1 = searchStore.performSearch('love', 'keyword', ['KJV']);
    await searchStore.performSearch('H430');
    kw.resolve({ results: [row(1, 'love')], total: 1 } as never);
    await p1;
    expect(searchStore.strongsMode).toBe(true);
    expect(searchStore.results.map((r) => r.text)).toEqual(['strongs']);
  });

  it('W-022: a late "load more" page does not replace a newer query\'s results', async () => {
    (provider.semanticSearch as any).mockResolvedValueOnce({ results: Array.from({ length: 20 }, (_, i) => row(i + 1, 'old')), total: 20 });
    (provider.keywordSearch as any).mockResolvedValue({ results: [], total: 0 });
    await searchStore.performSearch('grace', 'semantic', ['KJV']);
    expect(searchStore.canLoadMore).toBe(true);
    const more = deferred<never>();
    (provider.semanticSearch as any).mockReturnValueOnce(more.promise);
    const lm = searchStore.loadMoreSemantic();
    (provider.semanticSearch as any).mockResolvedValueOnce({ results: [row(99, 'new')], total: 1 });
    await searchStore.performSearch('mercy', 'semantic', ['KJV']);
    more.resolve({ results: Array.from({ length: 40 }, (_, i) => row(i + 1, 'old')), total: 40 } as never);
    await lm;
    expect(searchStore.results.map((r) => r.text)).toEqual(['new']);
    expect(searchStore.query).toBe('mercy');
  });

  it('W-035: a server validation message becomes searchError; plain failures do not', async () => {
    const err = Object.assign(new Error('Keyword search failed: 400'), { validationMessage: 'Unmatched quote in search query' });
    (provider.keywordSearch as any).mockRejectedValueOnce(err);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await searchStore.performSearch('"love', 'keyword', ['KJV']);
    expect(searchStore.searchError).toBe('Unmatched quote in search query');
    (provider.keywordSearch as any).mockRejectedValueOnce(new Error('network down'));
    await searchStore.performSearch('love', 'keyword', ['KJV']);
    expect(searchStore.searchError).toBe('');
  });
});
