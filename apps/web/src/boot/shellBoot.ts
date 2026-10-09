import { createServerProviders } from '../providers/ServerDataProvider';
import { moduleStore } from '../stores/moduleStore';
import { settingsStore } from '../stores/settingsStore';
import { API_BASE } from '../utils/apiUrl';
import { navigateToLoginOnce, showBootError } from '../utils/bootGuard';
import { bootFetch } from '../utils/bootPrefetch';
import { pwaFlag, pwaUpdateMode, setClientConfig } from '../utils/clientConfig';
import { applyUpdateIfStale, registerServiceWorker, unregisterServiceWorkers } from '../utils/appUpdate';
import i18n, { ensureLocaleLoaded } from '../i18n';
import { installBidiCopy } from '../utils/bidiCopy';
import { getOfflineBible } from './offlineBible';
import type { ShellContext } from './shellContext';

/**
 * The app-independent half of boot: locale, health/config/version,
 * service worker, update check, providers, module manifest, theme, reminders.
 * Resolves to null when boot must stop and render nothing (unauthorized, or the
 * page is being replaced by a fresh build). No app-specific store is touched.
 */
export async function bootShell(): Promise<ShellContext | null> {
  const baseUrl = API_BASE;

  // Kicked off now, awaited just before the first render: `en`'s catalogs are
  // bundled eagerly (see `i18n.ts`), so this resolves instantly unless
  // detection landed on a lazily-loaded locale.
  const localeReady = ensureLocaleLoaded(i18n.language);
  installBidiCopy();

  // Quick auth + config + build check -- in parallel. If the server is
  // unreachable, continue in offline mode.
  let serverOnline = true;
  let serverStaleDays: number | undefined;
  // Cache a lite copy of each translation the reader opens. The server can turn
  // this off for a deployment that would rather not push several MB per
  // translation to every visitor.
  let offlineAutoDownload = true;
  // Where semantic search runs. Server advertises this via /api/config; default
  // to 'browser' so the app works even if the server declares nothing.
  let semanticMode: 'server' | 'browser' | 'off' = 'browser';

  const healthPromise = bootFetch(`${baseUrl}/api/health`)
    .then(async (res) => {
      const body = await res.text();
      if (res.status === 401 || res.status === 403 ||
          (body.includes('<form') && body.includes('login'))) {
        // Report it; do not act on it here. Reloading in place was the old
        // behaviour and it is what looped -- the service worker answered the
        // reload from cache, so the login page was never reachable.
        return 'unauthorized' as const;
      }
      return 'ok' as const;
    })
    .catch(() => {
      serverOnline = false;
      console.log('[PWA] Server unreachable — starting in offline mode');
      return 'offline' as const;
    });

  const configPromise = bootFetch(`${baseUrl}/api/config`)
    .then(async (res) => (res.ok ? res.json() : null))
    .catch(() => null);

  // `no-store` so this one answer can never come from a cache -- it is the check
  // that decides whether everything else in this bundle is stale.
  const versionPromise = bootFetch(`${baseUrl}/api/version`, { cache: 'no-store' })
    .then(async (res) => (res.ok ? res.json() : null))
    .catch(() => null);

  const [healthResult, cfg, versionInfo] = await Promise.all([
    healthPromise,
    configPromise,
    versionPromise,
  ]);

  if (healthResult === 'unauthorized') {
    // One automatic attempt to reach the login page; if that allowance is spent,
    // hand control to the user rather than trying again.
    if (!navigateToLoginOnce()) {
      showBootError('Your session has expired. Reload to sign in again.');
    }
    return null;
  }

  // Publish it before anything reads it. See utils/clientConfig.ts.
  setClientConfig(cfg);

  if (cfg) {
    if (typeof cfg.staleDays === 'number') serverStaleDays = cfg.staleDays;
    if (cfg.commentaryPopularity) moduleStore.setServerPopularity(cfg.commentaryPopularity);
    if (cfg.ui) settingsStore.applyServerUiConfig(cfg.ui);
    if (cfg.offlineDownloads) settingsStore.setServerOfflineDownloads(true);
    if (cfg.offlineAutoDownload === false) offlineAutoDownload = false;
    if (cfg.search?.semantic) semanticMode = cfg.search.semantic;
  }

  // Service worker first, so a browser running a stale build starts pulling the
  // new worker before any of the app's own code has a chance to misbehave.
  //
  // `features.pwa` decides: on registers the worker, off tears down any worker an
  // earlier visit installed. When the server did not answer (offline boot) the
  // flag is unknown and nothing is touched: unregistering now would remove the
  // worker that is the reason this page could boot offline at all.
  const pwa = pwaFlag();
  if (pwa === true) registerServiceWorker({ updateMode: pwaUpdateMode() });
  else if (pwa === false) await unregisterServiceWorkers();

  // Update check before anything lazy is requested: a stale bundle's chunk URLs
  // may 404 after a deploy. Skipped when offline -- nothing to compare against.
  if (serverOnline && await applyUpdateIfStale(versionInfo?.buildId)) return null;

  const providers = createServerProviders(baseUrl);
  moduleStore.init(providers.modules);

  const ctx: ShellContext = {
    baseUrl,
    providers,
    serverOnline,
    serverStaleDays,
    offlineAutoDownload,
    semanticMode,
    localeReady,
  };

  settingsStore.applyTheme();

  // Reminders (tier 1: notifications while a tab is open). The code loads lazily
  // and only where the browser can show notifications. The verse-of-the-day
  // provider is resolved at fire time only.
  if (typeof window !== 'undefined' && 'Notification' in window) {
    void import('../notifications/webReminders')
      .then(m => {
        m.setVerseOfTheDayFetcher(async () => (await getOfflineBible(ctx)).getVerseOfTheDay());
        return m.startWebReminders();
      })
      .catch(err => console.warn('[Notifications] Reminders failed to start:', err));
  }

  // Load module manifest -- in offline mode this may fail, but the app can
  // still render with locally-cached Bible data from OPFS.
  try {
    await moduleStore.loadManifest();
  } catch (err) {
    if (serverOnline) throw err; // unexpected failure when server is up
    console.warn('[PWA] Module manifest unavailable offline — using cached data');
  }

  return ctx;
}
