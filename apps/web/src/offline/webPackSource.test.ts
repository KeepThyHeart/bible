import { describe, it, expect, vi } from 'vitest';
import type { AssetEntry, AssetManifest, IAssetManager } from '@bible/core/browser';

vi.mock('./moduleAssets', () => ({
  getModuleAssetManager: vi.fn(),
  refreshModuleCatalog: vi.fn(async () => true),
  getModuleCatalog: vi.fn(() => []),
  installModuleAsset: vi.fn(),
  removeModuleAsset: vi.fn(),
  moduleAssetId: (a: string) => `module.${a}`,
}));
vi.mock('../assets/webAssets', () => ({ getAssetManager: vi.fn() }));

import { createWebPackSource } from './webPackSource';

const mod = (abbr: string, moduleType: string, version = '1'): AssetManifest =>
  ({ id: `module.${abbr}`, kind: 'module', version, title: abbr, license: 'PD', size: 1000, files: [],
     meta: { moduleType, abbreviation: abbr, name: `Name ${abbr}`, languageCode: 'en', storedSize: 4000 } }) as AssetManifest;

function mgr(entries: Partial<AssetEntry>[], installed: Record<string, { version: string; size: number }> = {}) {
  return {
    getSnapshot: () => ({ entries: entries as AssetEntry[], storedBytes: 0, active: 0 }),
    installed: (id: string) => installed[id],
  } as unknown as IAssetManager;
}

const base = { refreshModules: async () => true, presets: () => [], legacyModules: () => [] };

describe('createWebPackSource', () => {
  it('maps modules: only bible is offline readable, sizes and group', async () => {
    const s = createWebPackSource({ ...base, moduleCatalog: () => [mod('KJV', 'bible'), mod('MHC', 'commentary')], moduleManager: () => mgr([]), assetManager: () => mgr([]) });
    const offers = await s.listOffers();
    const kjv = offers.find((o) => o.key === 'module:kjv')!;
    const mhc = offers.find((o) => o.key === 'module:mhc')!;
    expect(kjv).toMatchObject({ group: 'bible', offlineReadable: true, downloadBytes: 1000, storedBytes: 4000, status: 'absent', language: 'en' });
    expect(mhc).toMatchObject({ group: 'commentary', offlineReadable: false });
  });

  it('reports installed, update-available and installing', async () => {
    const s = createWebPackSource({
      ...base,
      moduleCatalog: () => [mod('A', 'bible', '1'), mod('B', 'bible', '2'), mod('C', 'bible', '1')],
      moduleManager: () => mgr([{ id: 'module.C', status: 'downloading' }], { 'module.A': { version: '1', size: 4000 }, 'module.B': { version: '1', size: 3000 } }),
      assetManager: () => mgr([]),
    });
    const by = Object.fromEntries((await s.listOffers()).map((o) => [o.key, o]));
    expect(by['module:a']!.status).toBe('installed');
    expect(by['module:b']).toMatchObject({ status: 'update-available', installedVersion: '1', installedStoredBytes: 3000 });
    expect(by['module:c']!.status).toBe('installing');
  });

  it('treats a legacy offlineStore download as installed, matching the client abbreviation case-insensitively', async () => {
    const shortMod = { ...mod('Short', 'bible'), id: 'module.longdbname' } as AssetManifest;
    const s = createWebPackSource({
      ...base,
      moduleCatalog: () => [shortMod, mod('Other', 'bible')],
      moduleManager: () => mgr([]),
      assetManager: () => mgr([]),
      legacyModules: () => [{ abbreviation: 'SHORT', name: 'Short', type: 'bible', sizeBytes: 7777, downloadedAt: '' }],
    });
    const by = Object.fromEntries((await s.listOffers()).map((o) => [o.key, o]));
    expect(by['module:short']).toMatchObject({ status: 'installed', installedStoredBytes: 7777 });
    expect(by['module:other']!.status).toBe('absent');
  });

  it('offers voices (requiring the runtime) and data from the main catalog', async () => {
    const e = (id: string, kind: string, size: number): Partial<AssetEntry> => ({ id, kind, title: id, version: '1', size, status: 'available', storedBytes: 0 });
    const s = createWebPackSource({
      ...base,
      moduleCatalog: () => [],
      moduleManager: () => mgr([]),
      assetManager: () => mgr([e('piper-runtime', 'tts-runtime', 10), e('amy', 'tts-voice', 60), e('nbr', 'data', 5), e('x', 'stt-model', 1)]),
    });
    const offers = await s.listOffers();
    expect(offers.map((o) => o.key).sort()).toEqual(['asset:amy', 'asset:nbr', 'asset:piper-runtime']);
    const amy = offers.find((o) => o.key === 'asset:amy')!;
    expect(amy).toMatchObject({ group: 'speech', requires: [{ kind: 'asset', id: 'piper-runtime' }] });
    expect(offers.find((o) => o.key === 'asset:nbr')!.group).toBe('data');
  });

  it('computes free bytes from the storage estimate, else null', async () => {
    const mk = (estimate: () => Promise<{ quota?: number; usage?: number } | undefined>) =>
      createWebPackSource({ ...base, moduleCatalog: () => [], moduleManager: () => mgr([]), assetManager: () => mgr([]), estimate });
    expect(await mk(async () => ({ quota: 1000, usage: 400 })).freeBytes()).toBe(600);
    expect(await mk(async () => undefined).freeBytes()).toBeNull();
    expect(await mk(async () => { throw new Error('x'); }).freeBytes()).toBeNull();
  });

  it('survives a failing catalog refresh and returns presets from deps', async () => {
    const s = createWebPackSource({
      refreshModules: async () => { throw new Error('offline'); },
      presets: () => [{ id: 'p', name: 'P', items: [] }],
      moduleCatalog: () => [mod('KJV', 'bible')], moduleManager: () => mgr([]), assetManager: () => mgr([]),
    });
    expect((await s.listOffers()).length).toBe(1);
    expect((await s.listPresets())[0]!.id).toBe('p');
  });
});
