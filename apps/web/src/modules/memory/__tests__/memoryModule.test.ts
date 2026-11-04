/**
 * The Memory web module through the REAL web host: manifest, the `localUserDb` flag, lazy loading, the boot-probe
 * activation that registers the `memory.bible` host API. Each test boots a fresh module graph.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { memoryManifest } from '@bible/memory/manifest';
import { memoryWebManifest } from '../manifest';

vi.mock('../webBible', () => ({ webBible: { listModules: async () => [{ abbreviation: 'KJV' }] } }));
vi.mock('../MemoryApp', () => ({ MemoryApp: () => null }));
vi.mock('../../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../i18n')>()),
  loadNamespace: async () => {},
}));
vi.mock('../../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

async function boot(flagOn: boolean) {
  vi.resetModules();
  localStorage.setItem('kth.modules', '');
  const { setClientConfig } = await import('../../../utils/clientConfig');
  setClientConfig({ features: { localUserDb: flagOn } } as never);
  const host = await import('../../moduleHost');
  const apps = await import('../../../host/appHost');
  const { memoryWebModule } = await import('../binding');
  const client = await import('../../../userdb/client');
  host.addWebModule(memoryWebModule);
  host.reconcileModules();
  return { ...host, ...apps, client };
}

beforeEach(() => {
  localStorage.clear();
});

describe('the Memory web manifest', () => {
  it('validates, is web-only and carries the flag; the shared manifest has none', () => {
    expect(validateBuiltinManifest(memoryWebManifest)).toEqual([]);
    expect(memoryWebManifest.flag).toBe('localUserDb');
    expect(memoryWebManifest.platforms).toEqual(['web']);
    expect(memoryWebManifest.contributes.apps?.[0]).toMatchObject({
      id: 'memory', title: { key: 'apps.memory.title', fallback: 'Memory' }, deepLink: { segment: 'memory' }, platforms: ['web'],
    });
    expect(memoryWebManifest.contributes.verseActions?.[0]).toMatchObject({
      id: 'memory.memorize', title: { key: 'verseActions.memorize', fallback: 'Memorize' }, appId: 'memory',
    });
    // Shared manifest: truthful platforms, and no flag (it would turn Memory off on desktop).
    expect(memoryManifest.platforms).toEqual(['desktop', 'web']);
    expect((memoryManifest as { flag?: string }).flag).toBeUndefined();
  });
});

describe('the Memory module: flag off', () => {
  it('contributes nothing and the boot probe is not run', async () => {
    const h = await boot(false);
    expect(h.appRegistry.get('memory')).toBeUndefined();
    expect(h.verseActions.get('memory.memorize')).toBeUndefined();
    expect(h.runBootProbes().activate).toEqual([]);
    expect(h.featureModules.isActive('memory')).toBe(false);
  }, 60_000);
});

describe('the Memory module: flag on', () => {
  it('contributes the app and the verse action; the boot probe activates it and registers memory.bible', async () => {
    const h = await boot(true);
    expect(h.appRegistry.get('memory')).toMatchObject({ id: 'memory' });
    expect(h.verseActions.get('memory.memorize')).toBeDefined();
    expect(h.featureModules.isActive('memory')).toBe(false); // no code until the probe/app/verse action

    const intents = h.runBootProbes();
    expect(intents.activate).toEqual(['memory']);
    h.activateProbedModules(intents.activate);
    await vi.waitFor(() => expect(h.featureModules.isActive('memory')).toBe(true));
    const api = h.client.hostApiLookupForTests('memory.bible') as { listModules(): Promise<unknown[]> } | undefined;
    expect(await api?.listModules()).toEqual([{ abbreviation: 'KJV' }]);
  }, 60_000);

  it('switching the module off at runtime removes the app and the verse action', async () => {
    const h = await boot(true);
    localStorage.setItem('kth.modules', '-memory');
    h.reconcileModules();
    expect(h.appRegistry.get('memory')).toBeUndefined();
    expect(h.verseActions.get('memory.memorize')).toBeUndefined();
  }, 60_000);
});
