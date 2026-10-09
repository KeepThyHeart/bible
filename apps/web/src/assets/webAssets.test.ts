import { describe, it, expect, afterEach, vi } from 'vitest';
import type { IAssetManager } from '@bible/core/browser';

import { createWebStores, getAssetManager, getReadyAssetManager, refreshAssetCatalog, registerCatalogSource, setAssetManagerForTests } from './webAssets';
import { CacheAssetStore } from './CacheAssetStore';

afterEach(() => { setAssetManagerForTests(null); vi.unstubAllGlobals(); });

describe('webAssets', () => {
  it('uses Cache Storage stores when available and memory stores otherwise', () => {
    const storage = { open: async () => ({}) } as unknown as CacheStorage;
    expect(createWebStores(storage).store).toBeInstanceOf(CacheAssetStore);
    expect(createWebStores(undefined).store).not.toBeInstanceOf(CacheAssetStore);
  });

  it('returns one shared manager with an empty snapshot before anything is installed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const a = getAssetManager();
    expect(getAssetManager()).toBe(a);
    const ready = await getReadyAssetManager();
    expect(ready).toBe(a);
    expect(ready.getSnapshot().entries).toEqual([]);
  });

  it('refreshAssetCatalog parses index.json into the catalog; a 404 gives an empty catalog', async () => {
    const setCatalog = vi.fn();
    setAssetManagerForTests({ setCatalog } as unknown as IAssetManager);
    const index = {
      schema: 'kth-asset-index/1',
      assets: [{ id: 'table', kind: 'data', version: '1', title: 'Table', license: 'MIT', size: 4,
        files: [{ path: 't.bin', url: 't/t.bin', size: 4, sha256: 'b'.repeat(64) }] }],
    };
    const fetchFn = vi.fn(async (_u: string) => new Response(JSON.stringify(index), { status: 200 }));
    vi.stubGlobal('fetch', fetchFn);
    await refreshAssetCatalog();
    expect(fetchFn.mock.calls[0][0]).toMatch(/\/assets\/v1\/index\.json$/);
    expect((setCatalog.mock.calls as unknown as Array<Array<Array<{ id: string }>>>)[0][0].map((m: { id: string }) => m.id)).toEqual(['table']);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await refreshAssetCatalog();
    expect((setCatalog.mock.calls as unknown as unknown[][])[1][0]).toEqual([]);
  });

  it('never throws when the index fetch fails', async () => {
    const setCatalog = vi.fn();
    setAssetManagerForTests({ setCatalog } as unknown as IAssetManager);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
    await expect(refreshAssetCatalog()).resolves.toBeUndefined();
    expect(setCatalog).not.toHaveBeenCalled();
  });
  it('adds the manifests of registered catalog sources (a module activating late), and drops them on dispose', async () => {
    const setCatalog = vi.fn();
    setAssetManagerForTests({ setCatalog } as unknown as IAssetManager);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const extra = { id: 'voice', kind: 'tts-voice', version: '1', title: 'Voice', license: 'MIT', size: 1, files: [] };
    const source = vi.fn(async () => [extra]);
    const handle = registerCatalogSource(source as never);
    await vi.waitFor(() => expect(setCatalog).toHaveBeenCalled());
    const ids = (call: number) => (setCatalog.mock.calls as unknown as Array<Array<Array<{ id: string }>>>)[call][0].map((m) => m.id);
    expect(ids(setCatalog.mock.calls.length - 1)).toEqual(['voice']);
    setCatalog.mockClear();
    handle.dispose();
    await vi.waitFor(() => expect(setCatalog).toHaveBeenCalled());
    expect(ids(setCatalog.mock.calls.length - 1)).toEqual([]);
    // A failing source never breaks the catalog.
    const bad = registerCatalogSource(async () => { throw new Error('down'); });
    await vi.waitFor(() => expect(setCatalog.mock.calls.length).toBeGreaterThan(1));
    bad.dispose();
  });
});
