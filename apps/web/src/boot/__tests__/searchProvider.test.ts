import { describe, it, expect, beforeEach } from 'vitest';
import { getSearchProvider, resetSearchProviderForTests } from '../searchProvider';
import { RemoteSearchProvider } from '../../search/remote/RemoteSearchProvider';
import { BrowserSearchProvider } from '../../search/BrowserSearchProvider';

const search = { keywordSearch: async () => ({ results: [], total: 0 }) };
const providers = { search, bible: {} } as never;

describe('getSearchProvider', () => {
  beforeEach(() => resetSearchProviderForTests());

  it("'remote' mode picks the RemoteSearchProvider", async () => {
    const p = await getSearchProvider({
      baseUrl: '', providers, semanticMode: 'remote', remoteSearch: { via: 'server', noticeVersion: 1 },
    });
    expect(p).toBeInstanceOf(RemoteSearchProvider);
    // Memoised.
    expect(await getSearchProvider({ baseUrl: '', providers, semanticMode: 'remote' })).toBe(p);
  });

  it('server mode keeps the plain server provider', async () => {
    expect(await getSearchProvider({ baseUrl: '', providers, semanticMode: 'server' })).toBe(search);
  });

  it('remote mode without its settings does not build the remote provider', async () => {
    expect(await getSearchProvider({ baseUrl: '', providers, semanticMode: 'remote' })).toBe(search);
  });

  it('browser mode keeps the browser provider', async () => {
    const p = await getSearchProvider({ baseUrl: 'http://x', providers, semanticMode: 'browser' });
    expect(p).toBeInstanceOf(BrowserSearchProvider);
  });
});
