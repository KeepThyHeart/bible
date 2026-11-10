/// <reference lib="webworker" />
/**
 * Keep Thy Heart service worker (built by `vite-plugin-pwa` in `injectManifest` mode).
 *
 * What it caches at run time is declared in `src/sw/rules/`, not here. The server
 * chooses whether this worker or `sw-kill.js` is served at `/sw.js`
 * (`features.pwa`).
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
import { clientsClaim, cacheNames } from 'workbox-core';
import type { WorkboxPlugin } from 'workbox-core';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { RangeRequestsPlugin } from 'workbox-range-requests';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import {
  cacheNamesFor,
  cacheRuleFor,
  EXTERNAL_CACHES,
  resolveCacheName,
  validateRules,
  type CacheRule,
} from './sw/cacheRules';
import { CACHE_RULES } from './sw/rules';

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

// The build replaces this token, and it must appear exactly once in the worker.
const PRECACHE_MANIFEST = self.__WB_MANIFEST;

// ── Install: fetch the precache in parallel, not one file at a time ──────────
//
// Workbox's precache install fetches its entries strictly one after another
// (workbox-precaching 7, PrecacheController.install), one round trip each. A
// first install is ~300 of them back to back: about 14 s on a fast connection
// and close to a minute on a phone. A deploy re-downloads every chunk whose
// hash changed, which is usually most of them. The new worker cannot take
// control until it finishes, and the first launch after a deploy pays for it.
//
// Hashed entries (no `revision`) are fetched by Workbox with the default HTTP
// cache mode, and the server marks /assets/ immutable, so fetching them here
// first, a few at a time, means Workbox's sequential pass is answered from the
// HTTP cache. Workbox still does the actual precaching, so its integrity and
// failure handling are unchanged; if the HTTP cache is unavailable this costs
// one duplicate download per file and nothing breaks.
//
// Registered before precacheAndRoute so its fetches start first. Kept to a few
// at a time: over HTTP/1.1 the browser allows six connections per host, and the
// page loading at the same moment needs some of them.
const WARM_CONCURRENCY = 4;

self.addEventListener('install', (event: ExtendableEvent) => {
  const urls = PRECACHE_MANIFEST
    .filter(entry => typeof entry !== 'string' && entry.revision === null)
    .map(entry => new URL((entry as { url: string }).url, self.location.href).href);
  event.waitUntil(warmHttpCache(urls, WARM_CONCURRENCY));
});

/**
 * Fetch `urls` with at most `concurrency` in flight, skipping any the precache
 * already holds (Workbox skips those too, so after a deploy only the chunks that
 * changed are downloaded). Never rejects.
 */
async function warmHttpCache(urls: string[], concurrency: number): Promise<void> {
  let precache: Cache | undefined;
  try {
    precache = await caches.open(cacheNames.precache);
  } catch {
    // No Cache Storage: warm everything.
  }
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        if (precache && await precache.match(url)) continue;
        // Body read to the end: an unread body may not be written to the cache.
        const res = await fetch(url, { credentials: 'same-origin' });
        await res.arrayBuffer();
      } catch {
        // Workbox fetches it again and reports a real failure itself.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
}

precacheAndRoute(PRECACHE_MANIFEST);
cleanupOutdatedCaches();

// ── Navigation: network-first, cached shell only on network failure ──────────

/** How long to wait for the network before falling back to the offline shell. */
const NAVIGATION_TIMEOUT_MS = 3000;

/** Precache key for the app shell. Resolved against the worker's own URL so it
 *  stays correct under a non-root BASE_PATH. */
const SHELL_URL = new URL('index.html', self.location.href).href;

/**
 * The Presenter's viewer pages are separate HTML entries (see `present/*.html`
 * and the `input` map in vite.config.ts); the `html` glob in `injectManifest`
 * precaches them as `present/viewer.html` and `present/solo.html`. Offline, the
 * pre-live preview iframe (`/present/v/<code>`) and `/present/solo` and `/watch` must get
 * those, not the reading app's shell.
 */
const VIEWER_URL = new URL('present/viewer.html', self.location.href).href;
const SOLO_URL = new URL('present/solo.html', self.location.href).href;
const WATCH_URL = new URL('present/watch.html', self.location.href).href;
/** The Games phone page (`games/play.html`), likewise a separate entry. */
const GAMES_PLAY_URL = new URL('games/play.html', self.location.href).href;

/** The precache key of the page a navigation to `pathname` should get offline, else the app shell. */
export function offlinePageFor(pathname: string): string {
  if (/(^|\/)present\/v\/[^/]+\/?$/.test(pathname)) return VIEWER_URL;
  if (/(^|\/)present\/solo\/?$/.test(pathname)) return SOLO_URL;
  if (/(^|\/)watch\/?$/.test(pathname)) return WATCH_URL;
  if (/(^|\/)games\/(play|screen|solo)(\/.*)?$/.test(pathname)) return GAMES_PLAY_URL;
  return SHELL_URL;
}

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
    const page = await matchPrecache(offlinePageFor(new URL(request.url).pathname));
    if (page) return page;
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

// ── Runtime caching: driven entirely by the rule registry ───────────────────
//
// Features add rules under src/sw/rules/; nothing below changes when they do.
// See docs/features/service-worker-cache-rules.md.

const ruleProblems = validateRules(CACHE_RULES);
if (ruleProblems.length > 0) {
  // A malformed rule must not take the worker down (a dead worker is a stuck
  // client), so this only logs. The unit test on the registry is what keeps a
  // bad rule from ever shipping.
  console.error('[SW] Invalid cache rules:\n' + ruleProblems.join('\n'));
}

function strategyFor(rule: CacheRule): CacheFirst {
  const plugins: WorkboxPlugin[] = [
    new CacheableResponsePlugin({ statuses: rule.statuses ?? [200] }),
  ];
  if (rule.maxEntries || rule.maxAgeSeconds) {
    plugins.push(new ExpirationPlugin({
      maxEntries: rule.maxEntries,
      maxAgeSeconds: rule.maxAgeSeconds,
    }));
  }
  if (rule.strategy === 'cache-first-range') plugins.push(new RangeRequestsPlugin());
  return new CacheFirst({ cacheName: resolveCacheName(rule), plugins });
}

const strategies = new Map<string, CacheFirst>();
for (const rule of CACHE_RULES) {
  if (rule.strategy !== 'network-only') strategies.set(rule.id, strategyFor(rule));
}

// One route for every rule: `cacheRuleFor` is the single decision point, so the
// safety rules (never /api/sync, API only when a rule opts in) cannot be
// bypassed by registration order or by a second registerRoute somewhere.
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && cacheRuleFor(CACHE_RULES, url) !== undefined,
  ({ url, request, event }) => {
    const rule = cacheRuleFor(CACHE_RULES, url)!;
    return strategies.get(rule.id)!.handle({ request, event });
  },
  'GET',
);

// Anything else, including every other /api/ response, is deliberately not
// handled: it goes to the network. API responses are auth-gated and
// user-specific, and caching them masks 401s after logout.

// ── Activation: drop every cache the current build no longer uses ────────────

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil((async () => {
    const keep = new Set<string>([
      ...cacheNamesFor(CACHE_RULES),
      ...EXTERNAL_CACHES,
      cacheNames.precache,
      cacheNames.runtime,
    ]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => !keep.has(n)).map(n => caches.delete(n)));
  })());
});

// ── Messages ────────────────────────────────────────────────────────────────

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  // Kept for compatibility with workbox-window's update flow. This worker already
  // skips waiting on install, so it is normally a no-op.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
