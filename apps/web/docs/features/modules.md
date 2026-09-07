# Modules

**Last verified:** 6e80a84 (2026-09-04)

Loading and managing Bible, Commentary, and Dictionary modules.

## Files

### State

| File | Description |
|---|---|
| `src/stores/moduleStore.ts` | Fetches and caches available modules and books; provides module type filtering and abbreviation lookups |

### Server

| File | Description |
|---|---|
| `server/routes/moduleRoutes.ts` | Mounted at `/api` (not `/api/modules`): `GET /api/modules?type=...`, `GET /api/module-sections`, `GET /api/books`, plus the offline-download trio `GET /api/modules/:name/info`, `/download` and `/download-lite` — see [PWA & Offline](pwa-offline.md) |
| `server/siteSettings.ts` | `SiteSettings` types and helpers (`isModuleActive`, `getModuleEntry`, `buildDescriptions`, `buildSortOrders`). Its `loadSiteSettings()` reader for a standalone `settings.json` is marked `@deprecated` — `SiteConfig` calls it only as the legacy fallback |
| `server/SiteConfig.ts` | The current loader. Reads `site-config.json`; the `modules` section of that file is what feeds these routes. Falls back to the legacy `server-config.json` / `settings.json` / `search-pipeline.json` trio when there is no `site-config.json` |

### Data Providers

| File | Description |
|---|---|
| `src/providers/ServerDataProvider.ts` | `IModuleProvider` interface and implementation for fetching modules/books/sections |

### Configuration

| File | Description |
|---|---|
| `schemas/site-config.schema.json` (repo root) | **Not in this repo** — the root `schemas/` directory was never imported. The schema for the unified `site-config.json` now lives at `config/site-config.schema.json` (below) |
| `schemas/settings.schema.json` (repo root) | **Not in this repo** — the root `schemas/` directory was never imported. JSON Schema for the legacy standalone `settings.json` |
| `config/site-config.example.json` | Example unified config; copy to `data/site-config.json` |
| `config/site-config.schema.json` | JSON Schema for the above; editor validation only, never read at runtime |
| `config/settings.sample.json` | Sample legacy settings file; copy to `apps/web/data/settings.json` and customize |
| `config/settings.schema.json` | JSON Schema for the above; editor validation only, never read at runtime |
| `data/settings.json` | Legacy module whitelist (gitignored) — module visibility and section grouping. Superseded by the `modules` section of `site-config.json` |
| `generate-settings.js` | **Not in this repo** — it lived in a repo-root `scripts/` directory that has not been imported, and its final location is not settled. CLI script to auto-discover modules and bootstrap/update `settings.json` |

## Dictionary Modules

Dictionaries are used both for Strong's lexicon lookups (see
[Interlinear & Strong's](interlinear-strongs.md)) and as browsable/searchable
reference works in the right-pane Dictionary tab.

### Files

| File | Description |
|---|---|
| `src/components/DictionaryPane/DictionaryPane.tsx` | Pane container: tab bar + active tab content |
| `src/components/DictionaryPane/DictionaryTabBar.tsx` | Dictionary tabs (permanent Home tab, temporary preview tabs, add/close). The "+" opens the shared `ModuleSelectDialog` |
| `src/components/common/ModuleSelectDialog.tsx` | Shared centered module picker (see [Commentary](commentary.md)). It lists **every** dictionary, open ones checked, so unchecking closes a tab — the same shape as the Commentaries picker. It replaced an anchored dropdown that listed only unopened modules and added one per click, which could not close anything |
| `src/components/DictionaryPane/DictionaryHome.tsx` | Cross-dictionary search and module list |
| `src/components/DictionaryPane/DictionaryContent.tsx` | One dictionary: search box with suggestion dropdown, alphabet browse bar, entry display, prev/next entry |
| `src/stores/dictionaryStore.ts` | Per-tab search/browse/entry state (`searchError`, `searchCompleted`), temporary tabs, `openStrongs()`, session persistence |
| `server/routes/dictionaryRoutes.ts` | `/api/dictionary/available`, `/search` (all dictionaries), `/:module/search`, `/:module/letters`, `/:module/browse`, `/:module/adjacent/:key`, `/:module/count`, `/:module/entry/:key` |
| `server/DatabaseManager.ts` | `getDictionaryRepo()` — resolves `dictionary_<name>.db` |
| `packages/core/src/Data/Repositories/DictionaryRepository.ts` | `searchEntries()` (title-first, then full text), entry lookup, browse |
| `packages/core/src/Services/FtsQuery.ts` | `escapeFts5Term()` / `escapeFts5Query()` — shared FTS5 escaping (also used by `BibleSearchService`) |

### Search behavior

- **Title matches lead.** `searchEntries()` first matches `word` / `entry_key`
  (exact, then prefix, then substring), and only fills the remainder of the
  limit with full-text hits, de-duplicated by `entry_id`. It was previously a
  bare FTS5 `MATCH` over word + definition + usage_notes capped at 30, and BM25
  happily ranked a passing mention in a long article above the entry actually
  titled with the search word — searching "Moses" in a dictionary with a MOSES
  entry returned thirty other articles and not that one.
- **Query input is escaped** through `escapeFts5Query()` before reaching
  `MATCH`. Apostrophes, hyphens and FTS5 reserved words ("not", "and") are query
  syntax, so raw input was a SQLite syntax error that surfaced as an HTTP 500.
  Terms needing no quoting are passed through unquoted so they keep the Porter
  stemmer.
- **Module name casing.** `getDictionaryRepo()` tries the name as given, then
  lowercased. Module files on disk are lowercase while the API advertises
  mixed-case abbreviations ("AmTract", "ISBE"), so on a case-sensitive
  filesystem every lookup returned null and the routes answered with an empty
  list.
- **Enter opens the best match.** `highlightedIndex` resets to -1 on every
  suggestion change, so gating Enter on a highlight made it a no-op unless the
  user pressed ArrowDown first; it now falls back to index 0 (the list is
  already sorted by relevance). Applies to both `DictionaryContent` and
  `DictionaryHome`.
- **Empty and failed searches say so.** `searchCompleted` distinguishes "zero
  results" from "not searched yet" and `searchError` carries a failure message;
  either renders a line in the dropdown instead of an empty box, and a failed
  request no longer leaves stale suggestions on screen.
- **Opening a Strong's entry passes `skipBrowse`**, suppressing the automatic
  browse-letter load, and the entry-loading line replaces the browse view — so
  the alphabet bar and its 50-entry word list no longer flash before the
  definition arrives.

## Module Types

- **Bible** - Bible translation modules (KJV, ESV, etc.)
- **Commentary** - Commentary modules
- **Dictionary** - Dictionary modules (used for Strong's lookups)

## Key Behaviors

- Case-insensitive abbreviation matching
- Case-sensitive abbreviation resolution (preserves original casing from database)
- Modules cached after first fetch
- **Fail-safe module visibility**: If neither `site-config.json` nor a legacy `settings.json` is present, no modules are visible (copyright protection). Only modules explicitly listed with `active: true` are served by the API.
- **Section grouping**: `settings.json` defines ordered sections (e.g., "Popular", "All Translations") that the UI uses for module selector dialogs. Falls back to the hardcoded `RECOMMENDED_BIBLES` / `BIBLE_DESCRIPTIONS` / `COMMENTARY_DESCRIPTIONS` in `src/moduleDescriptions.ts` if no settings are configured.
- **Description overrides**: `settings.json` can override a module's shortName, title, and description.
