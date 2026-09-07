# PWA & Offline

**Last verified:** 6e80a84 (2026-09-04)

Progressive Web App support with service worker caching, installability, and offline Bible reading via OPFS module downloads.

## ⚠️ The PWA is OFF by default

The service worker and web app manifest are built **only when `ENABLE_PWA=1`** is set on the client build. Everything below describes the opt-in build; a default build is an ordinary mobile-friendly website.

Why: a service worker is the only thing in this stack that can answer a *navigation* from cache, and a stale app shell answering navigations is the root of every boot loop this app has had. Layers of guards (network-first navigation, the build-ID handshake, the boot-loop detector) each narrowed the failure but none closed it, largely because an already-wedged client is the one client that cannot run the code meant to rescue it. Turning the worker off removes the mechanism instead of guarding it.

Nothing was deleted. `src/sw.ts`, the update handshake, and the whole offline stack are intact and re-enable with the flag:

```bash
ENABLE_PWA=1 npm run build:client     # or: ENABLE_PWA=1 npm run build
```

**Still works with the PWA off:**

- **Offline Bible reading** — OPFS module downloads + wa-sqlite never went through the service worker.
- **Browser semantic search** — `@huggingface/transformers` writes the ~130 MB model to its own `transformers-cache` Cache Storage entry from the search worker, independent of any service worker.
- **Commentary / study-overview caching** — moved to plain HTTP cache headers (see [Cache headers without a service worker](#cache-headers-without-a-service-worker)).
- **Hashed asset caching** — `dist/client/assets/*` is served `immutable` for a year, which is what the precache was buying.

**Lost with the PWA off:** installability, standalone display, and loading the app shell with no network at all.

### Reaching browsers that already installed a worker

Disabling registration only stops *new* clients. A build with the PWA off therefore emits a **self-destroying `sw.js`** (`killServiceWorkerPlugin()` in `vite.config.ts`) at the same URL the old worker occupied. Browsers re-fetch the worker script on every navigation, bypassing the HTTP cache, so this is the one channel that still reaches a client too wedged to boot. It registers no `fetch` handler, clears the shell caches, and calls `registration.unregister()`. `embedding-model`, `semantic-index`, and `transformers-cache` are preserved — re-downloading them to switch off a feature flag would be its own problem.

The server sends `Cache-Control: no-store` on `sw.js` as a second guarantee that the replacement is never served stale.

`src/utils/appUpdate.ts` does the same teardown from inside the app (`unregisterServiceWorkers()`), which covers clients that boot normally.

## Files

### Configuration

| File | Description |
|---|---|
| `vite.config.ts` | `ENABLE_PWA` flag → `__PWA_ENABLED__` define; `vite-plugin-pwa` config in **`injectManifest`** mode (opt-in only); `killServiceWorkerPlugin()` emitting the self-destroying `sw.js` when off; `__BUILD_ID__` define and the plugin emitting `build-id.json` |
| `src/utils/pwaRegisterStub.ts` | No-op stand-in for `virtual:pwa-register`, aliased in when the plugin is out of the graph so `appUpdate.ts` keeps its static import |
| `index.html` | PWA meta tags: theme-color, apple-touch-icon, viewport |
| `src/main.tsx` | Imports self-hosted Font Awesome CSS (core + solid + regular) so icons work offline and avoid third-party CDN/tracking-prevention issues |
| `public/icons/icon-192.svg` | App icon 192x192 (blue background, white serif "B") |
| `public/icons/icon-512.svg` | App icon 512x512 |
| `public/icons/icon-192.png`, `icon-512.png` | PNG fallbacks alongside the SVGs |

### Service Worker & Registration

| File | Description |
|---|---|
| `src/sw.ts` | **Hand-written service worker.** Network-first navigation (3s timeout → precached shell), `skipWaiting` + `clientsClaim`, and the four runtime content caches |
| `src/utils/appUpdate.ts` | SW registration (no-op unless `PWA_BUILD_ENABLED`), silent update application, the build-ID staleness check, and the `unregisterServiceWorkers()` kill switch |
| `src/utils/bootGuard.ts` | sessionStorage-backed one-shot guards for every automatic navigation (login redirect, update reload) |
| `src/main.tsx` | Boot sequence: health + config + version in parallel → auth handling → SW registration → update check → render. Wires `OfflineBibleProvider`, auto-download, auto-cleanup |
| `src/vite-env.d.ts` | Type declarations for `virtual:pwa-register`, `__BUILD_ID__`, `__PWA_ENABLED__`, and the two untyped `wa-sqlite` entry points |
| `dist/client/sw.js` | (Generated) With `ENABLE_PWA=1`, compiled from `src/sw.ts` with the precache manifest injected. Otherwise the self-destroying kill worker. |
| `dist/client/build-id.json` | (Generated) Build stamp; read by the server at startup and served from `/api/version` |
| `dist/client/manifest.webmanifest` | (Generated, `ENABLE_PWA=1` only) Web app manifest |

### Offline Storage

| File | Description |
|---|---|
| `src/stores/offlineStore.ts` | Offline state: enabled flag, online/offline detection, downloaded modules list, download progress, storage quota. Tracks `lastUsedAt` and `autoDownloaded` per module. `touchModule()` updates usage timestamp; `getStaleAutoModules()` finds auto-downloads unused for N days. Persisted to localStorage. |
| `src/providers/OfflineStorageManager.ts` | OPFS storage manager: download modules with progress tracking, download semantic index, **download lite modules** (no FTS5/interlinear), remove/read modules, storage quota reporting |
| `src/offline/sharedInstances.ts` | Shared singleton `OfflineStorageManager` instance (avoids circular imports) |

### Client-Side SQLite (Offline Bible Reads)

| File | Description |
|---|---|
| `src/offline/bibleWorker.ts` | Web Worker that runs **wa-sqlite** (`wa-sqlite-async.mjs` + `OriginPrivateFileSystemVFS`) against the `.db` files in OPFS — the file is queried in place, never loaded into memory. LRU cache of 3 open databases. Not sql.js: the module declarations for both wa-sqlite entry points are in `src/vite-env.d.ts` |
| `src/offline/verseFormatting.ts` | Verse formatting for the offline read path — a duplicate of `@bible/core` `VerseFormatter`, split out of `bibleWorker.ts` so it can be unit-tested (the worker imports `wa-sqlite` at load and cannot be imported by a test). Must stay in step with the server's copy: the same verse should not look different offline. |
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
| `/api/commentary/:module/:book/:chapter`<br>`/api/commentary/all/:book/:chapter`<br>`/api/study/overview/:book/:chapter` | `private, max-age=3600, stale-while-revalidate=86400` | Keyed entirely by module + book + chapter, no user identity in the response, and the bulk of repeat traffic while reading |
| everything else under `/api` | `no-cache, no-store, must-revalidate` | Auth-gated and user-specific; a cached 200 outlives a logout |

The cacheable API header is applied at **write time**, not request time, so only a 2xx gets it. A missing module answers 404 on a valid-looking path, and pinning that for an hour would outlive the fix for whatever produced it. `private` keeps these out of shared proxies — the response still travelled through the password gate even though its body is not user-specific.

## Caching Strategies (`ENABLE_PWA=1` builds only)

| Cache | URL Pattern | Strategy | TTL |
|---|---|---|---|
| Navigation | `request.mode === 'navigate'` | NetworkFirst, 3s timeout → precached `index.html` | n/a |
| Precache | `**/*.{js,css,html,svg,png,woff2}` | Precache (built-in) | Until new SW |
| `embedding-model` | `/data/models/*` | CacheFirst | 1 year, 20 entries | Self-hosted ONNX model for browser search; downloaded once, then offline |
| `semantic-index` | `/data/semantic_*` | CacheFirst | 1 year, 10 entries | Int8 vectors + metadata for browser search |
| `commentary-text` | `/api/commentary/:mod/:book/:chapter` | CacheFirst | 7 days, 200 entries |
| `study-overview` | `/api/study/overview/:book/:chapter` | CacheFirst | 7 days, 100 entries |

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
- `pwaEnabled: false` in server config (`features.pwa`) also **unregisters** existing workers
  (`unregisterServiceWorkers()`), preserving the `embedding-model`, `semantic-index`, and
  `transformers-cache` caches. Previously it only skipped new registrations, leaving
  already-installed workers unreachable. Note this is the *runtime* switch and can only turn
  a `ENABLE_PWA=1` build off — it can never turn a default build on, because such a build
  ships no worker to register.

The handshake still runs in a default build. It costs one `no-store` fetch, it is the only
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

**PWA features (service worker, install prompt) only work on production builds built with `ENABLE_PWA=1`**, never on `npm run dev`.

### Quick test steps

```bash
cd apps/web
ENABLE_PWA=1 npm run build   # Build client + server WITH the service worker
npm run start                # Serve production build on http://localhost:3100
```

### Verifying the PWA is off (default build)

```bash
cd apps/web
npm run build && npm run start
```

1. DevTools > Application > Service Workers — **no** registration.
2. DevTools > Application > Manifest — no manifest (`dist/client/manifest.webmanifest` is not emitted, and `index.html` carries no `<link rel="manifest">`).
3. `curl -I http://localhost:3100/sw.js` — 200 with `Cache-Control: no-store`, body is the kill worker.
4. Offline tab reading still works after visiting a chapter (OPFS auto-download).

Upgrade path from a PWA build: load the site once with a worker installed, reload, and confirm the registration is gone.

1. Open `http://localhost:3100` in Chrome
2. **Install prompt**: Look for the install icon in the address bar (right side), or use Chrome menu > "Install Keep Thy Heart Bible Reader..."
3. **Service worker**: DevTools > Application > Service Workers — should show registered and activated
4. **Manifest**: DevTools > Application > Manifest — verify name, icons, display mode
5. **Offline test**: DevTools > Network > check "Offline" — app shell should still load from cache
6. **Cache inspection**: DevTools > Application > Cache Storage — check `commentary-text` and `study-overview`
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
