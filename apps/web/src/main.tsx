import { render } from 'preact';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { createServerProviders } from './providers/ServerDataProvider';
import { BrowserSearchProvider } from './search/BrowserSearchProvider';
import { BibleWorkerProxy } from './offline/BibleWorkerProxy';
import { createOfflineBibleProvider, offlineStorageManager } from './offline/sharedInstances';
import { initAutoDownload, runAutoCleanup } from './offline/autoDownloadManager';
import { bibleStore } from './stores/bibleStore';
import { commentaryStore } from './stores/commentaryStore';
import { studyStore } from './stores/studyStore';
import { searchStore } from './stores/searchStore';
import { dictionaryStore } from './stores/dictionaryStore';
import { moduleStore } from './stores/moduleStore';
import { settingsStore } from './stores/settingsStore';
import { eventBus } from './events/eventBus';
import { API_BASE } from './utils/apiUrl';
import { isBootLoopTripped, navigateToLoginOnce, showBootError } from './utils/bootGuard';
import { bootFetch, releaseBootPrefetch } from './utils/bootPrefetch';
import { isTagGraphEnabled, setClientConfig } from './utils/clientConfig';
import { applyUpdateIfStale, PWA_BUILD_ENABLED, registerServiceWorker, unregisterServiceWorkers } from './utils/appUpdate';
import { clientPluginManager } from './plugins/pluginManager';
// Font Awesome is self-hosted (bundled by Vite) rather than loaded from a CDN: browser
// tracking prevention blocks third-party storage for cdnjs, and a CDN dependency breaks
// icons for offline/PWA use. Only the core + solid + regular styles are imported; the
// brands font is unused and would otherwise be precached by the service worker.
import '@fortawesome/fontawesome-free/css/fontawesome.min.css';
import '@fortawesome/fontawesome-free/css/solid.min.css';
import '@fortawesome/fontawesome-free/css/regular.min.css';
import './styles/main.scss';

/**
 * Cap how long the boot splash can wait on one request. The chapter fetch is
 * awaited before the first paint now, so a hung socket would otherwise leave
 * the user staring at the spinner indefinitely. navigateTo swallows its own
 * errors and sets tab.loadError, so rendering early is always safe.
 */
function withBootTimeout(p: Promise<void>, ms = 8000): Promise<unknown> {
  return Promise.race([p, new Promise<void>(resolve => setTimeout(resolve, ms))]);
}

async function init() {
  const baseUrl = API_BASE;

  // Quick auth + config + build check — run in parallel for faster startup.
  // If the server is unreachable, continue in offline mode.
  let serverOnline = true;
  let serverStaleDays: number | undefined;
  let pwaEnabled = true;
  // Cache a lite copy of each translation the reader opens. The server can turn
  // this off for a deployment that would rather not push several MB per
  // translation to every visitor.
  let offlineAutoDownload = true;
  // Where semantic search runs. Server advertises this via /api/config; default to
  // 'browser' so the app works even if the server declares nothing (lean-server default).
  let semanticMode: 'server' | 'browser' | 'off' = 'browser';

  const healthPromise = bootFetch(`${baseUrl}/api/health`)
    .then(async (res) => {
      const body = await res.text();
      if (res.status === 401 || res.status === 403 ||
          (body.includes('<form') && body.includes('login'))) {
        // Report it; do not act on it here. Reloading in place was the old
        // behaviour and it is what looped — the service worker answered the
        // reload from cache, so the login page was never reachable and the same
        // 401 came back every time.
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

  // `no-store` so this one answer can never come from a cache — it is the check
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
    return;
  }

  // Publish it before anything reads it, so no other module has to ask the
  // server for the same answer. See utils/clientConfig.ts.
  setClientConfig(cfg);

  if (cfg) {
    if (typeof cfg.staleDays === 'number') serverStaleDays = cfg.staleDays;
    if (cfg.commentaryPopularity) moduleStore.setServerPopularity(cfg.commentaryPopularity);
    if (cfg.ui) settingsStore.applyServerUiConfig(cfg.ui);
    if (cfg.pwaEnabled === false) pwaEnabled = false;
    if (cfg.offlineDownloads) settingsStore.setServerOfflineDownloads(true);
    if (cfg.offlineAutoDownload === false) offlineAutoDownload = false;
    if (cfg.search?.semantic) semanticMode = cfg.search.semantic;
  }

  // Service worker first, so a browser running a stale build starts pulling the
  // new worker before any of the app's own code has a chance to misbehave.
  //
  // PWA_BUILD_ENABLED is the master switch (ENABLE_PWA at build time); the server
  // flag can only turn a PWA build off, never turn a plain build on — there is no
  // sw.js to register in that case, only the self-destroying stub.
  if (PWA_BUILD_ENABLED && pwaEnabled) registerServiceWorker();
  else await unregisterServiceWorkers();

  // Update check before render: if this bundle is not the build the server is
  // serving, replace it now rather than letting a stale client talk to a newer
  // API. Skipped when offline — there is nothing to compare against.
  if (serverOnline && await applyUpdateIfStale(versionInfo?.buildId)) return;

  const providers = createServerProviders(baseUrl);

  // Initialize stores with providers
  moduleStore.init(providers.modules);

  // Wrap the Bible provider with offline-first support (OPFS → server fallback).
  // The factory also eagerly opens all downloaded module DBs in the background
  // so the first Bible request after launch can be served locally.
  const workerProxy = new BibleWorkerProxy();
  const offlineBible = createOfflineBibleProvider(providers.bible, workerProxy);
  bibleStore.init(offlineBible);

  // Initialize auto-download manager (fire-and-forget lite downloads on translation use).
  // Left uninitialized when the server turns it off — triggerAutoDownload and
  // runAutoCleanup both no-op without a manager, so that is the whole switch.
  if (offlineAutoDownload) initAutoDownload(offlineStorageManager, serverStaleDays);
  commentaryStore.init(providers.commentary, providers.studyOverview);
  studyStore.init({
    crossRef: providers.crossRef,
    topical: providers.topical,
    // Omitted entirely when the deployment has the tag graph turned off: the
    // store treats an absent provider as "no entities", which is the same
    // answer it would spend a round trip per verse selection to be told.
    tagGraph: isTagGraphEnabled() ? providers.tagGraph : undefined,
    interlinear: providers.interlinear,
    studyOverview: providers.studyOverview,
  });
  dictionaryStore.init(baseUrl);

  // Semantic search provider selection:
  //  - Server declares 'browser' mode  → always run search locally (server does no heavy lifting).
  //  - Server declares 'server'/'off'  → honor the per-user opt-in (defaults to the server pipeline).
  const browserSearchEnabled = semanticMode === 'browser' || settingsStore.browserSemanticSearch;
  if (browserSearchEnabled) {
    const browserSearch = new BrowserSearchProvider(
      baseUrl,
      `${baseUrl}/data/semantic_128d_int8.bin`,
      `${baseUrl}/data/semantic_128d_int8.meta.json`,
      offlineBible, // resolve verse text offline-first from the active version's cached module
      () => bibleStore.getActiveTab()?.moduleAbbr || 'KJV',
      `${baseUrl}/data/models`, // self-hosted model (offline; no HuggingFace CDN)
      `${baseUrl}/ort/`,        // self-hosted ONNX Runtime wasm (CSP blocks the jsDelivr default)
    );
    searchStore.init(browserSearch);
  } else {
    searchStore.init(providers.search);
  }
  settingsStore.applyTheme();

  // Load module manifest — in offline mode this may fail, but the app can
  // still render with locally-cached Bible data from OPFS.
  try {
    await moduleStore.loadManifest();
  } catch (err) {
    if (serverOnline) throw err; // unexpected failure when server is up
    console.warn('[PWA] Module manifest unavailable offline — using cached data');
  }

  // Initialize client-side plugins (non-blocking — failure doesn't prevent app launch)
  clientPluginManager.discover()
    .then(() => clientPluginManager.activate())
    .catch(err => console.warn('[Plugins] Client plugin initialization failed:', err));

  // Resolve the active tab BEFORE the first paint. This used to run after
  // render(), so a returning user saw the home screen (showHome defaults to
  // true and restoreSession never clears it) painted and then swapped for the
  // Bible pane — the jerk on first load. Everything awaited here is what the
  // first frame actually depends on; background tabs and cleanup stay after.
  //
  // If the active tab already has cached verses from the session, render them
  // immediately without re-fetching — this makes repeat visits near-instant.
  const restoredTab = bibleStore.getActiveTab();
  if (window.location.hash) {
    await withBootTimeout(bibleStore.navigateFromHash(window.location.hash));
  } else if (restoredTab && restoredTab.verses.length > 0) {
    // Session had cached verses — render immediately, no fetch needed
    bibleStore.setShowHome(false);
    bibleStore.updateHash();
    // Restored tabs carry no study verse, and this path skips navigateTo — so
    // establish one before the panes below bind to it.
    bibleStore.ensureStudyVerse();
    // Sync commentary pane to the restored chapter
    if (restoredTab.book && restoredTab.chapter) {
      eventBus.emit('commentary:load-chapter', { book: restoredTab.book, chapter: restoredTab.chapter });
    }
  } else if (restoredTab && !restoredTab.book) {
    await withBootTimeout(bibleStore.navigateTo(1, 1)); // Genesis 1
  } else if (restoredTab && restoredTab.book && restoredTab.chapter) {
    // Has book/chapter but no cached verses — fetch them
    await withBootTimeout(bibleStore.navigateTo(restoredTab.book, restoredTab.chapter));
  }

  // Render the app (ErrorBoundary catches component crashes)
  render(<ErrorBoundary><App providers={providers} /></ErrorBoundary>, document.getElementById('app')!);

  // Everything the first frame depends on is settled. Drop the boot splash once
  // the browser has actually painted that frame, so the app never appears
  // half-built. hideAppLoading is defined by the inline script in index.html.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    (window as unknown as { hideAppLoading?: () => void }).hideAppLoading?.();
  }));

  // Always load any restored tabs that don't have verses yet (e.g. background tabs)
  bibleStore.loadRestoredTabs();

  // Boot is over; anything index.html prefetched and nobody claimed is now just
  // a response held open for a navigation that may never come.
  releaseBootPrefetch();

  // Clean up stale auto-downloaded modules (fire-and-forget)
  runAutoCleanup().catch(() => {});
}

// index.html's boot-loop detector has already stopped this page and shown the
// recovery UI — booting again would just feed the loop it caught.
if (isBootLoopTripped()) {
  console.warn('[Boot] Boot-loop detected — app start suppressed');
} else {
  start();
}

function start(): void {
  init().catch(err => {
    console.error('[PWA] Bootstrap failed:', err);
    // Show the error fallback UI defined in index.html
    const message = err instanceof TypeError && err.message.includes('fetch')
      ? 'Unable to connect to the server. Check your network connection and try again.'
      : (err?.message || 'Something went wrong while starting the app.');
    showBootError(message);
  });
}
