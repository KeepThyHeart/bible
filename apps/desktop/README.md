# @bible/desktop

Electron desktop application for Bible study, built with React, Zustand, and Tailwind CSS. This is the primary UI package in the monorepo, consuming `@bible/core` for data access and business logic.

## Prerequisites

- **Node.js** 20.19 or newer (24 recommended; `.nvmrc` at the repo root pins it)
- **npm** (the version bundled with Node)
- Module database files in `apps/desktop/data/modules/` (e.g., `bible_kjv.db`); `npm run setup` links that directory to the shared repo-root `data/modules/` and downloads a starter set into it

## Setup

From the monorepo root:

```bash
npm install
npm run setup              # Build @bible/core, download the starter modules, init:desktop, Electron rebuild
npm run dev
```

The [repository README](../../README.md) covers prerequisites, the module presets and troubleshooting. The desktop-specific steps of `npm run setup` are:

- **`npm run init:desktop`** builds `apps/desktop/data/main.db` and links `apps/desktop/data/modules` to the repo-root `data/modules` (a directory junction on Windows, a relative symlink elsewhere), so the desktop, the web app and the test suites share one set of module files. `npm run init -- --target=desktop --no-link` keeps a separate copy instead.
- **`npm run rebuild-sqlite`** runs this package's `rebuild-native` script (`@electron/rebuild --only better-sqlite3-multiple-ciphers`), which installs the Electron build of the SQLite driver for Electron's Node ABI. That package publishes prebuilt Electron binaries, so this is normally a download; it compiles only when none matches. It skips the driver when it already looks built. It is the only module rebuilt: `keytar` (optional, used only to migrate an encryption key from older installs) and `onnxruntime-node` are Node-API modules, which load in Electron as installed.

The app also creates and migrates `apps/desktop/data/main.db` itself on first run (`electron/utils/initMainDatabase.ts`), and any module `.db` files found in `apps/desktop/data/modules/` are registered at startup (`electron/utils/moduleDetector.ts`). Adding a module is therefore a matter of dropping the file into the shared `data/modules/` and restarting.

If the app fails with a `NODE_MODULE_VERSION` error, a native module is built for system Node rather than Electron (for example after `npm rebuild better-sqlite3-multiple-ciphers` for the unit tests). Force the Electron rebuild:

```bash
npm run rebuild-native:force -w @bible/desktop
```

## Development

```bash
# From monorepo root
npm run dev                # Start Electron app in dev mode (electron-vite)
```

`predev` first fetches the self-hosted fonts (`scripts/fetch-fonts.mjs`) and generates the app icons. The fonts are not committed, so the first run needs network access. The Google Fonts families are required, and the script stops with instructions if they cannot be downloaded; Ezra SIL (Hebrew) is optional, and when its host is unreachable the script only warns and retries after 24 hours (`npm run fonts -w @bible/desktop -- --force` retries now).

In dev mode, logs go to the terminal where you launched the command. The renderer supports hot module replacement via Vite.

**Important:** If you change files in `packages/core/src/`, you must rebuild core before restarting:

```bash
npm run build:core && npm run dev
```

## Building and Packaging

```bash
npm run build:desktop      # Build for production (electron-vite build)

# Package for distribution
cd apps/desktop
npm run package:win        # Windows
npm run package:mac        # macOS
npm run package:linux      # Linux
```

There are three electron-builder configs:

| Config | Used by | Ships |
| --- | --- | --- |
| `electron-builder.curated.yml` | `npm run package:{win,mac,linux}` | The default offline module set staged into `build-data/` (KJV, Commentary Synthesis, Matthew Henry, Strong's Greek + Hebrew, ISBE). |
| `electron-builder.yml` | `npm run package:lean:{win,mac,linux}` | A lean KJV-only build straight out of `data/`. |
| `electron-builder.code-only.yml` | `npm run package:code-only:{win,mac,linux}` | The application plus `main.db` and no content modules, so it builds from a bare checkout with no external assets. |

All three `extends: file:electron-builder.branding.cjs` for the product name.

### What ends up where

- **`resources/app.asar`** - `out/` (main, preload, renderer bundles) plus the production `node_modules` closure. `asar: true` is only possible because `electron.vite.config.ts` **bundles** `@bible/core` into `out/main/index.js`: it is an npm-workspace symlink whose real files live outside `apps/desktop`, and electron-builder's asar packager refuses to archive those. `@bible/core` is therefore a **devDependency**; moving it to `dependencies` breaks packaging with `"packages/core/LICENSE must be under apps/desktop/"`.
- **`resources/app.asar.unpacked`** - native binaries only (~136 files): `better-sqlite3-multiple-ciphers`, `keytar`, the ONNX Runtime bindings and `sharp`'s libvips. `.node`/`.dll` files cannot be `dlopen`'d from inside an archive. Unpacking is scoped to the directories that actually hold binaries; do **not** widen it to whole modules (see the comments in the curated config).
- **`resources/locales`** - the shipped UI catalogs, discovered at runtime by `electron/ipc/i18nHandlers.ts` scanning `process.resourcesPath/locales`. They are `extraResources`, i.e. plain files *outside* the asar, so directory enumeration works normally.
- **`resources/data`** - bundled Bible/commentary/dictionary module databases.
- **`resources/LICENSE`, `THIRD-PARTY-NOTICES.md`, `FONT-LICENSES.md`** - the GPL-3.0 and OFL notices that must accompany the distributed binary.

### Packaging gotchas

- **Never add a `- from: node_modules / to: node_modules` entry to `files`.** An explicit `from:` mapping makes electron-builder copy `node_modules` verbatim and bypass its production-dependency walk, so every devDependency (vitest, Playwright, Vite, electron-builder, Tailwind, `@types/*` - ~479 packages transitively) lands inside `app.asar`. Express exclusions as top-level negations anchored at `node_modules/...` instead; patterns inside a `from:` filter are relative to that directory and silently miss every npm-hoisted package, which in this monorepo is most of them.
- **Never filter an `extraResources` directory with `'**/*.json'`.** The matcher tests directory entries too; `en/`, `pt-BR/`, ... do not match `*.json`, so the walk is pruned at the root and **nothing** is copied - silently, with a zero exit code. Use `'**/*'`.
- **Windows `MAX_PATH`.** NSIS cannot create paths longer than 260 characters at install time and drops them silently, while electron-builder's long-path-aware packager writes them into `win-unpacked` fine - so the installed app can be missing files that the unpacked directory has. `asar: true` is the fix: the deepest installed path drops from ~266 to ~205 characters. Keeping pure-JS dependency chains *inside* the archive is what buys that, which is why `asarUnpack` is scoped narrowly (`app.asar.unpacked/` is 13 characters longer than `app/`, so over-unpacking reintroduces the problem).

## Build Configuration

A few user-visible values are not finalised yet, so they are supplied by environment variables at build time and baked into the bundles. All of them have safe fallbacks, so `npm run build` works with none of them set.

| Variable | Default | Effect |
| --- | --- | --- |
| `BIBLE_PRODUCT_NAME` | `Keep Thy Heart Bible Reader` | Product name used for the window title, the page `<title>`, the app header, the About dialog, and the installer (`productName` / NSIS shortcut). |
| `BIBLE_ISSUE_REPORT_URL` | *(empty)* | Where the "Report an Issue" command sends the user. Accepts an `https://` issue-tracker URL **or** a `mailto:` address (a subject line with the product name and version is pre-filled for `mailto:`). When empty the command is not registered at all, so it never appears in the command palette or the Help menu - no dead links. |
| `BIBLE_MODULE_CATALOG_URL` | `moduleRepositoryUrl` from `admin/brand/branding.json` (`https://modules.bible.keepthyheart.com/`), or empty while that key is listed in `_undecided` | Default module catalog/repository URL. When set it is seeded as the official repository on first run and used as the URL placeholder in Repository Settings. It may name a catalog, or a directory serving an `index.json` of catalogs (as the official site root does); each listed catalog is added on refresh. When empty no repository is seeded and the UI explains that modules can be dropped into `data/modules` instead. |
| `BIBLE_COPYRIGHT_YEAR` | year of the build | Copyright year shown in the About dialog. |
| `BIBLE_APP_VERSION` | `version` from `package.json` | Version embedded in the `mailto:` issue-report subject, and shown at the foot of the Help panel. |
| `BIBLE_DOCS_URL` | `https://docs.bible.keepthyheart.com/desktop/` | Documentation website. The Help panel offers a "Documentation website" row that opens it in the OS browser. Set it to `none` for a build with no docs site: the row is then omitted entirely - same rule as the issue tracker, no dead links. |
| `BIBLE_ABOUT_TEXT` | *(empty)* | A sentence or two about this build, shown at the top of the Help panel. Passed through as written and **not** translated, since it arrives as one already-authored string. |

Example:

```bash
BIBLE_PRODUCT_NAME="Scriptorium" \
BIBLE_ISSUE_REPORT_URL="mailto:support@example.org" \
BIBLE_MODULE_CATALOG_URL="https://modules.example.org/" \
BIBLE_DOCS_URL="https://docs.example.org/" \
BIBLE_ABOUT_TEXT="A modern, open-source Bible study app." \
npm run build -w @bible/desktop
```

The values are read once in `electron.vite.config.ts` and injected as build-time defines; `electron/config/appConfig.ts` is the single source of truth that resolves them (define -> `process.env` -> fallback) for the main process, and the preload bridge hands the resolved object to the renderer as `window.electron.appConfig` (see `src/ui/config/appConfig.ts`).

The installer's `productName` / NSIS shortcut name are read from the same `BIBLE_PRODUCT_NAME` variable by `electron-builder.branding.cjs`, which both `electron-builder.yml` and `electron-builder.curated.yml` pull in with `extends:` (electron-builder does not expand environment variables inside YAML values, so a JS parent config is required).

## Testing

```bash
# Unit tests (vitest)
npm run test -w @bible/desktop
npm run test:watch -w @bible/desktop
npm run test:coverage -w @bible/desktop

# E2E tests (Playwright + Electron), from the repo root
npm run build:desktop                      # Builds core and desktop; postbuild runs @electron/rebuild
npm run test:e2e -w @bible/desktop
```

Some unit suites drive real SQLite and skip themselves unless `better-sqlite3-multiple-ciphers` is built for system Node (`npm rebuild better-sqlite3-multiple-ciphers`). Run `npm run rebuild-native:force -w @bible/desktop` afterwards to restore the Electron build before `npm run dev`.

See [`e2e/README.md`](e2e/README.md) for E2E test details, conventions, and troubleshooting.

## Architecture

### Process Model

The app uses Electron's two-process architecture:

```
+---------------------------------+
|  Main Process (Node.js)         |
|  electron/main.ts               |
|  +-- ipc/         IPC handlers  |
|  +-- extensions/  Extension host|
|  +-- providers/   SqliteProvider|
|  +-- services/    WindowManager |
|  +-- menu/        App menus     |
|  +-- utils/       DB init, paths|
+----------+----------------------+
           | IPC (invoke/handle)
+----------v----------------------+
|  Renderer Process (Browser)     |
|  src/ui/                        |
|  +-- components/  React UI      |
|  +-- stores/      Zustand state |
|  +-- services/    electronAPI   |
|  +-- styles/      CSS/Tailwind  |
+---------------------------------+
```

### Main Process (`electron/`)

- **`main.ts`** -- App lifecycle, window creation, IPC handler registration
- **`ipc/`** -- IPC handlers for each domain (bible, commentary, dictionary, search, sessions, etc.), plus the channel allowlist and the `Result<T>` envelope
- **`providers/SqliteProvider.ts`** -- `ISql` implementation using `better-sqlite3`, shared across all handlers
- **`services/WindowManager.ts`** -- Multi-window management for pop-out panes
- **`menu/menuBuilder.ts`** -- Turns the renderer-supplied menu spec into the Electron application menu

### Renderer Process (`src/ui/`)

- **`App.tsx`** -- Root component with session restore, global shortcuts, and dialog management
- **`components/`** -- React components for each pane (BiblePane, CommentaryPane, DictionaryPane, NotesPane, SearchPane, etc.)
- **`stores/`** -- Zustand stores for state management (one per domain: `useBibleStore`, `useCommentaryStore`, `useSearchStore`, etc.)
- **`services/electronAPI.ts`** -- Typed wrappers around `window.electron` IPC calls
- **`styles/`** -- Tailwind CSS configuration, theme variables, and component styles

### Key Technologies

| Layer       | Technology                                      |
|-------------|------------------------------------------------|
| Desktop     | Electron 33                                    |
| UI          | React 18                                       |
| State       | Zustand 5                                      |
| Styling     | Tailwind CSS 3                                 |
| Rich Text   | TipTap (notes, documents)                      |
| Layout      | Dockview (flexible pane system)                |
| Database    | better-sqlite3 via `@bible/core` ISql interface|
| Bundler     | electron-vite (Vite-based)                     |
| E2E Tests   | Playwright                                     |
| Unit Tests  | Vitest                                         |
| Logging     | electron-log                                   |

## Project Structure

```
apps/desktop/
+-- electron/                    # Main process
|   +-- main.ts                  # Entry point
|   +-- preload.ts               # Preload bridge (window.electron API surface)
|   +-- ipc/                     # IPC channel definitions and handlers (bible, commentary, search, ...)
|   +-- providers/               # SqliteProvider / EncryptedSqliteProvider (ISql implementations)
|   +-- services/                # WindowManager, module/download/diagnostics/backup services, ...
|   +-- schema/                  # SQL schema definitions (search index, user db)
|   +-- extensions/              # Extension host: lifecycle, registry, RPC, API implementations
|   +-- menu/                    # Application menu builder
|   +-- config/                  # App and pane configuration
|   +-- utils/                   # DB initialization, path helpers, validation
+-- extension-runtime/           # Third bundle target: the QuickJS sandbox extensions run in
|   +-- host/                    # Runs in the main process (QuickJSRealm - the WASM realm itself)
|   +-- guest/                   # Bundled separately; the api.* proxy and globals the extension code sees
+-- src/
|   +-- ui/                      # Renderer process
|       +-- App.tsx              # Root component
|       +-- components/          # All React components
|       +-- stores/              # Zustand state stores
|       +-- services/            # IPC API wrappers
|       +-- commands/            # Command palette command definitions
|       +-- styles/              # CSS and Tailwind
|       +-- utils/               # UI utilities
+-- data/                        # Runtime data (gitignored)
|   +-- main.db                  # Reference database
|   +-- modules/                 # Module database files (a link to the repo-root data/modules; see Setup)
+-- build-data/                  # Staged offline module set for the curated packaged build
+-- locales/                     # UI translation catalogs (one folder per locale) plus i18n tooling docs
+-- sql/                         # Standalone SQL (e.g. user_db_extensions.sql)
+-- scripts/                     # Build/dev scripts: font fetch, i18n extract/validate/pseudo-localize
+-- resources/                   # App icons and vendored third-party notices bundled into the installer
+-- docs/                        # Feature documentation
|   +-- features/                # Per-feature file listings
+-- e2e/                         # Playwright E2E tests
+-- electron-builder.yml         # Packaging configuration (lean build)
+-- electron-builder.curated.yml # Packaging configuration (default offline module set)
+-- electron-builder.code-only.yml # Packaging configuration (code and main.db only)
+-- electron.vite.config.ts      # electron-vite bundler configuration
+-- tailwind.config.cjs          # Tailwind CSS configuration
+-- tsconfig.json                # TypeScript configuration
```

## Logging

The app uses `electron-log` for automatic log file management:

| Platform | Log Location |
|----------|-------------|
| Linux    | `~/.config/bible-desktop-app/logs/main.log` |
| macOS    | `~/Library/Logs/bible-desktop-app/main.log` |
| Windows  | `%APPDATA%/bible-desktop-app/logs/main.log` |

In dev mode (`npm run dev`), logs go to the terminal stdout instead of log files.

## Further Documentation

- **Feature Docs** -- [`docs/README.md`](docs/README.md) lists every feature with its relevant files
- **E2E Tests** -- [`e2e/README.md`](e2e/README.md) for Playwright test setup and conventions
- **Core Library** -- [`../../packages/core/README.md`](../../packages/core/README.md) for the data access and business logic layer

## License

GPL-3.0-or-later. See the [repo-root `LICENSE`](../../LICENSE) file for the full text.
