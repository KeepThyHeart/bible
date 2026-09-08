# Module Management

**Last verified:** 2026-09-08

Browsing, downloading, and managing Bible, Commentary, Dictionary, and Book modules.

## Files

Related: **starter packs** (language-scoped content recommendations) are typed by `packages/core/src/Data/Core/StarterPackTypes.ts` and arrive as declared data in the `starter_packs` array of a fetched repository catalog; nothing in this repo emits one. See `docs/features/onboarding.md` for the first-run UI that surfaces them.

### Components

| File | Description |
|---|---|
| `src/ui/components/ModuleManagerDialog.tsx` | Main module manager dialog for browsing and installing modules. Also hosts the "Upload Module" file dialog (multi-select + pack-archive support), drag-and-drop install, and the inline `ModulePackSummaryPanel` that reports per-module install results for a batch/pack import |
| `src/ui/components/ModuleList.tsx` | List view of available/installed modules |
| `src/ui/components/ModuleCard.tsx` | Card display for an individual module, including uninstall (with the `removeUserData` choice) |
| `src/ui/components/RepositorySettings.tsx` | Add, remove, enable/disable and re-point module repositories, and force a catalog refresh |
| `src/ui/components/DownloadProgressPanel.tsx` | Progress indicator for module downloads |
| `src/ui/components/LibraryHome.tsx` | The library landing surface listing installed modules by kind |
| `src/ui/components/ModuleSelector.tsx` | The shared "pick a module" list used by the Bible/commentary/dictionary/book panes (not the manager dialog) |

### State

| File | Description |
|---|---|
| `src/ui/stores/useModuleStore.ts` | Re-export shim for the store below |
| `src/ui/stores/module/` | The store itself: `useModuleStore.ts`, `moduleAPI.ts`, `types.ts`, and `slices/` - `catalogSlice`, `detailsSlice`, `downloadSlice` (which owns the renderer-side progress polling), `installedSlice`, `lifecycleSlice`, `repositorySlice` |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/moduleHandlers.ts` | The `module:*`, `download:*` and `repository:*` channels (see "IPC surface" below). Owns `ModuleInstallPolicy` and `normalizeInstallPolicy` - see "Install policy" |
| `electron/ipc/blessedPaths.ts` | `blessPath` / `isPathBlessed` - the trust model behind `module:bless-dropped-path`, so `module:install-from-path` and `module:install-pack-from-path` can only ever read a path the user actually dropped or picked |
| `electron/utils/moduleDetector.ts` | Scans data directory for installed module database files |
| `electron/services/InstallationService.ts` | Per-module install: file-format check, canon/versification conformance gate, stable-identity gate, registration in `main.db` |
| `electron/services/ModulePackService.ts` | "Study add-on pack" import - safely unpacks a `.zip`/`.biblepack` archive of many `.db`/`.db.gz` module files (zip-slip defense, entry-count/size ceilings) and installs each through `InstallationService`'s existing conformance-gated path, reporting per-module success/failure/skip/`upToDate`. Not to be confused with `SemanticPackService.ts`/`featurePackHandlers.ts`, which handle a different artifact |
| `electron/services/ModuleCatalogService.ts` | Catalog fetch + signature verification; also resolves **starter packs** (`getAvailableStarterPacks`, `getStarterPacksForLanguage`, `getStarterPackModules`) |
| `electron/services/CatalogSignatureVerifier.ts` + `trustedCatalogKeys.ts` | Ed25519 verification of a fetched catalog against the app's key set |
| `electron/services/DownloadService.ts` | The HTTP download itself: progress/complete/error callbacks and SHA-256 verification (`verifyChecksum`) |
| `electron/services/NetworkGateway.ts`, `NetworkConfig.ts` | Egress policy the catalog fetch and downloads go through (master offline switch) |
| `electron/services/installedModules.ts` | Lists registered modules, filtering out registry rows whose file is missing on disk |
| `electron/services/ModuleDatabaseRegistry.ts`, `ModuleLoader.ts` | Opening a registered module's SQLite file and handing repositories an `ISql` |
| `electron/services/moduleLinkStability.ts` | Persists a stable `module_key -> module_id` map in `main.db` (table `module_link_stability`, key `moduleType:abbreviation`) so highlights survive an uninstall/reinstall, since the autoincrement `module_metadata.module_id` otherwise changes. `remapMarkupModuleId` is what rewrites `user_text_markup.module_id` |

### Unit Tests

| File | Description |
|---|---|
| `electron/services/__tests__/DownloadService.network.test.ts` | Download egress: offline refusal, URL policy, progress/error paths |
| `electron/services/__tests__/ModuleCatalogService.network.test.ts` | Catalog fetch and signature-verification outcomes |
| `electron/services/__tests__/CatalogSignatureVerifier.test.ts` | Ed25519 verification, including tampered and unsigned catalogs |
| `electron/services/installedModules.test.ts` | Registered-but-absent filtering, and the once-per-`moduleType:abbreviation` log |
| `electron/services/__tests__/ModulePackService.test.ts` | Pack-archive extraction/install: multi-module install, mixed success/failure reporting, zip-slip rejection, non-module skip, entry-count/size ceilings, temp-dir cleanup |
| `electron/ipc/__tests__/allowedChannels.test.ts` | The `module:*` / `download:*` / `repository:*` channel allowlist |
| `src/ui/components/ModuleManagerDialog.test.tsx` | The dialog: browsing, upload, drag-and-drop, and the pack summary panel |
| `src/ui/components/ModuleCard.test.tsx`, `ModuleSelector.test.tsx`, `LibraryHome.test.tsx`, `DownloadProgressPanel.test.tsx` | The remaining module surfaces |
| `packages/core/src/Data/Core/ModuleVersion.test.ts` | Version ordering, and the orderable/unorderable boundary the install policy depends on |
| `packages/core/src/Data/Core/StarterPackTypes.test.ts` | Starter-pack catalog validation and language matching |

Not yet unit-tested: `electron/ipc/moduleHandlers.ts` (including the install-policy matrix and `normalizeInstallPolicy`), `electron/ipc/blessedPaths.ts`, `electron/utils/moduleDetector.ts`, `electron/services/InstallationService.ts`, `electron/services/moduleLinkStability.ts`, `src/ui/stores/module/slices/*`, `ModuleList.tsx` and `RepositorySettings.tsx`.

### E2E Tests

| File | Description |
|---|---|
| `e2e/tests/module-manager.spec.ts` | Module manager UI tests. The only module-related spec; starter packs have no e2e coverage |

## IPC surface

`moduleHandlers.ts` registers, and `electron/ipc/allowedChannels.ts` allowlists:

- **Modules:** `module:init`, `module:get-available`, `module:get-installed`, `module:search`, `module:get-details`, `module:install`, `module:install-from-file`, `module:install-from-path`, `module:install-pack-from-path`, `module:bless-dropped-path`, `module:uninstall`, `module:update`, `module:check-for-updates`, `module:get-starter-packs`, `module:get-starter-pack-modules`
- **Downloads:** `download:get-progress`, `download:get-active`, `download:pause`, `download:resume`, `download:cancel`. The renderer polls progress on an interval owned by `slices/downloadSlice.ts`; the queue itself lives in `DownloadQueueRepository`.
- **Repositories:** `repository:get-all`, `repository:get-catalog`, `repository:add`, `repository:remove`, `repository:update-url`, `repository:set-enabled`, `repository:refresh-catalog`, `repository:refresh-all`. `repository:update-url` clears that repository's cached catalog (`catalogJson` and `lastFetched`), so the next read refetches rather than answering from the previous URL's data.

`module:uninstall` takes a `removeUserData` flag; it is also called internally, with `false`, as the first half of an overwrite. `module:check-for-updates` answers `{ hasUpdate, currentVersion, availableVersion }`.

The file dialog returns a `ModuleInstallDialogResult` discriminated union - `{ kind: 'single' } | { kind: 'batch' } | null` - so a single-file pick keeps the shape a caller expects while a multi-selection or pack import reports per-module results.

Pack archives are extracted under `getUserDataPath()/temp/module-packs` (`getModulePackExtractionRoot()`) specifically so the final move into place is a same-volume `renameSync` rather than a cross-device copy.

## Install policy - what happens when a module is already installed

`ModuleInstallPolicy` in `electron/ipc/moduleHandlers.ts`:

| Policy | Used by | Behaviour |
|---|---|---|
| `fail-on-conflict` | Single-file "Install from File" | Throws a `conflict` error so the user is told, rather than having it resolved behind them |
| `replace-if-newer` | **Pack imports, multi-file selections** (default) | Replaces only on a *provable* version upgrade; otherwise leaves the installed copy alone and reports it in the summary's `upToDate` bucket |
| `replace-always` | Drag-and-drop of a single file; explicit user choice | Unconditional overwrite - the escape hatch for a corrupted install or a republished module that kept its version string |

Both install-from-path channels also accept a boolean `allowOverwrite` in place of a policy, mapped by `normalizeInstallPolicy` (`true` -> `replace-always`, `false` -> `fail-on-conflict`), because an older renderer window can outlive a main-process reload.

**Identity** is `module_uuid`: it is stable across renames and cannot collide between publishers, whereas two unrelated publishers can both ship the abbreviation "KJV". The UUID is read from `module_info.module_uuid` by `InstallationService.extractModuleInfo`, validated against `MODULE_UUID_RE` (RFC 4122) in `validateModuleConformance`, and persisted to `module_metadata.module_uuid`, which is NOT NULL and UNIQUE. A module carrying no UUID is refused outright: "Pre-2.0 modules cannot be registered; re-export the module in the current format." The abbreviation match that remains in the install path is therefore only ever reached for rows already in `main.db`.

Note the asymmetry with `moduleLinkStability`, whose key is `moduleType:abbreviation` rather than the UUID.

**"Newer"** is decided by `compareModuleVersions` (`packages/core/src/Data/Core/ModuleVersion.ts`), which returns `incomparable` - never an upgrade - for version strings it cannot order. Publisher version strings are unvalidated free text (`2.3.1`, `1.0`, `v3`, `20240115`, `1769`), so a **single-component** version at or above `MAX_BARE_VERSION_COMPONENT` (1000) is treated as a date or edition year rather than an enormous release number, and that also catches the `YYYY-MM-DD` shape. Without that rule a date-stamped module would read as an upgrade over every dotted version it met, silently overwriting the user's content. Multi-component versions are exempt: `2024.1` is unambiguously versioned. Identical strings compare `same`, and trailing zeros do not matter (`1.0` and `1.0.0` are the same version).

## Starter packs

`ModuleCatalogService` resolves a repository catalog's `starter_packs` into installable module lists. `getStarterPacksForLanguage` filters against `SUPPORTED_CONTENT_LANGUAGES` (`en`, `es`, `hi`, `zh-Hans`) and returning `[]` is a normal outcome. A pack entry whose `module_id` does not resolve is dropped with a warning rather than failing the whole pack. Ceilings: `MAX_STARTER_PACKS` 64, `MAX_STARTER_PACK_MODULES` 200, `MAX_STARTER_PACK_ARCHIVE_BYTES` 8 GiB.

A pack may also carry a `StarterPackArchive` (`download_url`, `download_size_bytes`, `sha256`), which lets the whole pack install from one `.biblepack` with no per-module network traffic.
