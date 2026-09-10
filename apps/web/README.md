# @bible/web — Keep Thy Heart Bible Reader (Web)

A Bible study web application built with Preact and Express.  It provides a browser-based application for reading the Bible, reading commentaries, performing searches (keyword and semantic), viewing topics, books, and dictionaries, as well as seeing interlinear and Strong's data (for translations which have this data).

## Prerequisites

  - Node.js 20.19 or newer (24 recommended; `.nvmrc` at the repo root pins it)
  - npm (the version bundled with Node)
  - Module `.db` files (Bible translations, commentaries, dictionaries); `npm run setup:web` downloads a starter set

## Quick Start

From the repo root:

```bash
npm install
npm run setup:web    # build @bible/core, download the starter modules into data/modules,
                     # build data/main.db, and write data/site-config.json if it is missing
npm run dev:web      # the same as `npm run dev -w @bible/web`
```

Open **http://localhost:5173/** in your browser (Vite dev server proxies API to Express on port 3100). The [repository README](../../README.md) covers prerequisites, the module presets and troubleshooting.

> **Important:** If neither `site-config.json` nor a legacy `settings.json` defines any modules, no modules will be visible. This is a deliberate fail-safe for copyright protection. See [Module Visibility](#configuring-visibility-site-configjson) below.

## SQLite Native Module

The web package uses `better-sqlite3` via an npm alias (`better-sqlite3-web`) to keep its native binary separate from the Electron-compiled copy in the desktop package. This prevents `NODE_MODULE_VERSION` conflicts between Electron's Node.js and your system Node.js.

  - **Web server**: uses `better-sqlite3-web` in `apps/web/node_modules/` (compiled for system Node.js)
  - **Desktop app**: uses `better-sqlite3-multiple-ciphers` (compiled for Electron via `@electron/rebuild`)

After `npm install`, the `postinstall` script automatically rebuilds the web copy for your system Node.js. Rebuild it again after switching Node versions, when the init script or the server reports a binding built for a different Node.js:

```bash
# Rebuild just the web copy (system Node.js)
npm run rebuild-sqlite -w @bible/web

# Rebuild the desktop's native modules (Electron); use rebuild-native:force after a NODE_MODULE_VERSION error
npm run rebuild-native -w @bible/desktop
```

## Data Directory Layout

```
data/                              # Repo root, gitignored: the data directory ($BIBLE_DATA_DIR)
  main.db                          # Module registry and Bible book data (built by `npm run init`)
  modules/                         # Module .db files, shared with the desktop app and the test suites
  site-config.json                 # Unified config: modules, auth, features, search, UI (written by `npm run init` if missing)
  settings.json                    # Legacy module whitelist -- read only if site-config.json has no "modules" section
  server-config.json               # Legacy server auth and feature flags -- read only if site-config.json doesn't exist
  search-pipeline.json             # Semantic search config (optional)
  tag_graph.db                     # Entity knowledge graph (optional; not distributed, nothing needs it yet)
  semantic_*.db / *.bin            # Semantic search data (optional)
  models/                          # Self-hosted embedding model for browser search (optional)

apps/web/data/                     # Gitignored: what this server instance writes for itself
  logs/                            # server.log
  plugin-data/                     # Server-side plugin state
```

Module `.db` files are named with a type prefix: `bible_kjv.db`, `commentary_barnes.db`, `dictionary_easton.db`, `book_institutes.db`, `topical_nave.db`, `xref_tsk.db`.

### Registering Modules

After placing module files in `data/modules/`, run the init script to register them (all from the repo root):

```bash
npm run init                                # Register the .db files in data/modules
npm run init -- --force                     # Recreate main.db from scratch
npm run init -- --prune                     # Remove registry rows whose file is gone
npm run init:modules                        # Download the starter set from the development catalog, then register
npm run init:modules -- --select=KJV,ASV    # Download these modules (or a preset: starter, tests) instead
npm run init -- --catalog=URL               # Choose from a catalog's list interactively (add --yes for CI)
```

`--modules-dir=PATH` and `--data-dir=PATH` point the script at a modules directory or data directory other than the default, which for both is the repo-root `data/`. `npm run init -- --help` lists every option.

### Configuring Visibility (site-config.json)

The `modules` section of `site-config.json` controls which modules are visible and how they are grouped in the UI. If `site-config.json` has no `modules` section (or the file doesn't exist), the server falls back to a legacy standalone `settings.json` in the same data directory; if neither defines any modules, none are visible (fail-safe for copyright protection).

**Option A** — Let `npm run init` write it for you: first-time setup (see [Registering Modules](#registering-modules) above) creates `data/site-config.json`, with a `modules` section built from whatever it found registered, if the file doesn't already exist. The generated file turns the password gate off when no password is set (a password in the example, or `SITE_PASSWORD`, keeps it on), and sets `ui.defaultModule` to KJV when it is installed, otherwise to the first installed Bible. Because it is only written when absent, modules added later must be added to its `modules` section by hand (or delete the file and re-run `npm run init`).

**Option B** — Copy the example and customize (from the repo root):
```bash
cp apps/web/config/site-config.example.json data/site-config.json
```

The `modules` section controls:
  - **Which modules are visible** (`active: true/false`)
  - **Section grouping** (e.g., "Popular", "All Translations")
  - **Display overrides** (custom names, descriptions)
  - **About text** for the app

See `config/site-config.schema.json` for the full schema. Deployments that predate the unified config can keep using a standalone `settings.json` -- see `config/settings.sample.json` and `config/settings.schema.json`.

## Architecture

  - **Server** (`server/`): Express API wrapping `@bible/core` repositories. Runs on port 3100.
  - **Client** (`src/`): Preact SPA with SCSS styling. Vite dev server on port 5173 proxies `/api/*` to Express.
  - **No framework state library** — plain TypeScript store classes with a subscribe/notify pattern.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start both Express API server and Vite dev server (with HMR) |
| `npm run dev:server` | Start only the Express API server (port 3100) |
| `npm run dev:client` | Start only the Vite dev server (port 5173) |
| `npm run build` | Build both server and client for production |
| `npm run build:server` | Compile server TypeScript to `dist/server/` |
| `npm run build:client` | Bundle client with Vite to `dist/client/` |
| `ENABLE_PWA=1 npm run build` | Same, but also builds the service worker and web app manifest. The PWA is **off by default** — see [PWA & Offline](docs/features/pwa-offline.md) |
| `npm run start` | Run the production server (serve built client + API) |
| `npm test` | Run Vitest unit tests |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:e2e` | Run Playwright E2E tests against the API |
| `npm run clean` | Remove `dist/` and Vite cache |
| `npm run rebuild-sqlite` | Rebuild `better-sqlite3-web` for system Node.js |

## Configuration

### Site Config (optional)

`site-config.json` lives in the data directory (`$BIBLE_DATA_DIR`, by default the repo-root `data/`, which is gitignored in its entirety). `npm run init` writes one when there is none; to start from the example instead, copy it there from the repo root:

```bash
cp apps/web/config/site-config.example.json data/site-config.json
```

The example ships with an empty `auth.password`. Set one before starting the
server, or set `auth.enabled` to `false` -- an enabled password gate with no
password configured is a startup error, not a warning. The keys that matter for
a public deployment:

```json
{
  "auth": { "enabled": true, "password": "your-password" },
  "features": { "tagGraph": true },
  "repoUrl": "https://github.com/...",
  "docsUrl": "https://docs.bible.keepthyheart.com/web/"
}
```

`docsUrl` is the documentation website the Help dialog links to. It reaches the
browser through `/api/config`, so **the server picks up a change on restart, not
a rebuild** — there is no build-time equivalent of the desktop app's
`BIBLE_DOCS_URL`. Leave it empty (or omit it) and the Help dialog renders no
link at all rather than a dead one.

### Server Config (legacy)

Deployments that predate `site-config.json` still read `server-config.json` from the same data directory, and it is used only when no `site-config.json` exists:

```json
{
  "sitePassword": "your-password",
  "noAuth": false,
  "showTagGraph": true,
  "docsUrl": "https://docs.bible.keepthyheart.com/web/"
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3100` | Express server port |
| `BIBLE_DATA_DIR` | `data` (repo root) | Data directory (main.db, site-config.json, semantic indexes, etc.) |
| `BIBLE_MODULES_DIR` | `data` (repo root) | Parent of `modules/` directory containing module .db files |
| `NO_AUTH` | — | Set to `1` to disable password gate |
| `SITE_PASSWORD` | — | Override password (alternative to server-config.json) |

### Branding

The product name, tagline and theme colour are not written in `index.html`. They live in `admin/brand/branding.json` at the repo root, and `brandingPlugin()` in `vite.config.ts` substitutes them into the HTML shell and the PWA manifest at build time. The tracked `index.html` keeps `%BRAND_*%` placeholders and is never rewritten on disk, so building produces nothing to commit.

To rebrand a fork, do not edit `branding.json` -- add `admin/brand/branding.local.json` next to it containing only the keys you want to change:

```json
{
  "productName": "My Bible Reader",
  "productNameShort": "My Reader",
  "themeColor": "#a3121b"
}
```

Keys you leave out fall through to `branding.json`. The overlay is already gitignored by the root `*.local.*` rule, so a rebranded fork never modifies a tracked file and never conflicts when merging from upstream. A placeholder with no matching key fails the build rather than shipping the raw `%BRAND_...%` token.

The app icon and the reading fonts are third-party assets with attribution obligations; `admin/THIRD-PARTY-NOTICES.md` records them, and both generators write the credit into the files they emit so it ships with the build.

These values are locale-invariant. Translatable copy belongs in `src/locales/<lng>/`; the shell strings above are the exception, because they must render before any JavaScript runs and so can only carry one language. Translating them would need the Express server to inject them per request from `Accept-Language`, which is not implemented.

## API Endpoints

### Core

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check — returns `{ status: 'ok' }` |
| `GET /api/version` | App version — returns `{ version }` from package.json |
| `GET /api/books` | List all 66 Bible books |
| `GET /api/modules` | List installed modules (optional `?type=bible\|commentary`) |
| `GET /api/modules/:name/info` | Get download info for a module (size, availability) |
| `GET /api/modules/:name/download` | Download a module `.db` file |

### Bible

| Endpoint | Description |
|---|---|
| `GET /api/bible/:module/:book/:chapter` | Get chapter verses with formatted HTML |
| `GET /api/bible/:module/verse/:verseId` | Get a single verse by ID |
| `GET /api/bible/topics/:book` | Get topical index entries for a book |
| `GET /api/bible/votd` | Get verse of the day |

### Commentary

| Endpoint | Description |
|---|---|
| `GET /api/commentary/:module/:book/:chapter` | Get commentary entries for a chapter |
| `GET /api/commentary/availability/:book/:chapter` | Check which modules have commentary for a chapter |
| `GET /api/commentary/home/:book/:chapter` | Get combined commentary from all available modules |
| `GET /api/commentary/:module/chapter-verses/:book/:chapter` | Get per-verse commentary entries for a chapter |

### Search

| Endpoint | Description |
|---|---|
| `GET /api/search/keyword?q=...` | Full-text keyword search (optional `&modules=KJV,ESV&pageSize=50`) |
| `GET /api/search/semantic?q=...` | Semantic vector search (optional `&maxResults=20&hybrid=true&modules=KJV`) |
| `POST /api/search/semantic/warmup` | Warm up the semantic search pipeline |
| `GET /api/search/strongs?number=G25` | Search by Strong's number (optional `&includeRelated=true&modules=KJV&scope=43`) |

### Reference Tools

| Endpoint | Description |
|---|---|
| `GET /api/strongs/:number` | Look up a Strong's dictionary entry (e.g. `G2316`) |
| `GET /api/interlinear/:book/:chapter` | Get interlinear word data with Strong's numbers |
| `GET /api/xref/:module/:verseId/groups` | Get cross-reference groups for a verse |
| `GET /api/xref/:module/:verseId/count` | Get cross-reference count for a verse |

### Dictionary

| Endpoint | Description |
|---|---|
| `GET /api/dictionary/available` | List available dictionary modules |
| `GET /api/dictionary/:module/search?q=...` | Search dictionary entries |
| `GET /api/dictionary/:module/entry/:key` | Look up a dictionary entry by key |

### Topical Index

| Endpoint | Description |
|---|---|
| `GET /api/topical/verse/:verseId` | Get topics associated with a verse |
| `GET /api/topical/:module/topic/:topicId` | Get a topic by ID |
| `GET /api/topical/:module/topic/:topicId/children` | Get child topics |
| `GET /api/topical/:module/topic/:topicId/verses` | Get verses for a topic |
| `GET /api/topical/search?q=...` | Search topics across modules |

### Tag Graph (Entity Knowledge Graph)

| Endpoint | Description |
|---|---|
| `GET /api/taggraph/verse/:verseId` | Get entities (people, places, themes) associated with a verse |
| `GET /api/taggraph/entity/:category/:entityId` | Get full details for an entity |
| `GET /api/taggraph/entity/:category/:entityId/associations` | Get associations for an entity |
| `GET /api/taggraph/entity/:category/:entityId/verses` | Get verses for an entity |
| `GET /api/taggraph/entity/:category/:entityId/facets` | Get facets for an entity |
| `GET /api/taggraph/search?q=...` | Search entities (optional `&categories=people,places`) |
| `GET /api/taggraph/topic-link/:sourceModule/:topicId` | Reverse lookup: topical index topic to tag graph entity |

## Testing

### Prerequisites

**API/integration tests** require actual module databases to run against. With neither `BIBLE_DATA_DIR` nor `BIBLE_MODULES_DIR` set, the suites use the repo-root `data/` -- the same directory the server reads -- so `npm run setup:web` covers most of them, and `npm run init:modules -- --select=tests` (from the repo root) installs every module a suite names. Point `BIBLE_DATA_DIR` at another data directory (and `BIBLE_MODULES_DIR` too, if `modules/` lives elsewhere) to use that instead. Either way that directory must contain:

- `main.db` — Module registry and Bible book data (built by `npm run init`)
- `modules/bible_kjv.db` — KJV Bible module (required for Bible, search, interlinear tests)
- `modules/commentary_barnes.db` — Barnes commentary (required for commentary tests)
- `modules/commentary_clarke.db` — Clarke commentary (`api.test.ts` pins Clarke entries by name)
- `modules/dictionary_strongsgreek.db` — Strong's Greek dictionary (required for Strong's tests)
- `modules/dictionary_strongshebrew.db` — Strong's Hebrew dictionary

If these files are missing, the corresponding API tests will fail or skip themselves; `npm run init` lists what is missing and what that costs. Client-side unit tests (stores, utils, providers) use mocks and do not require database files.

### Running Tests

```bash
# Unit tests (stores, providers, API routes via supertest)
npm test

# E2E tests (starts server automatically via Playwright)
npm run test:e2e

# Both
npm test && npm run test:e2e
```

### Test Structure

- **`src/__tests__/`** — Client-side unit tests (stores, providers, utilities). Run in happy-dom environment.
- **`server/__tests__/`** — Server-side unit and integration tests (API routes, utilities, settings). Run in Node environment using supertest.
- **`e2e/tests/`** — Playwright E2E tests targeting the running server across multiple browser/device profiles.

## Project Structure

```
apps/web/
├── server/                  # Express API server
│   ├── index.ts             # Entry point, route mounting
│   ├── DatabaseManager.ts   # SQLite connection manager
│   ├── core.ts              # CJS→ESM bridge for @bible/core
│   ├── routes/              # API route handlers
│   │   ├── bibleRoutes.ts
│   │   ├── commentaryRoutes.ts
│   │   ├── crossRefRoutes.ts
│   │   ├── dictionaryRoutes.ts
│   │   ├── interlinearRoutes.ts
│   │   ├── moduleRoutes.ts
│   │   ├── searchRoutes.ts
│   │   ├── strongsRoutes.ts
│   │   ├── tagGraphRoutes.ts
│   │   └── topicalRoutes.ts
│   ├── providers/
│   │   └── SqliteProvider.ts # Uses 'better-sqlite3-web' alias (see SQLite section)
│   ├── types/
│   │   └── better-sqlite3-web.d.ts
│   ├── utils/
│   │   └── formatVerseText.ts
│   └── __tests__/
│       ├── api.test.ts      # API integration tests (supertest)
│       ├── consolidateResults.test.ts
│       ├── validation.test.ts
│       ├── errorResponse.test.ts
│       └── siteSettings.test.ts
├── src/                     # Preact client app
│   ├── main.tsx             # Entry point, store initialization
│   ├── App.tsx              # Root component, layout
│   ├── types.ts             # Client-side type definitions
│   ├── constants.ts         # Book names, chapter counts
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── ReferenceInput.tsx
│   │   ├── SearchInput.tsx
│   │   ├── BiblePane/       # Bible text display
│   │   ├── CommentaryPane/  # Commentary sidebar
│   │   ├── Search/          # Search results panel
│   │   ├── Dialogs/         # Settings, copy, Strong's popups
│   │   └── common/          # Shared UI components
│   ├── stores/              # State management (subscribe/notify)
│   │   ├── Store.ts         # Base store class
│   │   ├── bibleStore.ts    # Tabs, navigation, history
│   │   ├── commentaryStore.ts
│   │   ├── searchStore.ts
│   │   ├── settingsStore.ts # Theme, fonts, persistence
│   │   └── moduleStore.ts   # Available modules/books
│   ├── hooks/
│   │   └── useStore.ts      # Preact hook for store subscriptions
│   ├── providers/           # Data access abstraction
│   │   ├── interfaces.ts
│   │   └── ServerDataProvider.ts
│   ├── styles/
│   │   └── main.scss        # All styles, CSS custom properties, 3 themes
│   └── __tests__/
│       ├── stores.test.ts
│       ├── ServerDataProvider.test.ts
│       └── utils.test.ts
├── e2e/                     # Playwright E2E tests
│   ├── playwright.config.ts
│   └── tests/
│       └── api-e2e.spec.ts
├── index.html               # Vite HTML entry
├── vite.config.ts           # Vite + Vitest config
├── tsconfig.json            # Client TypeScript config
├── tsconfig.server.json     # Server TypeScript config
└── package.json
```
