/// <reference lib="webworker" />
/**
 * Keep Thy Heart service worker (built by `vite-plugin-pwa` in `injectManifest` mode).
 *
 * One rule drives the design: **a navigation request is answered from the network
 * whenever the network answers at all** — including when it answers 401 with the
 * login page. The precached shell is a fallback for *network failure only*, which
 * is all offline support ever required.
 *
 * The previous config used `navigateFallback: 'index.html'`, which answers every
 * navigation from the precache without consulting the network. That made the login
 * page unreachable: the cached shell booted, got 401 from /api/health, reloaded,
 * and the reload was answered from cache again — forever. Hand-writing the worker
 * is what makes `request.mode === 'navigate'` matching possible; the generated
 * worker can only match on URL patterns.
 */
import { clientsClaim } from 'workbox-core';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { RangeRequestsPlugin } from 'workbox-range-requests';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

/**
 * Activate immediately rather than waiting for every tab to close.
 *
 * This is not an update-speed nicety. A browser stuck in a boot loop never
 * reaches its own service-worker registration code — the reload fires first — so
 * it can never ask a waiting worker to activate. Self-activation is the only path
 * by which an already-wedged client picks up a fix. The browser re-checks
 * sw.js on every navigation, and a looping client generates plenty of those.
 */
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── Navigation: network-first, cached shell only on network failure ──────────

/** How long to wait for the network before falling back to the offline shell. */
const NAVIGATION_TIMEOUT_MS = 3000;

/** Precache key for the app shell. Resolved against the worker's own URL so it
 *  stays correct under a non-root BASE_PATH. */
const SHELL_URL = new URL('index.html', self.location.href).href;

/**
 * Reject after `ms` so a reachable-but-dead server (captive portal, LAN box down,
 * half-open TCP) falls back to the cached shell instead of hanging the boot until
 * the browser's own multi-minute timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Network timeout')), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function handleNavigation({ request }: { request: Request }): Promise<Response> {
  try {
    // Whatever the server says is the answer — a 200 shell, a 401 login page, a
    // 503. Only a transport failure is grounds for reaching into the cache.
    return await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
  } catch {
    const shell = await matchPrecache(SHELL_URL);
    if (shell) return shell;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>'
      + '<p style="font-family:system-ui,sans-serif;padding:2rem">Keep Thy Heart is offline '
      + 'and no cached copy is available on this device.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

registerRoute(new NavigationRoute(handleNavigation, {
  // Never answer /api/ or /data/ with the app shell: a JSON or binary consumer
  // that receives HTML fails in confusing ways (JSON.parse on "<!doctype html>").
  // Matched per path segment so a non-root BASE_PATH is still covered. A denylist
  // hit skips this route entirely and the request goes straight to the network,
  // so over-matching here is the safe direction.
  denylist: [/(^|\/)api\//, /(^|\/)data\//],
}));

// ── Runtime caching ─────────────────────────────────────────────────────────

// Self-hosted embedding model for browser-side semantic search. Large, immutable
// files — cache aggressively so the ~130 MB model downloads once, then works offline.
registerRoute(
  /\/data\/models\/.*/i,
  new CacheFirst({
    cacheName: 'embedding-model',
    plugins: [
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new RangeRequestsPlugin(),
    ],
  }),
  'GET',
);

// Semantic search index (int8 vectors + metadata) served from /data.
registerRoute(
  /\/data\/semantic_[^/]+$/i,
  new CacheFirst({
    cacheName: 'semantic-index',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  'GET',
);

// Commentary text and study overview are not user-specific — safe to cache.
// `statuses: [200]` keeps a 401 login page from ever being stored as content.
registerRoute(
  /\/api\/commentary\/[^/]+\/\d+\/\d+$/,
  new CacheFirst({
    cacheName: 'commentary-text',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }),
      new CacheableResponsePlugin({ statuses: [200] }),
    ],
  }),
  'GET',
);

registerRoute(
  /\/api\/study\/overview\/\d+\/\d+$/,
  new CacheFirst({
    cacheName: 'study-overview',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 }),
      new CacheableResponsePlugin({ statuses: [200] }),
    ],
  }),
  'GET',
);

// Other /api/ responses are deliberately not cached — they are auth-gated and
// user-specific, and caching them masks 401s after logout.

// ── Messages ────────────────────────────────────────────────────────────────

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  // Kept for compatibility with workbox-window's update flow. This worker already
  // skips waiting on install, so it is normally a no-op.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
