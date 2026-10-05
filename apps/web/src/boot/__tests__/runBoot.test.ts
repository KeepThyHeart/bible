import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  ctx: null as unknown,
  bootShell: vi.fn(),
  bootStudy: vi.fn(async () => {}),
  afterStudyFirstPaint: vi.fn(),
  getOfflineBible: vi.fn(async () => ({})),
  ensurePresenterRuntime: vi.fn(async () => {}),
  inits: {
    bible: vi.fn(), search: vi.fn(), commentary: vi.fn(), study: vi.fn(), dictionary: vi.fn(),
    loadChapter: vi.fn(),
  },
  hasStored: vi.fn(() => false),
  presenterMounted: vi.fn(),
  studyMounted: vi.fn(),
}));

vi.mock('../shellBoot', () => ({ bootShell: h.bootShell }));
vi.mock('../../apps/study/studyBoot', () => ({
  bootStudy: h.bootStudy,
  afterStudyFirstPaint: h.afterStudyFirstPaint,
}));
vi.mock('../offlineBible', () => ({ getOfflineBible: h.getOfflineBible }));
vi.mock('../../host/presenterRuntime', () => ({
  ensurePresenterRuntime: h.ensurePresenterRuntime,
  hasStoredPresenterSession: () => h.hasStored(),
  setPresenterBusySink: vi.fn(),
}));
vi.mock('../../apps/present/PresenterApp', () => ({ PresenterApp: () => null }));
vi.mock('../../DesktopApp', () => ({ DesktopApp: () => null }));
vi.mock('../../MobileApp', () => ({ MobileApp: () => null }));
vi.mock('../../components/Present/FollowBanner', () => ({ FollowBanner: () => null }));
vi.mock('../../components/ErrorBoundary', () => ({ ErrorBoundary: () => null }));
vi.mock('../../host/AppShell', () => ({ AppShell: () => null }));
vi.mock('../../utils/bootPrefetch', () => ({ releaseBootPrefetch: vi.fn(), bootFetch: vi.fn() }));
vi.mock('../../stores/bibleStore', () => ({ bibleStore: { init: h.inits.bible, loadChapter: h.inits.loadChapter } }));
vi.mock('../../stores/searchStore', () => ({ searchStore: { init: h.inits.search } }));
vi.mock('../../stores/commentaryStore', () => ({ commentaryStore: { init: h.inits.commentary } }));
vi.mock('../../stores/studyStore', () => ({ studyStore: { init: h.inits.study } }));
vi.mock('../../stores/dictionaryStore', () => ({ dictionaryStore: { init: h.inits.dictionary } }));

function makeCtx(over: Record<string, unknown> = {}) {
  return {
    baseUrl: '', providers: {}, serverOnline: true, serverStaleDays: undefined,
    offlineAutoDownload: false, semanticMode: 'off', adoptedSession: null, followCode: null,
    localeReady: Promise.resolve(), ...over,
  };
}

async function boot(hash: string, ctxOver: Record<string, unknown> = {}, path = '/') {
  window.history.replaceState(null, '', path + hash);
  h.bootShell.mockResolvedValue(makeCtx(ctxOver));
  const { runBoot } = await import('../runBoot');
  const { appHost } = await import('../../host/appHost');
  const render = vi.fn();
  await runBoot({ render });
  return { render, appHost };
}

function noStudyInits(): void {
  for (const fn of Object.values(h.inits)) expect(fn).not.toHaveBeenCalled();
  expect(h.bootStudy).not.toHaveBeenCalled();
  expect(h.afterStudyFirstPaint).not.toHaveBeenCalled();
  expect(h.getOfflineBible).not.toHaveBeenCalled();
}

describe('runBoot app selection', { timeout: 30000 }, () => {
  const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => '' }));

  // The first dynamic import transforms the whole boot graph; do it once up front
  // so the timed tests do not pay for it under parallel load.
  beforeAll(async () => {
    await import('../runBoot');
  }, 60000);

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    h.hasStored.mockReturnValue(false);
    localStorage.clear();
    vi.stubGlobal('fetch', fetchSpy);
    // Resolve requestAnimationFrame immediately so the post-boot callbacks run synchronously.
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0; });
  });

  it('#/@present activates only the Presenter and touches nothing of Study', async () => {
    const { render, appHost } = await boot('#/@present');
    expect(render).toHaveBeenCalledTimes(1);
    expect(appHost.getSnapshot().activeId).toBe('present');
    expect(window.location.hash).toBe('#/@present');
    noStudyInits();
    const urls = fetchSpy.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes('/api/bible/'))).toBe(false);
    expect(h.ensurePresenterRuntime).not.toHaveBeenCalledWith(expect.anything());
  });

  it('a plain hash boots Study (once)', async () => {
    const { appHost } = await boot('#/John/3');
    expect(appHost.getSnapshot().activeId).toBe('study');
    expect(h.bootStudy).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#/John/3');
  });

  it('no hash boots Study', async () => {
    const { appHost } = await boot('');
    expect(appHost.getSnapshot().activeId).toBe('study');
    expect(h.bootStudy).toHaveBeenCalledTimes(1);
  });

  it('a follow link boots Study even with a presenter hash', async () => {
    const { appHost } = await boot('#/@present', { followCode: 'ABCDEFGH' }, '/present/f/ABCDEFGH');
    expect(appHost.getSnapshot().activeId).toBe('study');
    expect(h.bootStudy).toHaveBeenCalledTimes(1);
  });

  it('a control link adopts the Presenter without Study', async () => {
    const adoptedSession = { sessionId: 's1', token: 't' };
    const { appHost } = await boot('', { adoptedSession });
    expect(appHost.getSnapshot().activeId).toBe('present');
    expect(window.location.hash).toBe('#/@present');
    noStudyInits();
    expect(h.ensurePresenterRuntime).toHaveBeenCalledWith(adoptedSession);
  });

  it('renders nothing when the shell boot stops (update in flight)', async () => {
    window.history.replaceState(null, '', '/#/@present');
    h.bootShell.mockResolvedValue(null);
    const { runBoot } = await import('../runBoot');
    const render = vi.fn();
    await runBoot({ render });
    expect(render).not.toHaveBeenCalled();
    noStudyInits();
  });

  // These two run last: a Presenter left active in the jsdom URL makes the next test's URL reset
  // fire the previous graph's popstate handlers.
  it('restores Study instead when the saved session is gone or expired', async () => {
    localStorage.setItem('app-host', JSON.stringify({ v: 1, activeId: 'present', routes: {} }));
    h.hasStored.mockReturnValue(false);
    const { appHost } = await boot('');
    expect(appHost.getSnapshot().activeId).toBe('study');
    expect(h.bootStudy).toHaveBeenCalledTimes(1);
  });

  it('restores the persisted Presenter when no hash and a live session is saved', async () => {
    localStorage.setItem('app-host', JSON.stringify({ v: 1, activeId: 'present', routes: {} }));
    h.hasStored.mockReturnValue(true);
    const { appHost } = await boot('');
    expect(appHost.getSnapshot().activeId).toBe('present');
    expect(window.location.hash).toBe('#/@present');
    noStudyInits();
  });
});
