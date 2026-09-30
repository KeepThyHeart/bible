import { describe, it, expect } from 'vitest';
import { createDesktopPackSource } from './desktopPackSource';
import type { DesktopPackSourceDeps, PackCatalogModule } from './desktopPackSource';

const mod = (over: Partial<PackCatalogModule>): PackCatalogModule => ({
  module_id: 'kjv',
  module_type: 'bible',
  name: 'King James',
  abbreviation: 'KJV',
  language_code: 'en',
  version: '1.0',
  download_size_bytes: 100,
  installed_size_bytes: 300,
  ...over,
});

function deps(over: Partial<DesktopPackSourceDeps> = {}): DesktopPackSourceDeps {
  return {
    getAvailable: () => [
      mod({}),
      mod({ module_id: 'mhc', module_type: 'commentary', name: 'Matthew Henry', abbreviation: 'MHC', requires_module: 'kjv' }),
      mod({ module_id: 'tsk', module_type: 'cross_reference', name: 'TSK', abbreviation: 'TSK' }),
      mod({ module_id: 'web', module_type: 'bible', name: 'WEB', abbreviation: 'WEB' }),
      mod({ module_id: 'dev', module_type: 'devotional', name: 'Dev', abbreviation: 'DEV' }),
    ],
    getInstalled: () => [
      { abbreviation: 'kjv', version: '0.9', update_available: true },
      { abbreviation: 'TSK', version: '1.0', update_available: false },
    ],
    getActiveDownloads: () => [{ moduleId: 'WEB', status: 'downloading' }, { moduleId: 'mhc', status: 'completed' }],
    getStarterPacks: async () => [
      { pack_id: 'en-basic', name: 'English basics', module_ids: ['kjv', 'mhc'], source: { catalogId: 7 } },
    ],
    ...over,
  };
}

describe('createDesktopPackSource', () => {
  it('maps catalog modules to offers', async () => {
    const offers = await createDesktopPackSource(deps()).listOffers();
    const by = Object.fromEntries(offers.map((o) => [o.ref.id, o]));
    expect(by.kjv).toMatchObject({
      key: 'module:kjv',
      group: 'bible',
      language: 'en',
      downloadBytes: 100,
      storedBytes: 300,
      offlineReadable: true,
      status: 'update-available',
      installedVersion: '0.9',
      catalogId: 7,
    });
    expect(by.mhc.group).toBe('commentary');
    expect(by.mhc.requires).toEqual([{ kind: 'module', id: 'kjv' }]);
    expect(by.mhc.status).toBe('absent');
    expect(by.tsk).toMatchObject({ group: 'crossref', status: 'installed' });
    expect(by.web.status).toBe('installing');
    expect(by.dev.group).toBe('other');
    expect(by.dev.catalogId).toBeUndefined();
  });

  it('prefers a catalog id carried by the module', async () => {
    const offers = await createDesktopPackSource(deps({ getAvailable: () => [mod({ catalogId: 2 })] })).listOffers();
    expect(offers[0].catalogId).toBe(2);
  });

  it('builds presets from starter packs and tolerates failures', async () => {
    const presets = await createDesktopPackSource(deps()).listPresets();
    expect(presets).toEqual([
      { id: 'en-basic', name: 'English basics', items: [{ kind: 'module', id: 'kjv' }, { kind: 'module', id: 'mhc' }] },
    ]);
    const failing = createDesktopPackSource(deps({ getStarterPacks: async () => { throw new Error('x'); } }));
    expect(await failing.listPresets()).toEqual([]);
    expect((await failing.listOffers()).length).toBe(5);
  });

  it('freeBytes is null unless supplied', async () => {
    expect(await createDesktopPackSource(deps()).freeBytes()).toBeNull();
    expect(await createDesktopPackSource(deps({ getFreeBytes: async () => 5 })).freeBytes()).toBe(5);
  });
});
