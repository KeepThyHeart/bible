# Server & API

**Last verified:** 6e80a84 (2026-09-04)

Express.js backend serving the API and static frontend files.

## Files

### Server Core

| File | Description |
|---|---|
| `server/index.ts` | Express app setup, config loading, password hash resolution, route registration, static file serving with SPA fallback. Also owns the four app-level endpoints defined inline: `GET /api/health`, `GET /api/version` (`{ version, buildId }`, always `no-store`), `GET /api/config` (client-safe config), `GET /api/plugins` |
| `server/routes/routeRegistry.ts` | `registerRoute()` / `getRegisteredRoutes()`. Every route file self-registers at module scope with a mount `path` and a `createRoutes(deps)` factory; `index.ts` iterates the registry (sorted by `order`, default 100) and `app.use(reg.path, ...)`. `RouteDependencies` = `{ db, siteSettings, extra }` — the `extra` bag carries the search pipeline options, feature flags, `dataDir` and `privacyMode` |
| `server/core.ts` | Shared Express app creation, **and** the CJS→ESM bridge for `@bible/core`: `@bible/core` is CJS so Node ESM cannot do named imports from it, and this file re-exports every repository/service/helper the server uses via `createRequire`. Server code imports `@bible/core` symbols from here, never directly |
| `server/plugins/pluginManager.ts` | Server plugin discovery/activation from `<dataDir>/plugins`; mounts plugin middleware and routers ahead of core routes (`server/plugins/ServerHooks.ts`, `ServerPluginContext.ts`) |
| `server/SiteConfig.ts` | Unified config loader — loads `site-config.json` or falls back to legacy files (`server-config.json`, `settings.json`). Typed getters, client-safe config, password write-back, search pipeline loading |
| `server/middleware/passwordGate.ts` | Password gate auth middleware (scrypt hashing, rate limiting, login page, cookie checking) |
| `server/middleware/rateLimiter.ts` | Per-IP tiered rate limiting. `tierForApiPath()` maps a path to exactly one tier — see "Rate limiting" below for why that exclusivity matters |
| `server/middleware/compression.ts` | gzip for text responses, mounted ahead of every route and both `express.static` mounts. The server previously shipped **no** compression: measured, this takes `index.js` 555 KB → 159 KB, `index.css` 221 KB → 38 KB, and a KJV Psalm 119 chapter 49 KB → 6.7 KB. `shouldCompress` (exported for tests) declines `application/octet-stream` and `application/wasm` — note `compressible` answers **true** for both, so the default filter would gzip the ~180 MB `/data` embedding vectors and the ~21 MB ONNX wasm on every cold request |
| `server/siteSettings.ts` | Module settings types and helpers (`isModuleActive`, `getModuleEntry`, `buildDescriptions`, `buildSortOrders`). Legacy loader for `settings.json` (now called by SiteConfig) |
| `server/DatabaseManager.ts` | Singleton managing all database connections and repository instances; lazy-loads repos, caches DBs, graceful shutdown cleanup |
| `server/providers/SqliteProvider.ts` | better-sqlite3 wrapper implementing ISql; WAL mode, foreign keys, memory cache, busy timeout |

### Routes

All routes are `GET` unless marked otherwise. The mount path in the left column
is the `path` the file passes to `registerRoute`.

| File (mount) | Endpoints |
|---|---|
| `server/routes/bibleRoutes.ts` (`/api/bible`) | `/:module/:book/:chapter`, `/:module/verse/:verseId`, `POST /:module/verses` (batch verse text, max 500 ids, text only — used by topics/cross-refs), `/votd` (optional `?module=`, defaults to KJV), `/topics/:book` (section headings/titles from the enrichments DB via `BibleViewService`) |
| `server/routes/commentaryRoutes.ts` (`/api/commentary`) | `/:module/:book/:chapter`, `/:module/verse/:verseId`, `/all/:book/:chapter` (bulk; optional `?modules=a,b,c` narrows it to a caller-chosen subset — see "Commentary payload budget" below), `/chapter-overview/:book/:chapter` (word counts, no content), `/availability/:book/:chapter`, `/home/:book/:chapter`, `/:module/chapter-verses/:book/:chapter` (which verse numbers have content), `/info/:module` (module_info, for the About section) |
| `server/routes/searchRoutes.ts` (`/api/search`) | `/keyword`, `/semantic`, `/strongs` (paged — see [Search](search.md#paging-strongs-occurrences)), `POST /semantic/warmup` (returns `{ status: 'ready' \| 'unavailable' \| 'error' }`) |
| `server/routes/interlinearRoutes.ts` (`/api/interlinear`) | `/:book/:chapter` (optional `?module=`; defaults to KJV) |
| `server/routes/dictionaryRoutes.ts` (`/api/dictionary`) | `/available`, `/search`, `/:module/{search,letters,browse,adjacent/:key,count,entry/:key}` |
| `server/routes/strongsRoutes.ts` (`/api/strongs`) | `/:number` |
| `server/routes/crossRefRoutes.ts` (`/api/xref`) | `/:module/:verseId/groups`, `/:module/:verseId/count` |
| `server/routes/topicalRoutes.ts` (`/api/topical`) | `/modules`, `/verse/:verseId`, `/:module/topic/:topicId`, `/:module/topic/:topicId/children`, `/:module/topic/:topicId/verses`, `/search` — see [Topics](topics.md) |
| `server/routes/tagGraphRoutes.ts` (`/api/taggraph`) | `/verse/:verseId`, `/entity/:category/:entityId`, plus `/associations`, `/verses`, `/facets`, `/topic-links` under that entity path; `/search`, `/topic-link/:sourceModule/:topicId`. Gated by the `showTagGraph` feature flag — see [Topics](topics.md) |
| `server/routes/moduleRoutes.ts` (`/api`, **not** `/api/modules`) | `/modules`, `/books`, `/module-sections` (client UI grouping from `site-config.json`), `/modules/:name/download` (full module `.db` for offline; `:name` may be `semantic-index`), `/modules/:name/download-lite` (trimmed copy, cached under `<dataDir>/lite-cache`), `/modules/:name/info` |
| `server/routes/studyOverviewRoutes.ts` (`/api/study/overview`) | `/:book/:chapter` — bundled pre-generated study data (commentary overview, topics, cross-refs, entities) served from static cache |
| `server/routes/feedbackRoutes.ts` (`/api/feedback`) | `POST /` — see "User feedback" below |
| `server/routes/desktopReportRoutes.ts` (`/api/desktop-report`) | `POST /` — see "Desktop reports" below |

### Utilities

| File | Description |
|---|---|
| `server/utils/validation.ts` | Per-parameter validators (`validateModuleName`, `validateBookNumber`, `validateChapter`, `validateSearchQuery`, …). Each returns the parsed value or `null`; routes call them first and 400 on `null`. Also `MAX_PAGE_SIZE` (200) |
| `server/utils/errorResponse.ts` | `sendError()` and `ErrorCodes` — the `{ error: { code, message } }` envelope every route returns |
| `server/utils/logger.ts` | Rotating file logger in the data dir (10 MB × 3), plus `setPrivacyMode` |
| `server/utils/semaphore.ts` | Bounded-concurrency gate with a bounded wait queue for CPU-bound ONNX embedding/reranking; `QueueFullError` becomes 503 + `Retry-After` |
| `server/utils/consolidateResults.ts` | Presentation-layer consolidation of semantic results, run *after* core's `consolidate()` |

Verse text formatting is **not** in `server/utils` — `formatVerseText` lives in
`@bible/core` (`packages/core/src/Services/VerseFormatter.ts`) and reaches the
routes through the `server/core.ts` re-export.

### Type Declarations

| File | Description |
|---|---|
| `server/types/better-sqlite3-web.d.ts` | Type declaration for the `better-sqlite3-web` npm alias |
| `server/types/usearch.d.ts` | Type declaration for the optional `usearch` ANN index (`server/search/UsearchVectorSearch.ts`) |

### Tests

`server/__tests__/` (Vitest). One file per route module — `bibleRoutes.test.ts`,
`commentaryRoutes.test.ts`, `crossRefRoutes.test.ts`, `dictionaryRoutes.test.ts`,
`interlinearRoutes.test.ts`, `moduleRoutes.test.ts`, `searchRoutes.test.ts`,
`feedbackRoutes.test.ts` — plus `api.test.ts` (integration, needs real module
DBs), `infrastructure.test.ts`, `compression.test.ts`, `rateLimiter.test.ts`,
`passwordGate.test.ts`, `errorResponse.test.ts`, `consolidateResults.test.ts`,
`filterTopicEntries.test.ts`. Route tests use the fake req/res in
`server/__tests__/expressMocks.ts` rather than booting the app.

## Database Architecture

- **DatabaseManager** is a singleton; all routes access it for repositories
- Module databases are opened lazily on first access and cached
- Case-insensitive module abbreviation resolution. `getDictionaryRepo()` also retries the lowercased name when building the `dictionary_<name>.db` path: the API advertises mixed-case abbreviations ("AmTract", "ISBE") while the files on disk are lowercase, so on a case-sensitive filesystem the obvious path never resolved and every dictionary lookup returned null
- Uses `better-sqlite3-web` (npm alias for `better-sqlite3` compiled for system Node.js, avoiding conflicts with Electron's copy)

## Content Security Policy

`scriptSrc` must include `'wasm-unsafe-eval'`. Without it the browser refuses to
compile **any** WebAssembly module — "Refused to compile or instantiate
WebAssembly module" — which breaks the `wa-sqlite` worker behind offline module
storage and the in-browser search index. It is the narrow directive for wasm
only and does **not** re-enable `eval()` for JavaScript, unlike `'unsafe-eval'`.

## Rate limiting

`server/middleware/rateLimiter.ts`. Per-IP fixed windows of one minute, plus a
process-wide ceiling. **Exactly one tier is charged per request** —
`tierForApiPath()` selects it and `index.ts` mounts a single middleware.

This is load-bearing. Express runs *every* matching `app.use`, so tier
middlewares mounted on overlapping prefixes (`/api/bible` → content, then
`/api` → default) charge each request its own tier **and** `default`. `default`
is the lower cap, so it trips first and `content` becomes unreachable — the
whole API running at the default cap. Never mount a second tier on an
overlapping path.

| Tier | Limit/min | Covers |
|---|---:|---|
| `content` | 600 | bible, commentary, dictionary, interlinear, strongs, xref, topical, taggraph, study, books, modules, module-sections |
| `search` | 60 | search |
| `default` | 120 | everything else — health, config, version, plugins |
| `global` | 10,000 | process-wide overload valve, mounted on `/api` only |

Limits are sized from measurement, not intuition: an ordinary reading pace with
the study pane open runs at roughly **180 API req/min** (4-7 per chapter
navigation, 2 per verse tap). The previous caps sat below that, so normal
reading tripped them in about twenty seconds. `content` is ~3× the measured pace
to allow for parallel tabs, a second device on one address, and burst
navigation.

The global ceiling is mounted on `/api` so static assets, `/data`, the SPA shell
and the login page do not consume it.

**Known gaps** (not addressed here): the window is fixed rather than rolling, so
a burst either side of a boundary counts as two windows; and
`app.set('trust proxy', true)` trusts any hop, so a client can rotate
`X-Forwarded-For` to evade the per-IP counter. If the front proxy does not send
`X-Forwarded-For`, all users collapse onto one key and share a single budget.

## HTTP caching

`index.ts` sets `no-store` on everything under `/api` by default — responses are
auth-gated and a cached 200 outlives a logout — and upgrades paths matching
`CACHEABLE_API_PATHS` to `private, max-age=3600, stale-while-revalidate=86400`.

The upgrade happens at `writeHead` time so only a 2xx gets it; pinning a 404 for
an hour would outlive the fix for whatever produced it. It also only replaces
the default header, so a route that sets its own `Cache-Control` keeps it —
previously the patch overwrote unconditionally and silently downgraded routes
asking for `public, max-age=86400`.

Cacheable: commentary chapter text, `commentary/all`,
`commentary/chapter-overview`, `commentary/home`, `commentary/:module/verse/:id`,
`study/overview`, `interlinear`, `books`, `strongs/:number`, and the three
per-verse study endpoints `xref/:module/:verseId/{groups,count}`,
`topical/verse/:verseId` and `taggraph/verse/:verseId`. All are immutable for a
given key.

The per-verse trio was added because it is the path a default deployment
actually takes: the pre-generated study cache (`data/cache/study-cache.db`) is
built by a generator that ships separately, and without it
`studyStore.loadStudyOverviewAndData` falls through to these three per verse.
Left `no-store` they were re-fetched every time the reader clicked a verse —
including a verse they had visited moments earlier.

`interlinear` matters most by size — ~155 KB and ~290 ms, and it was being
refetched on every chapter navigation because `no-store` made its ETag useless.
Note that it is now also fetched far less often: see
[State Management → Selecting a verse does not load anything](state-management.md).

## Commentary payload budget

`/api/commentary/all/:book/:chapter` returns full chapter text for every active
commentary module, and the large modules are very large: measured on John 3,
Matthew Henry is **2.1 MB**, Luther 845 KB, KingComments 132 KB — against
Barnes at 74 KB and TSK at 26 KB.

Called unconditionally on every chapter navigation (`MobileCommentary`,
`MobileCommentaryView`), this has a reader tapping through chapters pull
multiple megabytes of commentary they never opened.

It is budget-gated client-side, in `commentaryStore`:

1. `prefetchChapterOverview()` runs first — `/chapter-overview` is word counts
   only, and the card list needs it anyway.
2. `affordablePrefetchModules()` totals words per module and picks
   cheapest-first up to `PREFETCH_WORD_BUDGET` (60k words), skipping any single
   module over `PREFETCH_MODULE_WORD_CAP` (25k). On John 3 that admits TSK,
   Wesley, Clarke, Barnes and Synthesis, and excludes MHC and Luther.
3. The bulk request is then made with `?modules=` naming only those. If nothing
   qualifies — or there is no overview to judge by — **no bulk request is made
   at all**.

`isCheapEnoughToWarm()` applies the same per-module cap to the background
full-chapter fetch in `fetchModuleEntries()`, which had the same problem at
single-module scale.

Nothing here limits what a reader actually opens: `fetchEntriesForVerse()` and
`fetchModuleEntries()` always serve the module they asked for, at any size.
These budgets bound *speculative* fetching only.

**Underlying cause, not yet fixed:** most of that weight is duplicated content
in the module databases themselves. Matthew Henry stores an identical ~73 KB
chapter blob on every verse row (36 copies for John 3, all `entry_level =
'verse'`). Across the 24 shipped commentary modules, 780 MB of 1084 MB is
byte-identical duplication — MHC 90%, Luther 97%, KingComments 80%,
NetNotesFree 57%. Deduplicating at conversion time would shrink MHC's chapter
payload ~29x and make most of this budgeting unnecessary.

## User feedback

`server/routes/feedbackRoutes.ts`. `POST /api/feedback` takes
`{ message, category?, contact? }` and writes **one JSON file per submission**
into `<dataDir>/feedback` (the directory is created once at route-factory time).

One file per submission rather than an append-only JSONL log: concurrent
requests write disjoint files, so there is no interleaving to corrupt and no
single file whose truncation loses every prior submission, and an operator can
delete or forward one submission without rewriting a log.

The filename is built entirely from server-generated values — an ISO timestamp
with `:`/`.` replaced, plus a `randomUUID()` — so nothing the caller sent ever
reaches a path. The response carries `{ ok, id, submittedAt }` and deliberately
never names a file or directory.

Validation: `message` required, trimmed, non-empty, ≤ 5000 chars; `category`
must be `bug` / `idea` / `other` when present (absent means `other`); `contact`
≤ 200 chars. The global `express.json({ limit: '100kb' })` bounds the body ahead
of all of it.

**Privacy.** `req.ip` is recorded *only* when `siteConfig.privacy.mode` is
`relaxed`. In `strict` — the default — no client-identifying value reaches disk,
matching what `logger.setPrivacyMode` enforces for the logs. The route factory
receives `dataDir` and `privacyMode` through `deps.extra` (assembled in
`server/index.ts`) rather than reaching into `DatabaseManager`'s private field.

**Rate limiting** is inherited, not mounted: `/api/feedback` is absent from
`tierForApiPath()`, so it falls to the `default` tier (120/min). Adding an
`app.use` for it would double-charge every request — see "Rate limiting" above.

## Desktop reports

`server/routes/desktopReportRoutes.ts`. `POST /api/desktop-report` receives one
queued report from the **desktop** app's diagnostics uploader and writes it to
`<dataDir>/desktop-reports`, one JSON file per report, by the same
file-per-submission reasoning as feedback above.

It is a separate route and a separate directory on purpose. What arrives here is
not a browser form: it is a versioned envelope built by
the desktop app's `apps/desktop/electron/services/DiagnosticsService.ts` whose shape
depends on the report type (`crash` \| `manual` \| `feedback`). Merging the two
would mean an operator could not tell which product a submission came from, and
every field added to one shape would have to become optional in the other.

**No IP address is recorded, in either privacy mode.** This is the one place the
`/api/feedback` `relaxed`-mode behaviour is deliberately *not* mirrored. The
desktop app shows the user a privacy summary before they send whose closing line
promises it never sends "Your IP address, timezone, or locale", and the readers
most likely to need that promise kept are those in countries where being
identified as a Bible reader carries a real cost.

Discarding the address also discards the usual way to stop a flood, so the route
leans on three cheaper defences: a shared build token (`X-Report-Token`,
configured as `desktopReports.token` in `site-config.json`; empty accepts any
build), structural validation of the envelope before anything touches disk, and
the size caps plus the inherited `default` rate-limit tier. Token comparison is
constant-time, and a bad or missing token returns **404, not 401**, so a scanner
learns nothing about whether the path exists.

Validation: `type` must be one of the three; `report_id` must match
`/^[\w.:-]+$/` and be ≤ 128 chars — which is also what keeps it out of a file
path; `timestamp` required; `user_description` ≤ 20 000 chars; the serialised
record ≤ 64 KB. Unknown fields are preserved wholesale under `payload`, so a new
field added desktop-side needs no change here.

Tests: `server/__tests__/desktopReportRoutes.test.ts`.
