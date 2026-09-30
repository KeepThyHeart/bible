import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { sha256Hex } from '@bible/core/browser';
import { createFakeOpfs, type FakeDir } from '../testing/fakeOpfs';
import { offlineStore } from '../stores/offlineStore';
import {
  findModuleManifest,
  getModuleAssetManager,
  getModuleCatalog,
  installModuleAsset,
  pinModuleAsset,
  moduleAssetId,
  refreshModuleCatalog,
  removeModuleAsset,
  resetModuleAssetsForTests,
  setModuleDbCloser,
} from './moduleAssets';

function dbBytes(seed = 1): Uint8Array {
  const out = new Uint8Array(16 + 3000);
  out.set(new TextEncoder().encode('SQLite format 3\0'));
  for (let i = 16; i < out.length; i++) out[i] = (i * seed) % 253;
  return out;
}

interface Served { gz: Uint8Array; version: string; dbAbbr?: string }

function makeServer(mods: Record<string, Served & { rawSha?: string }>, opts: { index?: () => Response } = {}) {
  const calls: Array<{ url: string; range?: string }> = [];
  const index = () => ({
    schema: 'kth-asset-index/1',
    assets: Object.entries(mods).map(([abbr, m]) => ({
      id: moduleAssetId(m.dbAbbr ?? abbr),
      kind: 'module',
      version: m.version,
      title: abbr,
      license: 'Public Domain',
      size: m.gz.length,
      files: [{ path: `${abbr}.db.gz`, url: `files/${moduleAssetId(m.dbAbbr ?? abbr)}/${m.version}/${abbr}.db.gz`, size: m.gz.length, sha256: m.rawSha ?? sha256Hex(m.gz) }],
      meta: { moduleType: 'bible', abbreviation: abbr, name: `${abbr} Bible`, languageCode: 'en', storedSize: 3016, encoding: 'gzip' },
    })),
  });
  const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input).replace(/\?.*$/, '');
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    calls.push({ url, range });
    if (url.endsWith('/api/offline/manifest')) return opts.index ? opts.index() : new Response(JSON.stringify(index()), { status: 200 });
    const hit = Object.entries(mods).find(([abbr, m]) => url.endsWith(`/${m.version}/${abbr}.db.gz`));
    if (!hit) return new Response('', { status: 404 });
    const gz = hit[1].gz;
    const m = range ? /bytes=(\d+)-/.exec(range) : null;
    if (m) {
      const start = Number(m[1]);
      return new Response(gz.slice(start) as unknown as BodyInit, { status: 206, headers: { 'content-range': `bytes ${start}-${gz.length - 1}/${gz.length}`, etag: '"e"' } });
    }
    return new Response(gz as unknown as BodyInit, { status: 200, headers: { 'content-length': String(gz.length), etag: '"e"' } });
  });
  return { fetchFn, calls };
}

let root: FakeDir;
const origStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');

beforeEach(() => {
  root = createFakeOpfs();
  Object.defineProperty(navigator, 'storage', { value: { getDirectory: async () => root }, configurable: true });
  resetModuleAssetsForTests();
  offlineStore.downloadedModules = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (origStorage) Object.defineProperty(navigator, 'storage', origStorage);
  else delete (navigator as unknown as { storage?: unknown }).storage;
});

describe('moduleAssetId', () => {
  it('lowercases and replaces unsafe characters like the server', () => {
    expect(moduleAssetId('KJV')).toBe('module.kjv');
    expect(moduleAssetId('My Mod/2')).toBe('module.my_mod_2');
  });
});

describe('refreshModuleCatalog', () => {
  it('parses the manifest, resolving urls against the index url', async () => {
    const gz = new Uint8Array(gzipSync(dbBytes()));
    const { fetchFn } = makeServer({ KJV: { gz, version: 's1' } });
    vi.stubGlobal('fetch', fetchFn);
    expect(await refreshModuleCatalog()).toBe(true);
    const cat = getModuleCatalog();
    expect(cat.map((a) => a.id)).toEqual(['module.kjv']);
    expect(cat[0].files[0].url).toMatch(/^https?:\/\/.*\/api\/offline\/files\/module\.kjv\/s1\/KJV\.db\.gz$/);
  });

  it('returns false on 404, an invalid index and network failure, never throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await refreshModuleCatalog()).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"schema":"nope"}', { status: 200 })));
    expect(await refreshModuleCatalog()).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    expect(await refreshModuleCatalog()).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
    expect(await refreshModuleCatalog()).toBe(false);
  });
});

describe('installModuleAsset / removeModuleAsset', () => {
  it('downloads, verifies, gunzips to modules/<abbr>.db and records the module', async () => {
    const db = dbBytes();
    const gz = new Uint8Array(gzipSync(db));
    const { fetchFn } = makeServer({ KJV: { gz, version: 's1' } });
    vi.stubGlobal('fetch', fetchFn);
    await refreshModuleCatalog();
    const progress: Array<[number, number]> = [];
    await installModuleAsset('KJV', { pinned: true, onProgress: (l, t) => progress.push([l, t]) });
    expect(root.peek('modules/KJV.db')).toEqual(db);
    expect(progress.at(-1)).toEqual([gz.length, gz.length]);
    const entry = offlineStore.downloadedModules.find((m) => m.abbreviation === 'KJV')!;
    expect(entry).toMatchObject({ name: 'KJV Bible', type: 'bible', sizeBytes: 3016, autoDownloaded: false });
    expect(getModuleAssetManager().installed('module.kjv')?.pinned).toBe(true);
    expect(root.peek('modules/.registry.json')).toBeDefined();
  });

  it('installs, reports and removes a module whose client abbreviation differs from its asset id (shortName)', async () => {
    const db = dbBytes();
    const gz = new Uint8Array(gzipSync(db));
    const { fetchFn } = makeServer({ Short: { gz, version: 's1', dbAbbr: 'LongDbName' } });
    vi.stubGlobal('fetch', fetchFn);
    await refreshModuleCatalog();
    expect(findModuleManifest('short')?.id).toBe('module.longdbname');
    await installModuleAsset('Short', { pinned: true });
    expect(root.peek('modules/Short.db')).toEqual(db);
    expect(getModuleAssetManager().installed('module.longdbname')?.pinned).toBe(true);
    await removeModuleAsset('Short');
    expect(getModuleAssetManager().installed('module.longdbname')).toBeUndefined();
    expect(root.peek('modules/Short.db')).toBeUndefined();
    expect(offlineStore.isModuleDownloaded('Short')).toBe(false);
  });

  it('pinModuleAsset pins an auto-installed module without downloading again, and unflags a legacy entry', async () => {
    const gz = new Uint8Array(gzipSync(dbBytes()));
    const { fetchFn, calls } = makeServer({ KJV: { gz, version: 's1' } });
    vi.stubGlobal('fetch', fetchFn);
    await refreshModuleCatalog();
    await installModuleAsset('KJV');
    expect(getModuleAssetManager().installed('module.kjv')?.pinned).toBe(false);
    expect(offlineStore.downloadedModules[0].autoDownloaded).toBe(true);
    const before = calls.length;
    await pinModuleAsset('kjv');
    expect(calls.length).toBe(before);
    expect(getModuleAssetManager().installed('module.kjv')?.pinned).toBe(true);
    expect(offlineStore.downloadedModules.find((m) => m.abbreviation === 'KJV')?.autoDownloaded).toBe(false);

    offlineStore.addDownloadedModule({ abbreviation: 'OLD', name: 'Old', type: 'bible', sizeBytes: 1, downloadedAt: '', autoDownloaded: true });
    await pinModuleAsset('OLD');
    expect(offlineStore.downloadedModules.find((m) => m.abbreviation === 'OLD')?.autoDownloaded).toBe(false);
    expect(calls.length).toBe(before);
  });

  it('rejects a hash mismatch and leaves no database', async () => {
    const gz = new Uint8Array(gzipSync(dbBytes()));
    const { fetchFn } = makeServer({ KJV: { gz, version: 's1', rawSha: 'a'.repeat(64) } });
    vi.stubGlobal('fetch', fetchFn);
    await refreshModuleCatalog();
    await expect(installModuleAsset('KJV')).rejects.toMatchObject({ code: 'integrity' });
    expect(root.peek('modules/KJV.db')).toBeUndefined();
    expect(offlineStore.isModuleDownloaded('KJV')).toBe(false);
  });

  it('rejects a module missing from the catalog', async () => {
    vi.stubGlobal('fetch', makeServer({}).fetchFn);
    await refreshModuleCatalog();
    await expect(installModuleAsset('KJV')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('closes the worker DB before an update, and on removal', async () => {
    const closer = vi.fn();
    setModuleDbCloser(closer);
    const v1 = new Uint8Array(gzipSync(dbBytes(1)));
    const v2 = new Uint8Array(gzipSync(dbBytes(2)));
    const mods: Record<string, Served> = { KJV: { gz: v1, version: 's1' } };
    vi.stubGlobal('fetch', makeServer(mods).fetchFn);
    await refreshModuleCatalog();
    await installModuleAsset('KJV', { pinned: true });
    closer.mockClear();

    mods.KJV = { gz: v2, version: 's2' };
    await refreshModuleCatalog();
    await installModuleAsset('KJV', { pinned: true });
    expect(closer).toHaveBeenCalledWith('KJV');
    expect(root.peek('modules/KJV.db')).toEqual(dbBytes(2));

    closer.mockClear();
    await removeModuleAsset('KJV');
    expect(closer).toHaveBeenCalledWith('KJV');
    expect(root.peek('modules/KJV.db')).toBeUndefined();
    expect(offlineStore.isModuleDownloaded('KJV')).toBe(false);
    expect(getModuleAssetManager().installed('module.kjv')).toBeUndefined();
  });
});
