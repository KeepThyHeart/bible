/**
 * The Presenter module through the REAL web host (task 0123): the off switch,
 * its contributions, the boot probe and lazy activation. Each test boots a
 * fresh module graph, the way builtinModules.test.ts does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PRESENT_SESSION_KEY } from '../lib/sessionKey';

const spies = vi.hoisted(() => ({
  moduleLoaded: vi.fn(),
  moduleActivate: vi.fn(),
  verseRun: vi.fn(),
  ensureRuntime: vi.fn(async () => {}),
}));

vi.mock('../module', () => {
  spies.moduleLoaded();
  return { activate: spies.moduleActivate, hooks: {} };
});
vi.mock('../app/PresenterApp', () => ({ PresenterApp: () => null }));
vi.mock('../study/PresentBar', () => ({ PresentBar: () => null }));
vi.mock('../app/presentVerseAction', () => ({ presentVerseHandler: { run: spies.verseRun } }));
vi.mock('../runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runtime')>()),
  ensurePresenterRuntime: spies.ensureRuntime,
}));
vi.mock('../../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../i18n')>()),
  loadNamespace: async () => {},
}));
vi.mock('../../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

const SESSION = '0123456789ABCDEF'; // 16 Crockford chars
const TOKEN = 'A'.repeat(43);

async function boot(opts: { override?: string; disabled?: string[]; url?: string } = {}) {
  vi.resetModules();
  localStorage.setItem('kth.modules', opts.override ?? '');
  window.history.replaceState(null, '', opts.url ?? '/');
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
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
});

function present(h: Awaited<ReturnType<typeof boot>>) {
  return {
    app: h.appRegistry.get('present'),
    action: h.verseActions.has('present.showVerse'),
    tile: h.modulePoints.newTabTiles.get('watchPresentation'),
    ns: JSON.stringify(h.modulePoints.i18nNamespace.list()).includes('present'),
  };
}

async function actionRuns(h: Awaited<ReturnType<typeof boot>>): Promise<boolean> {
  try {
    await h.verseActions.run('present.showVerse', { verseId: 1001001, verseIds: [1001001], module: 'KJV', surface: 'reader' });
    return true;
  } catch {
    return false;
  }
}

describe('the Presenter module: on by default', () => {
  it('contributes its app, verse action, home tile and i18n namespace, and loads no code', async () => {
    const h = await boot();
    const p = present(h);
    expect(p.app).toMatchObject({ id: 'present', ownChrome: true });
    expect(p.action).toBe(true);
    expect(p.tile).toMatchObject({ target: { href: '/watch' } });
    expect(p.ns).toBe(true);
    expect(spies.moduleLoaded).not.toHaveBeenCalled();
    expect(spies.moduleActivate).not.toHaveBeenCalled();
    expect(h.featureModules.isEnabled('present')).toBe(true);
    expect(h.featureModules.isActive('present')).toBe(false);
  }, 60_000);

  it('loading the app binding fires onApp:present first, so the module is active', async () => {
    const h = await boot();
    const result = await h.appHost.activate('present');
    expect(result.status).toBe('activated');
    expect(h.featureModules.isActive('present')).toBe(true);
    expect(spies.moduleActivate).toHaveBeenCalledTimes(1);
    expect((spies.moduleActivate.mock.calls[0] as unknown[])[0]).toMatchObject({ activationEvent: 'onApp:present' });
  }, 60_000);

  it('running the verse action activates the module (onVerseAction) and runs the lazy handler', async () => {
    const h = await boot();
    expect(await actionRuns(h)).toBe(true);
    expect(spies.verseRun).toHaveBeenCalledTimes(1);
    expect(h.featureModules.isActive('present')).toBe(true);
  }, 60_000);
});

describe.each([
  ['the dev override', { override: '-present' }],
  ['the server config', { disabled: ['present'] }],
])('the Presenter module: off via %s', (_name, opts) => {
  it('has no contributions, no app binding and no verse action handler; the rest stays', async () => {
    const h = await boot(opts);
    const p = present(h);
    expect(p.app).toBeUndefined();
    expect(p.action).toBe(false);
    expect(p.tile).toBeUndefined();
    expect(p.ns).toBe(false);
    expect(h.featureModules.isEnabled('present')).toBe(false);

    const result = await h.appHost.activate('present');
    expect(result.status).not.toBe('activated');
    expect(await actionRuns(h)).toBe(false);
    expect(spies.verseRun).not.toHaveBeenCalled();
    expect(spies.moduleLoaded).not.toHaveBeenCalled();

    // The rest is unaffected.
    expect(h.modulePoints.paneModes.list().map((x) => x.id)).toContain('study');
    expect(h.modulePoints.newTabTiles.list().length).toBeGreaterThan(0);
    expect(h.modulePoints.newTabTiles.has('watchPresentation')).toBe(false);
  }, 60_000);

  it('does not run the boot probe: a control link stays in the URL and a follow link is not taken', async () => {
    const control = `/present/c/${SESSION}#t=${TOKEN}&j=ABCDEFGH`;
    const h = await boot({ ...opts, url: control });
    expect(h.runBootProbes()).toEqual({ initialApp: undefined, busyApps: [], activate: [] });
    expect(window.location.pathname + window.location.hash).toBe(control);

    window.history.replaceState(null, '', '/present/f/ABCDEFGH');
    localStorage.setItem(PRESENT_SESSION_KEY, '{}');
    expect(h.runBootProbes()).toEqual({ initialApp: undefined, busyApps: [], activate: [] });
    const { presentBoot } = await import('../binding');
    expect(presentBoot.followCode).toBeNull();
    expect(presentBoot.adopted).toBeNull();
  }, 60_000);
});

describe('the Presenter module: switched off at runtime', () => {
  it('override + reconcileModules() removes everything it registered, and back on restores it', async () => {
    const h = await boot();
    expect(present(h).app).toBeDefined();
    await h.appHost.activate('present');
    expect(h.featureModules.isActive('present')).toBe(true);

    localStorage.setItem('kth.modules', '-present');
    h.reconcileModules();
    const p = present(h);
    expect(p).toEqual({ app: undefined, action: false, tile: undefined, ns: false });
    expect(h.featureModules.isActive('present')).toBe(false);
    expect(await actionRuns(h)).toBe(false);
    expect((await h.appHost.activate('present')).status).not.toBe('activated');

    localStorage.setItem('kth.modules', '');
    h.reconcileModules();
    expect(present(h).app).toBeDefined();
    expect(present(h).action).toBe(true);
  }, 60_000);
});

describe('the Presenter module: boot probe', () => {
  it('a plain load asks for nothing', async () => {
    const h = await boot();
    expect(h.runBootProbes()).toEqual({ initialApp: undefined, busyApps: [], activate: [] });
  }, 60_000);

  it('a follow link opens Study and activates the module', async () => {
    const h = await boot({ url: '/present/f/ABCDEFGH' });
    expect(h.runBootProbes()).toEqual({ initialApp: 'study', busyApps: [], activate: ['present'] });
    const { presentBoot } = await import('../binding');
    expect(presentBoot.followCode).toBe('ABCDEFGH');
  }, 60_000);

  it('a control link opens the Presenter and scrubs the token from the URL', async () => {
    const h = await boot({ url: `/present/c/${SESSION}#t=${TOKEN}&j=ABCDEFGH` });
    expect(h.runBootProbes()).toEqual({ initialApp: 'present', busyApps: [], activate: ['present'] });
    expect(window.location.pathname + window.location.hash).toBe('/#/@present');
    const { presentBoot } = await import('../binding');
    expect(presentBoot.adopted).toMatchObject({ sessionId: SESSION, joinCode: 'ABCDEFGH', controlToken: TOKEN });
  }, 60_000);

  it('a control link survives a reload before the probe through sessionStorage, cleared by the probe', async () => {
    sessionStorage.clear();
    const h = await boot({ url: `/present/c/${SESSION}#t=${TOKEN}&j=ABCDEFGH` });
    const { presentModule } = await import('../binding');
    presentModule.takeUrl?.();
    expect(sessionStorage.getItem('kth.present.handoff')).toContain(TOKEN);
    // Stale-build reload: fresh module graph, URL already scrubbed, handoff still stored.
    const stored = sessionStorage.getItem('kth.present.handoff') as string;
    const h2 = await boot({ url: '/' });
    sessionStorage.setItem('kth.present.handoff', stored);
    expect(h2.runBootProbes()).toEqual({ initialApp: 'present', busyApps: [], activate: ['present'] });
    const { presentBoot } = await import('../binding');
    expect(presentBoot.adopted).toMatchObject({ sessionId: SESSION, controlToken: TOKEN });
    expect(sessionStorage.getItem('kth.present.handoff')).toBeNull();
    void h;
  }, 60_000);

  it('a saved, unexpired session marks the Presenter busy; an expired one is ignored', async () => {
    localStorage.setItem(PRESENT_SESSION_KEY, JSON.stringify({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
    const h = await boot();
    // boot() resets the override key only, so the saved session is still there.
    expect(h.runBootProbes()).toEqual({ initialApp: undefined, busyApps: ['present'], activate: ['present'] });

    localStorage.setItem(PRESENT_SESSION_KEY, JSON.stringify({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(h.runBootProbes()).toEqual({ initialApp: undefined, busyApps: [], activate: [] });
  }, 60_000);

  it('activateProbedModules activates the module with the boot-probe reason, loading its code', async () => {
    const h = await boot({ url: '/present/f/ABCDEFGH' });
    const intents = h.runBootProbes();
    expect(spies.moduleLoaded).not.toHaveBeenCalled();
    h.activateProbedModules(intents.activate);
    await vi.waitFor(() => expect(h.featureModules.isActive('present')).toBe(true));
    expect((spies.moduleActivate.mock.calls[0] as unknown[])[0]).toMatchObject({ activationEvent: 'onBootProbe' });
  }, 60_000);
});
