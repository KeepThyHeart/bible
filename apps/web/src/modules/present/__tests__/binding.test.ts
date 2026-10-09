/**
 * The Presenter's web wiring (manifest + binding), moved here from the host's
 * builtinApps test: the app and its busy sink, the lazy verse action, the
 * PresentBar companion, the boot probe and app selection. The module is added
 * to the real web host; only its lazy chunks are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PRESENT_SESSION_KEY } from '../lib/sessionKey';

const spies = vi.hoisted(() => ({
  moduleLoaded: vi.fn(),
  handlerLoaded: vi.fn(),
  run: vi.fn(),
  ensureRuntime: vi.fn(async () => {}),
}));

vi.mock('../module', () => {
  spies.moduleLoaded();
  return { activate: vi.fn(), hooks: {} };
});
vi.mock('../app/PresenterApp', () => ({ PresenterApp: () => null }));
vi.mock('../study/PresentBar', () => ({ PresentBar: () => null }));
vi.mock('../app/presentVerseAction', () => {
  spies.handlerLoaded();
  return { presentVerseHandler: { run: spies.run } };
});
vi.mock('../runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runtime')>()),
  ensurePresenterRuntime: spies.ensureRuntime,
}));
vi.mock('../../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../i18n')>()),
  loadNamespace: async () => {},
}));
vi.mock('../../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

async function load() {
  vi.resetModules();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  const host = await import('../../moduleHost');
  const apps = await import('../../../host/appHost');
  const { presentModule, presentBoot } = await import('../binding');
  const { presentManifest } = await import('../manifest');
  host.addWebModule(presentModule);
  host.reconcileModules();
  return { ...host, ...apps, presentModule, presentBoot, presentManifest };
}

describe('Presenter binding', { timeout: 30000 }, () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers the Presenter app from the manifest and activates it lazily through the module', async () => {
    const { appRegistry, appHost, setShellContext, presentManifest } = await load();
    expect(appRegistry.list().map((d) => d.id)).toEqual(['present']);
    expect(appRegistry.get('present')).toMatchObject(presentManifest.contributes.apps![0]);
    expect(spies.moduleLoaded).not.toHaveBeenCalled();

    setShellContext({} as never);
    const r = await appHost.activate('present');
    expect(r.status).toBe('activated');
    expect(spies.ensureRuntime).toHaveBeenCalledWith(null);
    expect(appHost.getSnapshot().mounted).toEqual(['present']);
    expect(spies.moduleLoaded).toHaveBeenCalled(); // onApp:present activated the module
  });

  it('registers the Present verse action without loading its handler until run', async () => {
    const { verseActions, appRegistry } = await load();
    const { evalVerseWhen } = await import('../../../host/verseActionWhen');
    const entry = verseActions.get('present.showVerse');
    expect(entry).toBeTruthy();
    expect(entry!.when).toBe('present.live');
    expect(entry!.appId).toBe('present');
    // not busy: `when` keeps it out of the menu
    appRegistry.setBusy('present', false);
    expect(evalVerseWhen(entry!.when!)).toBe(false);
    appRegistry.setBusy('present', true);
    expect(evalVerseWhen(entry!.when!)).toBe(true);
    expect(spies.handlerLoaded).not.toHaveBeenCalled();
    await verseActions.run('present.showVerse', { verseId: 43003016, verseIds: [43003016], module: 'KJV', surface: 'reader' });
    expect(spies.handlerLoaded).toHaveBeenCalledTimes(1);
    expect(spies.run).toHaveBeenCalledOnce();
  });

  it('gives Present a PresentBar companion that applies only while busy', async () => {
    const { getAppCompanion } = await load();
    expect(getAppCompanion('present')?.when).toBe('busy');
    expect(getAppCompanion('study')).toBeUndefined();
  });

  it('contributes the watch tile as a link to /watch', async () => {
    const { presentManifest } = await load();
    expect(presentManifest.contributes.newTabTiles).toEqual([
      expect.objectContaining({ id: 'watchPresentation', target: { href: '/watch' } }),
    ]);
  });

  describe('boot probe', () => {
    const sid = '0123456789ABCDEF';
    const token = 'A'.repeat(43);

    it('finds nothing on an ordinary load', async () => {
      const { runBootProbes } = await load();
      expect(runBootProbes()).toEqual({ initialApp: undefined, busyApps: [], activate: [] });
    });

    it('a control link adopts the Presenter and scrubs the token from the URL', async () => {
      const { runBootProbes, presentBoot } = await load();
      window.history.replaceState(null, '', `/present/c/${sid}#t=${token}&j=ABCD2345`);
      const intents = runBootProbes();
      expect(intents.initialApp).toBe('present');
      expect(intents.activate).toEqual(['present']);
      expect(presentBoot.adopted).toMatchObject({ sessionId: sid, controlToken: token });
      expect(window.location.href).not.toContain(token);
    });

    it('a follow link opens Study, following', async () => {
      const { runBootProbes, presentBoot } = await load();
      window.history.replaceState(null, '', '/present/f/ABCD2345');
      const intents = runBootProbes();
      expect(intents.initialApp).toBe('study');
      expect(intents.activate).toEqual(['present']);
      expect(presentBoot.followCode).toBe('ABCD2345');
    });

    it('a saved session marks the Presenter busy so it can be restored', async () => {
      const { runBootProbes } = await load();
      localStorage.setItem(PRESENT_SESSION_KEY, JSON.stringify({
        sessionId: sid, controlToken: token, joinCode: 'ABCD2345', expiresAt: '2099-01-01T00:00:00Z',
      }));
      const intents = runBootProbes();
      expect(intents.busyApps).toEqual(['present']);
      expect(intents.activate).toEqual(['present']);
    });
  });

  it('resolveInitialApp by boot path', async () => {
    await load();
    const { resolveInitialApp } = await import('../../../boot/runBoot');
    const none = { busyApps: [] as string[] };
    expect(resolveInitialApp(none, '#/@present')).toBe('present');
    expect(resolveInitialApp(none, '#/@bogus')).toBe('study');
    expect(resolveInitialApp(none, '#/KJV/1/1')).toBe('study');
    expect(resolveInitialApp({ ...none, initialApp: 'study' }, '#/@present')).toBe('study');
    expect(resolveInitialApp({ ...none, initialApp: 'present' }, '')).toBe('present');
  });
});
