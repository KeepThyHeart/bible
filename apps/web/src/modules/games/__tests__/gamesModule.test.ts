/**
 * The Games module through the REAL web host (task 0115): manifest ids, the
 * off switch, lazy activation and the live badge. Each test boots a fresh
 * module graph, the way present/__tests__/presentModule.test.ts does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

const spies = vi.hoisted(() => ({ moduleLoaded: vi.fn(), moduleActivate: vi.fn() }));

vi.mock('../module', () => {
  spies.moduleLoaded();
  return { activate: spies.moduleActivate, hooks: {} };
});
vi.mock('../app/GamesApp', () => ({ GamesApp: () => null }));
vi.mock('../../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../i18n')>()),
  loadNamespace: async () => {},
}));
vi.mock('../../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

async function boot(opts: { override?: string; disabled?: string[] } = {}) {
  vi.resetModules();
  localStorage.setItem('kth.modules', opts.override ?? '');
  if (opts.disabled) {
    const { setClientConfig } = await import('../../../utils/clientConfig');
    setClientConfig({ modules: { disabled: opts.disabled } });
  }
  const { registerBuiltinModules } = await import('../../builtinModules');
  const host = await import('../../moduleHost');
  const apps = await import('../../../host/appHost');
  registerBuiltinModules();
  return { ...host, ...apps };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('manifest', () => {
  it('keeps its persisted ids and validates', async () => {
    const { gamesManifest, gamesDescriptor, gamesTile } = await import('../manifest');
    const { checkFeatureModuleManifest } = await import('@bible/core/browser');
    expect(checkFeatureModuleManifest(gamesManifest).errors).toEqual([]);
    expect(gamesManifest.id).toBe('games');
    expect(gamesDescriptor).toMatchObject({ id: 'games', deepLink: { segment: 'games' }, platforms: ['web'] });
    expect(gamesTile).toMatchObject({ id: 'games', target: { appId: 'games' } });
    expect(gamesManifest.contributes?.serverRoutes?.map((r) => r.path)).toEqual(['/api/games', '/games']);
  });
});

describe('the Games module: on by default', () => {
  it('contributes its app, tile and namespace, and loads no code at boot', async () => {
    const h = await boot();
    expect(h.appRegistry.get('games')).toMatchObject({ id: 'games', lifecycle: { keepAlive: 'while-busy' } });
    expect(h.modulePoints.newTabTiles.get('games')).toMatchObject({ target: { appId: 'games' } });
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).toContain('games');
    expect(spies.moduleLoaded).not.toHaveBeenCalled();
    expect(h.featureModules.isEnabled('games')).toBe(true);
    expect(h.featureModules.isActive('games')).toBe(false);
  }, 60_000);

  it('opening the app fires onApp:games first, so the module is active', async () => {
    const h = await boot();
    const result = await h.appHost.activate('games');
    expect(result.status).toBe('activated');
    expect(h.featureModules.isActive('games')).toBe(true);
    expect((spies.moduleActivate.mock.calls[0] as unknown[])[0]).toMatchObject({ activationEvent: 'onApp:games' });
  }, 60_000);

  it('has no boot probe: nothing from the URL or storage touches it', async () => {
    const h = await boot();
    // Other modules (Similar, Measures, Keyword marks) have boot probes of their own; Games has none.
    const probes = h.runBootProbes();
    expect(probes).toMatchObject({ initialApp: undefined, busyApps: [] });
    expect(probes.activate).not.toContain('games');
  }, 60_000);
});

describe.each([
  ['the dev override', { override: '-games' }],
  ['the server config', { disabled: ['games'] }],
])('the Games module: off via %s', (_name, opts) => {
  it('has no contributions and no binding; the rest stays', async () => {
    const h = await boot(opts);
    expect(h.appRegistry.get('games')).toBeUndefined();
    expect(h.modulePoints.newTabTiles.has('games')).toBe(false);
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).not.toContain('games');
    expect(h.featureModules.isEnabled('games')).toBe(false);
    expect((await h.appHost.activate('games')).status).not.toBe('activated');
    expect(spies.moduleLoaded).not.toHaveBeenCalled();
    expect(h.modulePoints.newTabTiles.has('readBible')).toBe(true);
    expect(h.appRegistry.get('present')).toBeDefined();
  }, 60_000);

  it('switched off at runtime, its contributions disappear', async () => {
    const h = await boot();
    expect(h.appRegistry.get('games')).toBeDefined();
    localStorage.setItem('kth.modules', '-games');
    h.reconcileModules();
    expect(h.appRegistry.get('games')).toBeUndefined();
    expect(h.modulePoints.newTabTiles.has('games')).toBe(false);
  }, 60_000);
});

describe('the live badge', () => {
  it('reports a room as busy with a live dot, and clears it', async () => {
    vi.doUnmock('../module');
    vi.resetModules();
    vi.doMock('../../../i18n', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../../i18n')>()),
      loadNamespace: async () => {},
    }));
    const { registerBuiltinModules } = await import('../../builtinModules');
    const apps = await import('../../../host/appHost');
    const { reportGamesLive } = await import('../runtime');
    registerBuiltinModules();
    await apps.appHost.activate('games');
    reportGamesLive(true);
    expect(apps.appRegistry.get('games')).toBeDefined();
    expect(apps.appRegistry.isBusy('games')).toBe(true);
    expect(apps.appRegistry.getBadge('games')).toMatchObject({ tone: 'live' });
    reportGamesLive(false);
    expect(apps.appRegistry.getBadge('games')).toBeUndefined();
  }, 60_000);
});
