# PWA & Offline

**Last verified:** 6e80a84 (2026-09-04)

Progressive Web App support with service worker caching, installability, and offline Bible reading via OPFS module downloads.

## The PWA is switched by the server (`features.pwa`)

The client build **always** contains two workers, the real `sw.js` (built from `src/sw.ts`) and the kill switch `sw-kill.js` (`public/sw-kill.js`, copied verbatim). Which one a browser gets at `/sw.js`, and whether the manifest is advertised, is decided **at run time** by `server/middleware/serviceWorker.ts` from `features.pwa` in `site-config.json`. One build can be flipped between "installable app with offline shell" and "ordinary website" by editing the config and restarting; there is no build flag (`ENABLE_PWA` is gone).

| Site config | Effect |
|---|---|
| `features.pwa: true` | `/sw.js` is the real worker; manifest served and linked; the page registers the worker and shows the install prompt in supporting browsers |
| `features.pwa: false` (**default**) | `/sw.js` is the kill worker; `/manifest.webmanifest` is 404 and the `<link rel="manifest">` is stripped from the shell; the page unregisters any worker an earlier visit installed and deletes the app's caches |
| `features.pwaUpdate: "silent"` (default) or `"prompt"` | How a newer build reaches a page that stays open, see [Update flow](#update-flow) |
| `FEATURE_PWA=1` / `0` in the server environment | Overrides `features.pwa` (used by the e2e servers) |

The default is off because a service worker is the only thing in this stack that can answer a *navigation* from cache, and a stale app shell answering navigations is what wedges a client into a boot loop. Off removes the mechanism instead of guarding it. The guards (network-first navigation, the build-ID handshake, the boot-loop detector, the kill switch, "Reset app cache") make turning it on safe to try, and reversible from the server.

The client reads the flag through `pwaFlag()` in `src/utils/clientConfig.ts`, which is deliberately tri-state: `undefined` when the server did not answer (an offline boot). Unknown is **not** treated as off; unregistering the worker because the network is down would delete the very worker that let the page boot offline. (A later settings/feature-flag registry can replace that one accessor.)

**Still works with the PWA off:** offline Bible reading (OPFS module downloads + wa-sqlite never went through the worker), browser semantic search (`transformers-cache`), the HTTP cache headers below, and hashed-asset caching.

**Lost with the PWA off:** installability, standalone display, and loading the app shell with no network at all.

### Reaching browsers that already installed a worker

Browsers re-fetch the worker script on every navigation, bypassing the HTTP cache. So turning the flag off makes `/sw.js` answer with `sw-kill.js`: no `fetch` handler, deletes every cache except the large content ones (`transformers-cache` and the `keepOnReset` rule caches), then `registration.unregister()`. That is the one channel that reaches a client too wedged to run any app code. The server sends `Cache-Control: no-store` on `sw.js` and `sw-kill.js`. `unregisterServiceWorkers()` in `src/utils/appUpdate.ts` is the in-app half, for clients that boot normally. `/sw-kill.js` is always the kill worker, whatever the flag says.

### Reset app cache

Settings > About > **Reset app cache** (`resetAppCache()`): unregisters every worker, deletes Cache Storage entries (except `transformers-cache` and `keepOnReset` caches) and reloads. Shown unless the server answered `features.pwa: false`. It never touches OPFS downloads, settings or user data. If the PWA is still on, the reload boots a fresh worker. The older "Clear Cache & Reload" buttons on the boot-error screen and the error boundary remain as the last resort when the app does not render at all.

### Cache rules

Runtime caching is declared in `src/sw/rules/`, not in `sw.ts`. See [service-worker-cache-rules.md](service-worker-cache-rules.md) for adding a rule. API routes are never cached unless a rule opts in with `allowApi`, and `/api/sync` is never cached.

### Update flow

1. **New launch (always silent).** Before rendering, the client compares its build ID with `/api/version`; a mismatch pulls the new worker in and reloads once under a loop guard (see the handshake below).
2. **Page left open.** The browser re-checks `sw.js` on each navigation, and the page asks again whenever it returns to the foreground (at most hourly). The new worker `skipWaiting`s and claims the page (`controllerchange`):
   - `pwaUpdate: "silent"` (default): the page reloads itself once, guarded by `reloadForUpdateOnce()`.
   - `pwaUpdate: "prompt"`: `UpdateBanner` shows "A new version is ready" with **Reload** / dismiss. The running page keeps its old bundle until the user reloads, so lazy-loaded chunks of the old build can 404 in the meantime; that is why silent is the default.

## Files

### Configuration

| File | Description |
|---|---|
| `vite.config.ts` | `vite-plugin-pwa` config in **`injectManifest`** mode (always on, `injectRegister: false`); `__BUILD_ID__` define and the plugin emitting `build-id.json` |
| `public/sw-kill.js` | The kill-switch worker, copied verbatim into `dist/client/` and excluded from the precache |
| `server/middleware/serviceWorker.ts` | Picks the worker served at `/sw.js` from `features.pwa`; withholds the manifest and strips its `<link>` when off |
| `src/sw/` | The cache-rule registry, see [service-worker-cache-rules.md](service-worker-cache-rules.md) |
| `index.html` | PWA meta tags: theme-color, apple-touch-icon, viewport |
| `src/main.tsx` | Imports self-hosted Font Awesome CSS (core + solid + regular) so icons work offline and avoid third-party CDN/tracking-prevention issues |
| `public/icons/icon-192.svg` | App icon 192x192 (blue background, white serif "B") |
| `public/icons/icon-512.svg` | App icon 512x512 |
| `public/icons/icon-192.png`, `icon-512.png` | PNG fallbacks alongside the SVGs |

### Service Worker & Registration

| File | Description |
|---|---|
| `src/sw.ts` | **Hand-written service worker.** Network-first navigation (3s timeout → precached shell), `skipWaiting` + `clientsClaim`, and the runtime caches declared in `src/sw/rules/` |
| `src/utils/appUpdate.ts` | SW registration (plain `navigator.serviceWorker.register`), the update flow (silent or prompt), the build-ID staleness check, `unregisterServiceWorkers()` and `resetAppCache()` |
| `src/utils/bootGuard.ts` | sessionStorage-backed one-shot guards for every automatic navigation (login redirect, update reload) |
| `src/main.tsx` | Boot sequence: health + config + version in parallel → auth handling → SW registration → update check → render. Wires `OfflineBibleProvider`, auto-download, auto-cleanup |
| `src/vite-env.d.ts` | Type declarations for `__BUILD_ID__` and the two untyped `wa-sqlite` entry points |
| `dist/client/sw.js` | (Generated) Compiled from `src/sw.ts` with the precache manifest injected. Served only when `features.pwa` is on. |
| `dist/client/build-id.json` | (Generated) Build stamp; read by the server at startup and served from `/api/version` |
| `dist/client/manifest.webmanifest` | (Generated) Web app manifest; served only when `features.pwa` is on |

### Offline Storage

| File | Description |
|---|---|
| `src/stores/offlineStore.ts` | Offline state: enabled flag, online/offline detection, downloaded modules list, download progress, storage quota. Tracks `lastUsedAt` and `autoDownloaded` per module. `touchModule()` updates usage timestamp; `getStaleAutoModules()` finds auto-downloads unused for N days. Persisted to localStorage. |
| `src/providers/OfflineStorageManager.ts` | OPFS storage manager: download modules with progress tracking, download semantic index, **download lite modules** (no FTS5/interlinear), remove/read modules, storage quota reporting |
| `src/offline/sharedInstances.ts` | Shared singleton `OfflineStorageManager` instance (avoids circular imports) |

### Client-Side SQLite (Offline Bible Reads)

| File | Description |
|---|---|
| `src/offline/bibleWorker.ts` | Web Worker that runs **wa-sqlite** (`wa-sqlite-async.mjs` + `OriginPrivateFileSystemVFS`) against the `.db` files in OPFS — the file is queried in place, never loaded into memory. LRU cache of 3 open databases. Verses are formatted with core's `formatVerseFields` (from `@bible/core/browser`), the same code the server uses, so a verse looks the same offline. Not sql.js: the module declarations for both wa-sqlite entry points are in `src/vite-env.d.ts` |
| `src/offline/BibleWorkerProxy.ts` | Main-thread proxy for the Bible worker. Promise-based API: `openDb()`, `getChapter()`, `getVerse()`. Request ID correlation for concurrent queries. |
| `src/offline/OfflineBibleProvider.ts` | `IBibleDataProvider` impl that checks OPFS for locally downloaded modules first, falls back to server API. Transparently swaps in for the server provider. |
| `src/offline/autoDownloadManager.ts` | Auto-downloads lite Bible modules when user selects a translation. `triggerAutoDownload()` is fire-and-forget. `runAutoCleanup()` removes auto-downloaded modules unused for a configurable number of days (default 15, overridable via `offline.staleDays` in `site-config.json` — legacy `server-config.json` — which reaches the client through `/api/config`). |

### Error Recovery & Refresh

| File | Description |
|---|---|
| `index.html` | Loading spinner shown while JS boots; error fallback UI with Reload and Clear Cache buttons shown on bootstrap failure |
| `src/components/ErrorBoundary.tsx` | Preact error boundary: catches component render crashes and shows recovery UI (Try Again, Reload, Clear Cache) |
| `src/components/PullToRefresh.tsx` | Pull-to-refresh gesture component for mobile scroll wrappers |
| `src/MobileApp.tsx` | Integrates PullToRefresh on mobile scroll wrappers (portrait and landscape) |
| `src/components/Header.tsx` | Refresh button in header actions for desktop/mobile portrait |

### UI

| File | Description |
|---|---|
| `src/components/Dialogs/SettingsPanel.tsx` | Offline settings tab: enable toggle, storage info, module download cards with progress, semantic index download. Uses shared `offlineStorageManager` singleton. |
| `src/components/Header.tsx` | Shows "Offline" badge when offline and offline mode enabled |

### Server API

| File | Description |
|---|---|
| `server/routes/moduleRoutes.ts` | `GET /api/modules/:name/download` — streams full module DB files; `GET /api/modules/:name/download-lite` — streams stripped DB (no FTS5/interlinear, ~85% smaller); `GET /api/modules/:name/info` — module metadata and size |

## Manifest

- **Name**: Keep Thy Heart Bible Reader / **Short name**: Keep Thy Heart
- **Display**: standalone (full-screen app experience)
- **Theme**: #2563eb (blue) / **Background**: #ffffff
- **Icons**: SVG with `any maskable` purpose
- **Start URL**: `/`

## Cache headers without a service worker

This is what a **default (PWA off)** build relies on. All of it lives in `server/index.ts`.

| Resource | Header | Why |
|---|---|---|
| `index.html` (SPA shell) | `no-store` | It names the hashed asset files, so a stale copy pins the browser to a stale build |
| `build-id.json`, `/api/version` | `no-store` | The answers used to decide whether everything else is stale |
| `sw.js` | `no-store` | The self-destroying worker must never be served stale — it is the only channel to a wedged client |
| `dist/client/assets/*` | `public, max-age=31536000, immutable` | Vite content-hashes them, so a given URL's bytes can never change |
| `/data/*` | `max-age=7d` | Filename-versioned semantic index and model files |
| `/api/bible/:module/:book/:chapter` | `public, max-age=3600, stale-while-revalidate=604800` | Immutable text. An hour rather than the five minutes it used to allow, so paging back through a chapter read earlier in the same sitting does not re-fetch it |
| `/api/commentary/:module/:book/:chapter`<br>`/api/commentary/all/:book/:chapter`<br>`/api/commentary/home/:book/:chapter`<br>`/api/commentary/:module/verse/:verseId`<br>`/api/study/overview/:book/:chapter` | `private, max-age=3600, stale-while-revalidate=86400` | Keyed entirely by module + book + chapter, no user identity in the response, and the bulk of repeat traffic while reading |
| `/api/xref/:module/:verseId/{groups,count}`<br>`/api/topical/verse/:verseId`<br>`/api/taggraph/verse/:verseId` | `private, max-age=3600, stale-while-revalidate=86400` | The per-verse fallback taken whenever `data/cache/study-cache.db` is absent, which is the default. Left `no-store` these were re-fetched for every verse the reader clicked, including on the way back to one visited moments earlier |
| everything else under `/api` | `no-cache, no-store, must-revalidate` | Auth-gated and user-specific; a cached 200 outlives a logout |

The cacheable API header is applied at **write time**, not request time, so only a 2xx gets it. A missing module answers 404 on a valid-looking path, and pinning that for an hour would outlive the fix for whatever produced it. `private` keeps these out of shared proxies — the response still travelled through the password gate even though its body is not user-specific.

## Caching strategies (`features.pwa` on)

| Cache | URL Pattern | Strategy | TTL |
|---|---|---|---|
| Navigation | `request.mode === 'navigate'` | NetworkFirst, 3s timeout → precached `index.html` | n/a |
| Precache | `**/*.{js,css,html,svg,png,woff2}` | Precache (built-in) | Until new SW |
| `embedding-model-v1` | `/data/models/*` | CacheFirst | 1 year, 20 entries | Self-hosted ONNX model for browser search; downloaded once, then offline |
| `semantic-index-v1` | `/data/semantic_*` | CacheFirst | 1 year, 10 entries | Int8 vectors + metadata for browser search |
| `commentary-text-v1` | `/api/commentary/:mod-or-pseudo/:book/:chapter` | CacheFirst | 7 days, 200 entries |
| `chapter-metadata-v1` | `/api/interlinear/:book/:chapter` | CacheFirst | 7 days, 200 entries |
| `study-overview-v1` | `/api/study/overview/:book/:chapter` | CacheFirst | 7 days, 100 entries |

**The patterns live in `src/utils/swCachePatterns.ts`, not inline in `sw.ts`, so they can be tested.** Workbox matches a `RegExp` route against the whole URL (`url.href`), not against the path — so the trailing `$` these used to end with silently excluded every request carrying a query string, and the route simply never fired. That is every request that matters here: `/api/commentary/all/43/3?modules=…` (what a chapter change now makes), `/api/commentary/home/43/3?verse=16`, and `/api/interlinear/43/3?module=KJV`. Hence `(\?|$)`. The commentary pattern's `[^/?]+` segment deliberately covers the `all`, `chapter-overview` and `home` pseudo-modules as well as a real module abbreviation.

Other `/api/*` responses are deliberately **not** cached — they are auth-gated and user-specific, and caching them masks 401s after logout.

### Why navigation is network-first

**A navigation must never be answered from cache while the network is reachable.** The
server enforces auth on navigations, so an app shell served from cache makes the login
page unreachable — the cached shell boots, gets 401 from `/api/health`, and whatever it
does next (reload, redirect to `/`) is answered from cache again. That is an infinite
loop, and it is what `navigateFallback: 'index.html'` produced.

The precached shell is a fallback for **network failure only**, which is all offline
support ever needed. The 3-second timeout covers the reachable-but-dead server case
(captive portal, LAN box down) so boot does not hang until the browser's own timeout.

Matching on `request.mode` is why the worker is hand-written: `generateSW` can only route
on URL patterns.

## Update Handshake

Every build stamps an ID (`<git-sha>-<timestamp>`, overridable with `BUILD_ID=`) into two
places from the same build: the client bundle (`__BUILD_ID__`) and `dist/client/build-id.json`,
which the server reads at startup and serves from `/api/version`.

On boot, **before rendering**, the client compares the two. A mismatch means the code about
to run is stale, so it pulls the new worker into control and reloads once. There is no
`confirm()` prompt — a dismissed prompt used to leave a browser on an old build indefinitely,
which is how clients drifted far enough from the server to break.

Supporting pieces:

- `src/sw.ts` calls `skipWaiting()` + `clientsClaim()`. This is what lets an **already-broken**
  client recover: a browser stuck in a boot loop never reaches its own registration code, so
  it can never ask a waiting worker to activate. The browser re-checks `sw.js` on every
  navigation, and a looping client generates plenty of those.
- The server sends `Cache-Control: no-store` on `index.html` and `/api/version`, so the HTTP
  cache cannot become a second stale layer. Hashed assets stay cacheable.
- `features.pwa: false` also **unregisters** existing workers (`unregisterServiceWorkers()`)
  and makes `/sw.js` the kill worker, preserving the large content caches (see above).

The handshake still runs with the PWA off. It costs one `no-store` fetch, it is the only
thing that catches a tab left open across a deploy, and with no cached shell working against
it a reload always converges.

## Boot-Loop Detector

An inline script in `index.html` (runs before the app bundle) records boot timestamps in
`sessionStorage`. More than **5 boots in 20 seconds** trips it:

1. Sets `window.__bibleBootLoopTripped`, which `main.tsx` checks before starting the app.
2. Self-heals **once**: unregisters the service worker and deletes the shell caches,
   deliberately preserving `embedding-model` (~130 MB) and `semantic-index` — re-downloading
   those over a transient loop would be worse than the loop. OPFS modules are untouched.
3. Shows the recovery UI and hands control back to the user.

It lives in `sessionStorage` rather than memory on purpose: the failure it guards against is
driven by page *reloads*, and any in-memory counter is wiped on every iteration, so it could
never see the pattern.

Each site that can navigate on its own also carries a one-shot guard from
`src/utils/bootGuard.ts` (30s cooldown): the login redirect in `main.tsx` and
`ServerDataProvider`, and the update reload in `appUpdate.ts`. When a guard is spent the app
shows "Your session has expired" and waits for a click — a user-initiated navigation cannot loop.

## Offline Module Storage

Uses **Origin Private File System (OPFS)** for storing downloaded module databases:
- Bible modules stored at: `OPFS:/modules/{abbreviation}.db`
- Semantic index stored at: `OPFS:/semantic_browser.db`
- Downloads streamed with progress tracking via `ReadableStream`
- Persistent storage requested to prevent browser eviction

### Auto-Download Flow

When a user selects or navigates to a Bible translation:
1. `bibleStore` triggers `autoDownloadManager.triggerAutoDownload()` after a successful chapter load
2. Auto-download manager checks OPFS availability, skips if already downloaded or in progress
3. Downloads a **lite** copy of the module via `/api/modules/:name/download-lite` (~2.5MB vs ~17MB full)
4. Lite copy contains only `module_info`, `bible_verse`, and `schema_version` tables — no FTS5 indexes, no interlinear data
5. Module is marked `autoDownloaded: true` with a `lastUsedAt` timestamp
6. On subsequent chapter/verse loads, `OfflineBibleProvider` reads locally from OPFS via the wa-sqlite web worker

### Auto-Cleanup

- Runs once at app startup via `runAutoCleanup()`
- Only targets modules with `autoDownloaded: true`
- Removes modules unused for 15+ days (based on `lastUsedAt`)
- Explicitly downloaded modules (via Settings UI, `autoDownloaded: false`) are never auto-cleaned

### Offline-First Data Flow

```
User navigates to chapter
  → OfflineBibleProvider.getChapter()
    → Is module downloaded? (offlineStore.isModuleDownloaded)
      YES → Open .db in OPFS → wa-sqlite Web Worker → Query + format → Return ChapterData
      NO  → ServerDataProvider.getChapter() → HTTP fetch → Return ChapterData
```

## Testing PWA

**PWA features (service worker, install prompt) only work on a production build served with `features.pwa` on** (site config, or `FEATURE_PWA=1` in the environment), never on `pnpm run dev`.

Automated coverage: `e2e/tests/pwa-e2e.spec.ts` (install, offline boot, cache rules, update, Reset app cache, kill switch; Chromium only; the e2e config starts a second server on port 3101 with the PWA on) plus unit tests in `src/sw/cacheRules.test.ts`, `src/utils/appUpdate.test.ts` and `server/__tests__/serviceWorker.test.ts`.

### Quick test steps

```bash
cd apps/web
pnpm run build                # one build serves both modes
FEATURE_PWA=1 pnpm run start  # Serve production build on http://localhost:3100 with the PWA on
```

### Verifying the PWA is off (the default)

```bash
cd apps/web
pnpm run build && pnpm run start   # features.pwa unset
```

1. DevTools > Application > Service Workers — **no** registration.
2. DevTools > Application > Manifest — no manifest (`/manifest.webmanifest` answers 404, and the served `index.html` carries no `<link rel="manifest">`).
3. `curl -I http://localhost:3100/sw.js` — 200 with `Cache-Control: no-store`, body is the kill worker.
4. Offline tab reading still works after visiting a chapter (OPFS auto-download).

Upgrade path from a PWA build: load the site once with a worker installed, reload, and confirm the registration is gone.

1. Open `http://localhost:3100` in Chrome
2. **Install prompt**: Look for the install icon in the address bar (right side), or use Chrome menu > "Install Keep Thy Heart Bible Reader..."
3. **Service worker**: DevTools > Application > Service Workers — should show registered and activated
4. **Manifest**: DevTools > Application > Manifest — verify name, icons, display mode
5. **Offline test**: DevTools > Network > check "Offline" — app shell should still load from cache
6. **Cache inspection**: DevTools > Application > Cache Storage — check `commentary-text-v1` and `study-overview-v1`
7. **Offline modules**: Settings > Offline tab > download a Bible module > go offline > verify reading still works

### Testing offline Bible reads

1. Navigate to a chapter (e.g., John 3) — first load goes to server
2. Wait a few seconds for auto-download to complete (check DevTools Network for `/download-lite`)
3. Navigate to another chapter in the same translation
4. Verify: no network request to `/api/bible/...` — served from local SQLite
5. Go offline (DevTools > Network > Offline) — verify chapter switching still works

### Testing lite endpoint

```bash
curl http://localhost:3100/api/modules/KJV/download-lite -o kjv-lite.db
ls -la kjv-lite.db  # Should be ~3.5MB vs 79MB for full KJV
```

### Lighthouse audit

DevTools > Lighthouse > check "Progressive Web App" > Generate report. Validates installability, SW, manifest, HTTPS, icons, etc.

### Update flow

1. Build and serve, open the app (SW registers)
2. Change code, rebuild
3. Reload the tab — the app detects the build-ID mismatch, updates the worker, and reloads
   itself once. No dialog. Console shows `[PWA] Build mismatch (client …, server …) — updating`.

### Auth loop regression test

The bug this design exists to prevent, reproduced by hand:

1. Build, serve with auth enabled, open the app, let the service worker install.
2. Delete the `bible_auth` cookie (DevTools > Application > Cookies) to simulate the session
   cookie expiring on browser close — `privacyMode: 'strict'` makes this the normal case.
3. Reload. **Expected:** the login page appears. **Regression:** the app shell reloads
   repeatedly, hammering `/api/health` and `/api/config`.

### Boot-loop detector test

In DevTools console, force the trip condition and reload:

```js
sessionStorage.setItem('br_boot_log', JSON.stringify(Array(6).fill(Date.now())));
```

Expected: the app does not boot, the recovery screen appears, and
DevTools > Application > Service Workers shows no registration. `embedding-model` and
`semantic-index` must still be present in Cache Storage.

### Dev mode PWA testing

To test SW during development, change `vite-plugin-pwa` config in `vite.config.ts`:
```ts
VitePWA({
  devOptions: { enabled: true },  // Add this
  // ...rest of config
})
```
This registers the SW in dev mode too. **Remove before committing** — dev SW can cause stale cache issues.

## Key Behaviors

- SW registration type is `prompt`, which here means only "the plugin never reloads the page
  on its own" — updates are applied silently by `appUpdate.ts` under a loop guard. `autoUpdate`
  would reload with no such guard
- `onOfflineReady` callback logs to console when all assets are cached
- Offline badge appears in header only when both offline AND offline mode is enabled
- Module downloads track progress via `offlineStore.activeDownloads` map
- Storage quota and usage displayed in Settings > Offline tab
- Downloaded modules persist across sessions via localStorage (metadata) + OPFS (data)
- Auto-downloads use lite endpoint (~85% smaller); manual downloads use full endpoint
- The wa-sqlite WASM binary is bundled by Vite and loaded on-demand when the first offline query runs

## Error Recovery & Blank Screen Prevention

The PWA includes multiple layers of error recovery to prevent blank screens:

1. **Loading UI** (`index.html`): A spinner and app name are shown inside `#app` before JS loads. If JS never executes or init fails, users see a meaningful error instead of a blank page.

2. **Bootstrap error handling** (`main.tsx`): If `init()` throws, the error handler shows the fallback UI from `index.html` with a descriptive message, Reload button, and Clear Cache & Reload button.

3. **Auth pre-check** (`main.tsx`): Before initializing stores, a quick `/api/health` check detects expired auth cookies. On 401 the app makes **one** guarded navigation to the login page; if that allowance is already spent it shows "Your session has expired" and waits for the user. It must never reload in place — see "Why navigation is network-first" above.

8. **Boot-loop detector** (`index.html`): The outer net. Stops the app entirely after 5 boots in 20 seconds and resets the shell caches — see "Boot-Loop Detector" above.

4. **Error boundary** (`ErrorBoundary.tsx`): Wraps the entire app tree. If any component crashes during render, shows a recovery screen with Try Again (re-render), Reload, and Clear Cache options.

5. **Pull-to-refresh** (`PullToRefresh.tsx`): Mobile users can pull down from the top to trigger a page reload — essential for PWA standalone mode where browser chrome is hidden.

6. **Refresh button** (`Header.tsx`): A refresh icon in the header actions area for quick page reloads on any device.

7. **Network error banner** (`ConnectionBanner.tsx`): Transient connection errors show a dismissible banner rather than breaking the app.

## Authentication

Auth is a lightweight password gate for personal/self-hosted use. It is fully settings-driven:

- **site-config.json** `auth` block: `password` (plain text, auto-hashed and written back), `passwordHash` (pre-hashed), or `enabled: false`. The legacy `server-config.json` keys still load through `SiteConfig`'s fallback
- **Environment variables**: `SITE_PASSWORD` or `NO_AUTH=1`
- **No default**: there is no built-in fallback password. If `enabled` is true and neither `password`, `passwordHash` nor `SITE_PASSWORD` is set, the server exits at startup rather than coming up on a shared default
- **Cookie**: `bible_auth=1`, `HttpOnly`, `SameSite=Lax`, `Secure` behind TLS. **Session-only by default** — the 1-year `Max-Age` is added only when `privacy.mode` is `relaxed`
- **Rate limiting**: 5 failed attempts per IP within 15 minutes
- **Manifest**: browsers fetch `manifest.webmanifest` without credentials by default, which the password gate answers with 401. Two guards: `useCredentials: true` in the `VitePWA` config emits `crossorigin="use-credentials"` on the manifest link, and `passwordGate.ts` exempts `.webmanifest` alongside the other non-sensitive static build artifacts.
