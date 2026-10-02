import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetError } from '@bible/core/browser';
import type { AssetManifest } from '@bible/core/browser';

const mocks = vi.hoisted(() => ({
  catalog: [] as unknown[],
  refreshModuleCatalog: vi.fn(),
  installModuleAsset: vi.fn(),
  removeModuleAsset: vi.fn(),
}));

vi.mock('../offline/moduleAssets', () => ({
  findModuleManifest: (a: string) =>
    (mocks.catalog as AssetManifest[]).find((m) => {
      const ab = m.meta?.abbreviation;
      return (typeof ab === 'string' && ab.toLowerCase() === a.toLowerCase()) || m.id === `module.${a.toLowerCase()}`;
    }),
  refreshModuleCatalog: mocks.refreshModuleCatalog,
  installModuleAsset: mocks.installModuleAsset,
  removeModuleAsset: mocks.removeModuleAsset,
}));

import { OfflineStorageManager } from './OfflineStorageManager';
import { offlineStore } from '../stores/offlineStore';
import { createFakeOpfs, type FakeDir } from '../testing/fakeOpfs';

let root: FakeDir;
const origStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
const mgr = new OfflineStorageManager('http://api.test');

function legacyFetch() {
  const fn = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-length': '4' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  root = createFakeOpfs();
  Object.defineProperty(navigator, 'storage', {
    value: { getDirectory: async () => root, estimate: async () => ({ usage: 1, quota: 100 }), persist: async () => true },
    configurable: true,
  });
  mocks.catalog = [];
  mocks.refreshModuleCatalog.mockReset().mockResolvedValue(false);
  mocks.installModuleAsset.mockReset().mockResolvedValue(undefined);
  mocks.removeModuleAsset.mockReset().mockResolvedValue(undefined);
  offlineStore.downloadedModules = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (origStorage) Object.defineProperty(navigator, 'storage', origStorage);
});

describe('OfflineStorageManager module downloads', () => {
  it('downloadModule installs pinned through the asset store when the catalog has the module', async () => {
    mocks.catalog = [{ id: 'module.kjv' }];
    const fetchFn = legacyFetch();
    await mgr.downloadModule('KJV', 'King James');
    expect(mocks.installModuleAsset).toHaveBeenCalledWith('KJV', expect.objectContaining({ pinned: true }));
    expect(mocks.refreshModuleCatalog).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('resolves a module whose client abbreviation differs from the database id (shortName)', async () => {
    mocks.catalog = [{ id: 'module.dbabbr', meta: { abbreviation: 'Short' } }];
    const fetchFn = legacyFetch();
    await mgr.downloadModule('short', 'Short Bible');
    expect(mocks.installModuleAsset).toHaveBeenCalledWith('short', expect.objectContaining({ pinned: true }));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('downloadModuleLite installs unpinned and refreshes an empty catalog first', async () => {
    mocks.refreshModuleCatalog.mockImplementation(async () => { mocks.catalog = [{ id: 'module.kjv' }]; return true; });
    const fetchFn = legacyFetch();
    await mgr.downloadModuleLite('KJV', 'King James');
    expect(mocks.refreshModuleCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.installModuleAsset).toHaveBeenCalledWith('KJV', expect.objectContaining({ pinned: false }));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls back to the legacy download when the manifest is unavailable or lacks the module', async () => {
    const fetchFn = legacyFetch();
    await mgr.downloadModule('KJV', 'King James');
    expect(fetchFn).toHaveBeenCalledWith('http://api.test/api/modules/KJV/download');
    expect(root.peek('modules/KJV.db')).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(offlineStore.downloadedModules[0]).toMatchObject({ abbreviation: 'KJV', type: 'bible', autoDownloaded: false });

    mocks.catalog = [{ id: 'module.other' }];
    await mgr.downloadModuleLite('ESV', 'ESV');
    expect(fetchFn).toHaveBeenCalledWith('http://api.test/api/modules/ESV/download-lite');
    expect(mocks.installModuleAsset).not.toHaveBeenCalled();
  });

  it('falls back to legacy after a storage failure, but surfaces integrity failures', async () => {
    mocks.catalog = [{ id: 'module.kjv' }];
    const fetchFn = legacyFetch();
    mocks.installModuleAsset.mockRejectedValueOnce(new AssetError('storage', 'no DecompressionStream'));
    await mgr.downloadModule('KJV', 'King James');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    mocks.installModuleAsset.mockRejectedValueOnce(new AssetError('integrity', 'bad hash'));
    await expect(mgr.downloadModule('KJV', 'King James')).rejects.toMatchObject({ code: 'integrity' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    mocks.installModuleAsset.mockRejectedValueOnce(new AssetError('offline', 'offline'));
    await expect(mgr.downloadModuleLite('KJV', 'x')).rejects.toMatchObject({ code: 'offline' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('removeModule removes the asset and a legacy file, tolerating either being absent', async () => {
    const w = await (await (await root.getDirectoryHandle('modules', { create: true })).getFileHandle('KJV.db', { create: true })).createWritable();
    await w.write(new Uint8Array([9]));
    await w.close();
    offlineStore.addDownloadedModule({ abbreviation: 'KJV', name: 'K', type: 'bible', sizeBytes: 1, downloadedAt: '2026-01-01' });
    await mgr.removeModule('KJV');
    expect(mocks.removeModuleAsset).toHaveBeenCalledWith('KJV');
    expect(root.peek('modules/KJV.db')).toBeUndefined();
    await mgr.removeModule('KJV'); // nothing left: no throw
  });
});
