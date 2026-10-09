import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  health: { status: 200, body: 'ok' } as { status: number; body: string } | 'offline',
  stale: false,
  loadManifest: vi.fn(async () => {}),
  navigateToLoginOnce: vi.fn(() => true),
  showBootError: vi.fn(),
  createServerProviders: vi.fn((base: string) => ({ base, bible: {}, search: {}, modules: {} })),
  applyTheme: vi.fn(),
  bibleInit: vi.fn(),
  urls: [] as string[],
}));

vi.mock('../../utils/bootPrefetch', () => ({
  bootFetch: vi.fn(async (url: string) => {
    h.urls.push(url);
    if (url.endsWith('/api/health')) {
      const health = h.health;
      if (health === 'offline') throw new TypeError('fetch failed');
      return { status: health.status, ok: true, text: async () => health.body };
    }
    if (h.health === 'offline') throw new TypeError('fetch failed');
    if (url.endsWith('/api/config')) {
      return { ok: true, json: async () => ({ staleDays: 7, offlineAutoDownload: false, search: { semantic: 'server' } }) };
    }
    return { ok: true, json: async () => ({ buildId: 'abc' }) };
  }),
  releaseBootPrefetch: vi.fn(),
}));
vi.mock('../../utils/bootGuard', () => ({
  navigateToLoginOnce: h.navigateToLoginOnce,
  showBootError: h.showBootError,
}));
vi.mock('../../utils/appUpdate', () => ({
  applyUpdateIfStale: vi.fn(async () => h.stale),
  registerServiceWorker: vi.fn(),
  unregisterServiceWorkers: vi.fn(async () => {}),
}));
vi.mock('../../utils/clientConfig', () => ({
  setClientConfig: vi.fn(),
  pwaFlag: () => undefined,
  pwaUpdateMode: () => 'prompt',
}));
vi.mock('../../utils/bidiCopy', () => ({ installBidiCopy: vi.fn() }));
vi.mock('../../i18n', () => ({
  default: { language: 'en' },
  ensureLocaleLoaded: vi.fn(async () => {}),
}));
vi.mock('../../providers/ServerDataProvider', () => ({ createServerProviders: h.createServerProviders }));
vi.mock('../../stores/moduleStore', () => ({
  moduleStore: { init: vi.fn(), setServerPopularity: vi.fn(), loadManifest: h.loadManifest },
}));
vi.mock('../../stores/settingsStore', () => ({
  settingsStore: {
    applyServerUiConfig: vi.fn(),
    setServerOfflineDownloads: vi.fn(),
    applyTheme: h.applyTheme,
    browserSemanticSearch: false,
  },
}));
vi.mock('../../stores/bibleStore', () => ({ bibleStore: { init: h.bibleInit } }));
vi.mock('../../host/preferredBible', () => ({ preferredBible: { module: 'KJV', setSource: vi.fn() } }));

import { bootShell } from '../shellBoot';

describe('bootShell (shell-only path)', () => {
  beforeEach(() => {
    h.health = { status: 200, body: 'ok' };
    h.stale = false;
    h.urls.length = 0;
    vi.clearAllMocks();
    h.loadManifest.mockResolvedValue(undefined);
    h.navigateToLoginOnce.mockReturnValue(true);
  });

  it('boots the shell without touching any Study store or the Bible API', async () => {
    const ctx = await bootShell();
    expect(ctx).not.toBeNull();
    expect(ctx!.serverOnline).toBe(true);
    expect(ctx!.serverStaleDays).toBe(7);
    expect(ctx!.offlineAutoDownload).toBe(false);
    expect(ctx!.semanticMode).toBe('server');
    expect(h.createServerProviders).toHaveBeenCalledTimes(1);
    expect(h.loadManifest).toHaveBeenCalledTimes(1);
    expect(h.applyTheme).toHaveBeenCalled();
    expect(h.bibleInit).not.toHaveBeenCalled();
    expect(h.urls.some(u => u.includes('/api/bible/'))).toBe(false);
    await expect(ctx!.localeReady).resolves.toBeUndefined();
  });

  it('leaves handoff links and the verse search provider to the Presenter module', async () => {
    // The links are read by the module's boot probe (binding.test.ts), not by the shell.
    const ctx = await bootShell();
    expect(ctx).not.toHaveProperty('adoptedSession');
    expect(ctx).not.toHaveProperty('followCode');
  });

  it('returns null and goes to login when unauthorized', async () => {
    h.health = { status: 401, body: '' };
    expect(await bootShell()).toBeNull();
    expect(h.navigateToLoginOnce).toHaveBeenCalled();
    expect(h.createServerProviders).not.toHaveBeenCalled();
  });

  it('shows an error when unauthorized and login was already tried', async () => {
    h.health = { status: 403, body: '' };
    h.navigateToLoginOnce.mockReturnValue(false);
    expect(await bootShell()).toBeNull();
    expect(h.showBootError).toHaveBeenCalled();
  });

  it('returns null before creating providers when the bundle is stale', async () => {
    h.stale = true;
    expect(await bootShell()).toBeNull();
    expect(h.createServerProviders).not.toHaveBeenCalled();
  });

  it('boots offline: skips the update check and tolerates a missing manifest', async () => {
    h.health = 'offline';
    h.stale = true; // would return null if the check ran
    h.loadManifest.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = await bootShell();
    expect(ctx).not.toBeNull();
    expect(ctx!.serverOnline).toBe(false);
    warn.mockRestore();
  });

  it('rethrows a manifest failure while the server is up', async () => {
    h.loadManifest.mockRejectedValue(new Error('boom'));
    await expect(bootShell()).rejects.toThrow('boom');
  });
});
