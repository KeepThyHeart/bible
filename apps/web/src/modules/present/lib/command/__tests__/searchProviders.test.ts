import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchVerses, setVerseSearchProviderFactory } from '../searchProviders';

afterEach(() => {
  setVerseSearchProviderFactory(null);
  vi.unstubAllGlobals();
});

describe('setVerseSearchProviderFactory', () => {
  it('awaits the factory lazily and uses its provider', async () => {
    const keywordSearch = vi.fn(async () => ({ results: [{ verseId: 43003016, module: 'KJV', reference: 'John 3:16', text: 'x' }] }));
    const factory = vi.fn(async () => ({ keywordSearch }));
    setVerseSearchProviderFactory(factory);
    expect(factory).not.toHaveBeenCalled();
    const hits = await searchVerses('love', 'KJV');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(keywordSearch).toHaveBeenCalledWith('love', ['KJV'], { pageSize: 20 });
    expect(hits[0].verseId).toBe(43003016);
  });

  it('falls back to the keyword endpoint without a factory', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ results: [] }) }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchVerses('love')).toEqual([]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/search/keyword?');
  });
});
