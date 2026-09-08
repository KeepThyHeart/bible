# Electron Shell

**Last verified:** 2026-09-08

Main process setup, IPC registration, window management, menus, and database providers.

## Files

### Main Process Core

| File | Description |
|---|---|
| `electron/main.ts` | Electron entry point; app lifecycle, window creation, IPC registration, database initialization, extension-host bootstrap |
| `electron/preload.ts` | Preload script exposing IPC channels to renderer via `contextBridge`. It also carries the `declare global` block that types `window.electron` for the renderer, and hands `APP_CONFIG` across as `window.electron.appConfig` |
| `electron/ipc/allowedChannels.ts` | Allow-list of every `invoke`/`send` channel the preload bridge will forward |
| `electron/ipc/index.ts` | Central IPC handler registration; imports and registers all handler modules |
| `electron/ipc/handler-helper.ts` | `ipcHandler` - the wrapper around `ipcMain.handle` that gives every reply a `Result<T>` envelope, classifies errors and logs each class at the right severity |
| `electron/ipc/result.ts` | The `Result<T>` envelope itself. Deliberately free of Electron/Node imports so both the main process and the renderer bundle can import it |
| `electron/ipc/blessedPaths.ts` | Registry of paths the renderer is allowed to name on the absolute-path channels (`file-notes:read-note-absolute`, `file-notes:save-note-absolute`, `module:install-from-path`), so a compromised renderer cannot read or write arbitrary files through them |

### Window Management

| File | Description |
|---|---|
| `electron/services/WindowManager.ts` | Creates and manages BrowserWindow instances, including detached pane windows |
| `electron/services/WindowStateService.ts` | Persists the main window's size/position/maximized state to `{userData}/window-state.json`; maximized is the first-run default |
| `electron/utils/windowSecurity.ts` | Navigation and window-open hardening applied to every `BrowserWindow`: `will-navigate` allows only the app's own origin, and `setWindowOpenHandler` denies child windows, so a sanitizer miss cannot navigate a window that holds the preload bridge |

The main window opens **maximized** on a fresh install and thereafter reopens however the user left it. `WindowStateService` validates everything it reads: a corrupt file falls back to 1400x900 maximized, and a saved position that no longer lands on a connected display is dropped so the window is centred rather than stranded on an unplugged monitor. It saves `getNormalBounds()` - never `getBounds()` - so a maximized window still remembers a usable restore size. Persistence is **off under `NODE_ENV=test`** (`options.enabled ?? process.env.NODE_ENV !== 'test'`): the e2e suite asserts on pane layout, which moves when the window fills whatever display CI happens to have, so tests keep a fixed non-maximized 1400x900 window.

### Menus

| File | Description |
|---|---|
| `electron/menu/menuSpec.ts` | The serializable `MenuSpec` type exchanged between renderer and main. Separators, role items, command items and submenus only - no `click` callbacks |
| `electron/menu/menuBuilder.ts` | Main-process side: converts a renderer-supplied `MenuSpec` into `MenuItemConstructorOptions[]` and calls `Menu.setApplicationMenu`. Command items dispatch `commands:execute` back to the originating window |
| `src/ui/menu/buildMenuSpec.ts` | Renderer side, and the source of truth for menu contents - builds the `MenuSpec` from the command registry, i18n service and keybinding service |

### Configuration

| File | Description |
|---|---|
| `electron/config/appConfig.ts` | Build-time app configuration - the authoritative resolution of product name, version, copyright year, issue-report target, module catalog URL, docs site and About blurb (see "Build-time configuration" below) |
| `electron/config/constants.ts` | Numeric and default constants for the main process, including the diagnostics queue/upload settings and the build-time diagnostics endpoint and token (see [diagnostics-reporting.md](diagnostics-reporting.md)) |
| `electron/config/paneConfig.ts` | Per-`PaneType` configuration for detached windows - default size and window title. Deliberately a shorter list than `PanelContentType`: a dictionary detaches as a Books window and `paneKind` in the payload is what titles it a dictionary |
| `src/ui/config/appConfig.ts` | Renderer accessor: prefers `window.electron.appConfig` from the preload bridge, falls back to the same module's build-time resolution. Exposes `getAppConfig()`, `getProductName()`, `getIssueReportUrl()`, `getDocsUrl()`, `getAboutText()`, `getModuleCatalogUrl()` |
| `electron.vite.config.ts` | Reads the `BIBLE_*` environment variables at build time and bakes them in as `__BIBLE_*__` defines for the main, preload and renderer bundles; also substitutes `%BIBLE_PRODUCT_NAME%` in the entry HTML |

### Database Providers

| File | Description |
|---|---|
| `electron/providers/SqliteProvider.ts` | better-sqlite3 wrapper implementing ISql; WAL mode, foreign keys, pragmas |
| `electron/providers/EncryptedSqliteProvider.ts` | Encrypted SQLite provider for secure user data |
| `electron/services/sharedMainDb.ts` | Singleton for the shared main.db connection |
| `electron/services/sharedUserDb.ts` | Singleton for the shared user database connection |
| `electron/schema/userSchema.ts` | Centralized DDL for every `user_*.db` table, applied idempotently by `initializeUserSchema()`; handlers carry no inline DDL |
| `electron/schema/searchSchema.ts` | Centralized DDL for the search tables applied to main.db - FTS index, metadata, positions, saved searches, history |

### Utilities

| File | Description |
|---|---|
| `electron/utils/appPaths.ts` | Resolves application data paths (databases, modules, user data) and the window/taskbar icon (`resolveAppIconPath()`, used for the `BrowserWindow` `icon` option) |
| `electron/utils/platform.ts` | Platform detection utilities |
| `electron/utils/initMainDatabase.ts` | Initializes main.db schema and reference data |
| `electron/utils/moduleDetector.ts` | Scans for installed module database files |
| `electron/utils/verseIndexing.ts` | Server-side verse indexing utilities |
| `electron/utils/encryptionKeyManager.ts` | Encryption key management |
| `electron/utils/networkPolicy.ts` | The shared HTTP policy for the two places the app fetches a user-supplied URL (`ModuleCatalogService`, `DownloadService`): `http:`/`https:` only, at most `NETWORK_MAX_REDIRECTS` hops, and no `https:` -> `http:` downgrade |
| `electron/utils/ipcBreadcrumb.ts` | `withBreadcrumb` - records each IPC invocation in the diagnostics ring buffer without serializing arguments |

### Renderer Entry Points

| File | Description |
|---|---|
| `src/ui/main.tsx` | Main renderer entry point |
| `src/ui/detached.tsx` | Entry point for detached pane windows |

### Services (Renderer)

| File | Description |
|---|---|
| `src/ui/services/electronAPI.ts` | Typed wrappers around `window.electron.ipcRenderer` for all IPC calls |

## Build-time configuration

A handful of user-visible values are baked in at build time rather than hard-coded, so a maintainer can brand and point the app without touching source. `electron/config/appConfig.ts` resolves each one in this order: the electron-vite `define` (which read the environment variable at build time), then `process.env` at runtime (main process and Node-hosted tests only - the sandboxed renderer has no `process`), then a hard-coded fallback. The module is deliberately dependency-free (no `electron` import) so the main process, the preload bundle, the renderer bundle and plain Vitest runs can all load it.

| Env var | `AppConfig` field | Used by |
|---|---|---|
| `BIBLE_PRODUCT_NAME` | `productName` | Window titles, wordmark tooltip, About and documentation dialogs, Help panel footer |
| `BIBLE_APP_VERSION` | `appVersion` | Help panel footer, documentation dialog footer, `mailto:` issue subject |
| `BIBLE_COPYRIGHT_YEAR` | `copyrightYear` | About dialog |
| `BIBLE_ISSUE_REPORT_URL` | `issueReportTarget` | "Report an Issue" command and the Help panel's issue row |
| `BIBLE_MODULE_CATALOG_URL` | `moduleCatalogUrl` | Seeded repository / Repository Settings placeholder |
| `BIBLE_DOCS_URL` | `docsUrl` | The Help panel's "Documentation website" row, opened via the `app:open-external` IPC. Defaults to `DEFAULT_DOCS_URL` (`https://docs.bible.keepthyheart.com/desktop/`); `none` removes the row |
| `BIBLE_ABOUT_TEXT` | `aboutText` | The blurb at the top of the Help panel; passed through untranslated |

Three further build-time variables are read by `electron.vite.config.ts` but do not belong to `AppConfig`: `BIBLE_BUILD_ID` (`__BIBLE_BUILD_ID__`, the source revision attached to diagnostics reports) and `BIBLE_DIAGNOSTICS_URL` / `BIBLE_DIAGNOSTICS_TOKEN`, which land in `electron/config/constants.ts`. See [diagnostics-reporting.md](diagnostics-reporting.md).

The user-facing table with defaults and an example invocation is in `apps/desktop/README.md` (Build Configuration).

**Unset means absent, never dead.** The affordance-bearing values (`issueReportTarget`, `moduleCatalogUrl`, `aboutText`) default to the empty string; `docsUrl` defaults to `DEFAULT_DOCS_URL` and opts out only on the literal value `none`; `productName` and `copyrightYear` have real fallbacks (`DEFAULT_PRODUCT_NAME`, which is `"Keep Thy Heart Bible Reader"`, and the current year). The predicates `isIssueReportingConfigured()`, `isModuleCatalogConfigured()` and `isDocsSiteConfigured()` exist so callers can *omit* the affordance rather than offer one that goes nowhere - the issue command is not registered at all, and the Help panel drops the docs-site row. `buildIssueReportUrl()` turns a `mailto:` target into a link with the product name and version pre-filled as the subject, unless the configured value already carries a query string. See `onboarding.md` for the Help panel itself and `diagnostics-reporting.md` for issue reporting.

## The product mark

The logo is the Font Awesome Free "book-bible" **solid** glyph, CC-BY-4.0, with the attribution in `admin/THIRD-PARTY-NOTICES.md` under "The app icon".

`admin/brand/icon.svg` is the source artwork - it carries the attribution inline, and `scripts/generate-icons.js` regenerates `resources/icon.svg`, `resources/icon.png` (512x512, the Linux/AppImage icon) and `resources/icon.ico` (multi-size Windows icon) from it. `icon.ico` and `icon.png` are the packaged window/taskbar icons, resolved at runtime by `resolveAppIconPath()`; each `electron-builder*.yml` copies `resources/icon.png` into the packaged `resources/` directory for that purpose. `resources/` is also electron-builder's `buildResources` directory, so the same `icon.png` separately feeds the installer and the `.desktop` entry.

`App.tsx`'s `AppWordmark` inlines that same path - `viewBox="0 0 448 512"`, `fill="currentColor"` so it takes the accent colour - rather than pulling in an icon font, matching the OS window icon, the web app's header and every favicon.
