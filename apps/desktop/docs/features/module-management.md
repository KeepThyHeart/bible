# Module Management

**Last verified:** 2026-09-18

Browsing, downloading, and managing Bible, Commentary, Dictionary, and Book modules. The dialog organizes modules by type in a tabbed, filterable table with a details panel for metadata and actions.

## Files

Related: **starter packs** (language-scoped content recommendations) are typed by `packages/core/src/Data/Core/StarterPackTypes.ts` and arrive as declared data in the `starter_packs` array of a fetched repository catalog; nothing in this repo emits one. See `docs/features/onboarding.md` for the first-run UI that surfaces them.

### Components

| File | Description |
|---|---|
| `src/ui/components/ModuleManagerDialog.tsx` | Main module manager dialog: header with upload/refresh controls, offline banner (when `useNetworkStore` is off: **Turn on** / **Install from a file…**), inline `ModulePackSummaryPanel` for pack import results, and drag-and-drop pack install (with `module:inspect-pack` + `shared/ConfirmDialog` for unsigned/untrusted archives). Body replaced with type-tabbed layout |
| `src/ui/components/moduleManager/ModuleTable.tsx` | Compact table for a single module type: sort recommended-then-alpha, join with download progress, filter by install status (All/Installed/Updates), render a row per module |
| `src/ui/components/moduleManager/ModuleRow.tsx` | One table row: module name + abbreviation, language, version, size, status/action cell (joined with active download progress). Clicking opens the details panel |
| `src/ui/components/moduleManager/ModuleDetailsPanel.tsx` | Right-hand in-dialog panel: full metadata (description, author, publisher, licence link, version, sizes, features, tags, checksum, `is_indexed`), actions (Install / Update / Uninstall with data choice / Re-index / Cancel-pause-resume download), and a button to filter by type |
| `src/ui/components/shared/TabStrip.tsx` | Wraps `hooks/useTabKeyboardNav.ts`: keyboard-navigable tab list with support for grouped tabs (module types + right-aligned Feature packs / Sources) |
| `src/ui/components/shared/ProgressRing.tsx` | Determinate circular progress when `totalBytes` is known; indeterminate spinner otherwise |
| `src/ui/components/RepositorySettings.tsx` | Add, remove, enable/disable and re-point module repositories, force a catalog refresh, and a signature badge per catalog (Verified (Keep Thy Heart) / Signed / Unsigned / Signature problem - `undefined` when never fetched) |
| `src/ui/components/DownloadProgressPanel.tsx` | Progress indicator for module downloads |
| `src/ui/components/LibraryHome.tsx` | The library landing surface listing installed modules by kind |
| `src/ui/components/ModuleSelector.tsx` | The shared "pick a module" list used by the Bible/commentary/dictionary/book panes (not the manager dialog) |

### State

| File | Description |
|---|---|
| `src/ui/stores/useModuleStore.ts` | Re-export shim for the store below |
| `src/ui/stores/module/` | The store itself: `useModuleStore.ts`, `moduleAPI.ts`, `types.ts`, and `slices/` - `catalogSlice`, `detailsSlice` (`selectedModule`, `loadModuleDetails`), `downloadSlice` (progress polling, 500 ms interval, includes `moduleId`), `installedSlice`, `lifecycleSlice` (`activeTypeTab`, `installFilter`), `repositorySlice` |
| `src/ui/stores/module/moduleRows.ts` | Pure, testable module: merges catalog + installed into `ModuleRow` (keyed by abbreviation), groups by type, sorts recommended-then-alpha (per-type). No React dependencies |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/moduleHandlers.ts` | The `module:*`, `download:*` and `repository:*` channels (see "IPC surface" below). Owns `ModuleInstallPolicy` and `normalizeInstallPolicy` - see "Install policy" |
| `electron/ipc/blessedPaths.ts` | `blessPath` / `isPathBlessed` - the trust model behind `module:bless-dropped-path`, so `module:install-from-path` and `module:install-pack-from-path` can only ever read a path the user actually dropped or picked |
| `electron/utils/moduleDetector.ts` | Scans data directory for installed module database files |
| `electron/services/InstallationService.ts` | Per-module install: file-format check, canon/versification conformance gate, stable-identity gate, registration in `main.db` |
| `electron/services/ModulePackService.ts` | "Study add-on pack" import - safely unpacks a `.zip`/`.biblepack` archive of many `.db`/`.db.gz` module files (zip-slip defense, entry-count/size ceilings) and installs each through `InstallationService`'s existing conformance-gated path, reporting per-module success/failure/skip/`upToDate`. Every pack archive - `.zip` and `.biblepack` alike - is additionally put through the trust gate described under "Signed offline pack archives" below; the extension decides nothing, only whether `pack.json`/`pack.json.sig` are actually present inside it. Not to be confused with `SemanticPackService.ts`/`featurePackHandlers.ts`, which handle a different artifact |
| `electron/services/ModulePackSignature.ts` | Pack manifest (`pack.json`) parsing and detached-signature (`pack.json.sig`) verification, over a domain-separated digest so a pack signature can never be mistaken for a catalog signature |
| `electron/services/ModuleCatalogService.ts` | Catalog fetch + signature verification; also resolves **starter packs** (`getAvailableStarterPacks`, `getStarterPacksForLanguage`, `getStarterPackModules`) |
| `electron/services/CatalogSignatureVerifier.ts` + `trustedCatalogKeys.ts` | Ed25519 verification of a fetched catalog against the app's key set. `verifyDigestAgainstEntries`/`readSignatureEntries` are the shared, digest-agnostic core `ModulePackSignature.ts` reuses rather than duplicating |
| `electron/services/DownloadService.ts` | The HTTP download itself: progress/complete/error callbacks and SHA-256 verification (`verifyChecksum`) |
| `electron/services/NetworkGateway.ts`, `NetworkConfig.ts` | Egress policy the catalog fetch and downloads go through (master offline switch). `ModuleCatalogService.refreshAllCatalogs()` checks `gateway.isOffline()` up front and throws `NetworkBlockedError` (classified as IPC error code `network_blocked` by `handler-helper.ts`) rather than attempting - and logging a failure for - every enabled source individually |
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
| `electron/services/__tests__/ModulePackService.test.ts` | Pack-archive extraction/install: multi-module install, mixed success/failure reporting, zip-slip rejection, non-module skip, entry-count/size ceilings, temp-dir cleanup, and the trust gate (verified/unsigned/untrusted/tampered, `acceptUnverified`) |
| `electron/services/__tests__/ModulePackSignature.test.ts` | Pack manifest parsing and signature verification: verified/unsigned/untrusted/invalid, and domain separation from a catalog-style signature |
| `electron/services/__tests__/ModuleCatalogService.starterPacks.test.ts` | First run offers only verified-official packs; `getStarterPackModules`/`getModuleInfo` resolve a module id against one catalog only, never a same-id module shadowed by another |
| `electron/ipc/__tests__/allowedChannels.test.ts` | The `module:*` / `download:*` / `repository:*` channel allowlist |
| `electron/ipc/__tests__/moduleHandlers.installFromFile.test.ts` | `module:install-from-file`'s native `dialog.showMessageBox`/`showErrorBox` trust gate: unsigned → confirm → install with `acceptUnverified`; Cancel → clean `null`, not an error; invalid → native error box + reported failure, no install; verified → no dialog; the same gate for a plain `.zip`, and the picker's own cancel unaffected. Mocks `electron` and every heavy service `initializeModuleManager()` would otherwise construct |
| `src/ui/components/ModuleManagerDialog.test.tsx` | The dialog: type tabs, install filter, table browsing, upload, the offline banner, and the pack drag-and-drop trust gate (unsigned → `ConfirmDialog` → install with `acceptUnverified`; declined; invalid → error, no install option; verified → installs with no prompt) |
| `src/ui/stores/module/moduleRows.test.ts` | Row model: merge catalog + installed, grouping, sorting (recommended first, then alphabetical), type filtering |
| `src/ui/components/shared/TabStrip.test.tsx`, `ProgressRing.test.tsx` | Tab navigation and progress indication |
| `src/ui/components/moduleManager/ModuleTable.test.tsx`, `ModuleRow.test.tsx`, `ModuleDetailsPanel.test.tsx` | Table rendering, row interaction, details panel with actions |
| `src/ui/stores/module/moduleAPI.test.ts` | API wrappers including `reindexModule` |
| `src/ui/stores/__tests__/libraryChanged.test.ts` | Install → `notifyLibraryChanged` → `loadAvailableBibles` + re-seed (Bug B fix) |
| `src/ui/components/ModuleSelector.test.tsx`, `LibraryHome.test.tsx`, `DownloadProgressPanel.test.tsx` | Remaining module surfaces |
| `packages/core/src/Data/Core/ModuleVersion.test.ts` | Version ordering, and the orderable/unorderable boundary the install policy depends on |
| `packages/core/src/Data/Core/StarterPackTypes.test.ts` | Starter-pack catalog validation and language matching |

Not yet unit-tested: `electron/ipc/moduleHandlers.ts` beyond the "Install from File" trust gate above (the install-policy matrix, `normalizeInstallPolicy`, and every other handler), `electron/ipc/blessedPaths.ts`, `electron/utils/moduleDetector.ts`, `electron/services/InstallationService.ts`, `electron/services/moduleLinkStability.ts`. `RepositorySettings.test.tsx` covers only the catalog signature badge (see "RepositorySettings.tsx" in Components above) - the rest of the component (add/remove/refresh/edit-url) is still untested directly.

### E2E Tests

| File | Description |
|---|---|
| `e2e/tests/module-manager.spec.ts` | Module manager UI tests. The only module-related spec; starter packs have no e2e coverage |

## IPC surface

`moduleHandlers.ts` registers, and `electron/ipc/allowedChannels.ts` allowlists:

- **Modules:** `module:init`, `module:get-available`, `module:get-installed`, `module:search`, `module:get-details`, `module:install`, `module:install-from-file`, `module:install-from-path`, `module:install-pack-from-path`, `module:inspect-pack`, `module:bless-dropped-path`, `module:uninstall`, `module:update`, `module:check-for-updates`, `module:get-starter-packs`, `module:get-starter-pack-modules`, `search:buildIndex` (wrapped by `moduleAPI.reindexModule`)

  `module:install` takes an optional `catalogId`; when given (a starter pack's own `source.catalogId`), the module id is resolved only against that catalog (`ModuleCatalogService.getModuleInfo`), never across every enabled one - closing the gap where a third-party catalog could otherwise "shadow" an official module id. `module:get-starter-pack-modules` takes a required `catalogId` for the same reason. `module:inspect-pack` previews a pack archive's signature/manifest without installing anything (see "Signed offline pack archives" below); it is always a preview - `module:install-pack-from-path` re-verifies independently every time.
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

## Starter packs and first-run fallback

`ModuleCatalogService` resolves a repository catalog's `starter_packs` into installable module lists. `getStarterPacksForLanguage` filters against `SUPPORTED_CONTENT_LANGUAGES` (`en`, `es`, `hi`, `zh-Hans`) and returning `[]` is a normal outcome. A pack entry whose `module_id` does not resolve is dropped with a warning rather than failing the whole pack. Ceilings: `MAX_STARTER_PACKS` 64, `MAX_STARTER_PACK_MODULES` 200, `MAX_STARTER_PACK_ARCHIVE_BYTES` 8 GiB.

**When starter packs are empty**, the first-run language dialog falls back to recommended catalog modules (`module:search` with `{ languageCode, recommended: true }`, Bible first) and offers those instead. Only "nothing available" is shown when both packs and modules are empty. The dialog also falls back `en-US` → `en` on the language code. **Currently, only `en` is published**, so non-English users will legitimately see nothing; the UI explains this honestly.

A pack may also carry a `StarterPackArchive` (`download_url`, `download_size_bytes`, `sha256`), which lets the whole pack install from one `.biblepack` with no per-module network traffic (see "Signed offline pack archives" below).

**Only the official catalog, verified.** `getAvailableStarterPacks`/`getStarterPacksForLanguage` return `OfferedStarterPack[]` (`@bible/core`'s `StarterPackTypes.ts`) - each pack from a catalog that is currently `isPinnedOfficialCatalog(url) && signatureStatus === 'verified'`, carrying `source: { catalogId, catalogName, verifiedOfficial: true }`. A third-party or not-(yet)-verified catalog's packs are excluded outright, not just unbadged - first run's implicit endorsement ("Keep Thy Heart put this in front of you") is only true for a catalog this install has actually checked.

**Same-catalog resolution.** `getStarterPackModules(packId, catalogId)` and `getModuleInfo(moduleId, catalogId)` resolve ids only against `catalogId`'s own `modules` array, re-checking that catalog is still enabled (and, for the pack case, still the verified official one) at call time. Without this, a same-`module_id` entry in a different enabled catalog - even one that merely looks official - could satisfy a lookup the caller believed was scoped to the official one. `catalogId` is omitted for the Module Manager's ordinary per-module install, which keeps searching every enabled catalog exactly as before.

## Signed offline pack archives (`.zip` and `.biblepack`)

**The archive's extension decides nothing.** Every pack archive selected through "Install from File" or dropped onto the dialog - `.zip` exactly like `.biblepack` - goes through the same inspect/verify/confirm gate, keyed only on whether the archive actually contains `pack.json`/`pack.json.sig`. Trusting the extension would let a hostile archive simply rename its way past verification; a `.zip` with no manifest inside verifies as plain `unsigned` (and needs the same confirmation a `.biblepack` would), and a `.zip` that does carry `pack.json`(`.sig`) is checked exactly like a `.biblepack`. `.biblepack` remains the recommended extension for a pack meant to be shared as such - it just is not a trust boundary. (`isBiblePackPath` no longer exists precisely because of this; use `isModulePackPath` for "is this an archive at all".)

Format, at the archive root:

- `pack.json` - the manifest: `format` (`"keepthyheart.biblepack/1"`), `pack_id`, `name`, `version`, `languages`, `created`, and `modules: [{ path, sha256, size_bytes }]`. `path` is POSIX-relative, no `..`, naming a `*.db`/`*.db.gz` entry.
- `pack.json.sig` - optional, same shape as `catalog.json.sig` (primary signature + optional `signatures[]`). Its signed message is domain-separated - `sha256(PACK_MANIFEST_SIGNATURE_DOMAIN + manifest bytes)`, defined once in `ModulePackSignature.ts` and mirrored in `scripts/yubikey-sign.py` - so a pack signature can never verify as a catalog/index/vouch signature, or vice versa.

Verification (`ModulePackSignature.verifyPackManifestSignature`, applied by `ModulePackService.extractModulePack` to any pack archive it is asked to check):

| Result | Meaning | What `ModulePackService` does with it |
|---|---|---|
| `verified` | Valid signature by a trusted key (pinned official + user-approved), well-formed manifest | Every extracted `.db`/`.db.gz` entry is hashed while streaming and cross-checked against the manifest's `path`/`size_bytes`/`sha256`; an unlisted entry, a mismatch, or a listed file that never shows up refuses the **whole pack** (`pack_tampered`) before any module installs |
| `unsigned` | No `pack.json.sig` (with or without `pack.json` - `build-module-pack.js manifest` always writes the manifest; signing is a separate, optional step; a plain `.zip` with no manifest at all is unsigned too) | Requires `acceptUnverified: true` or refuses (`pack_unverified`) |
| `untrusted` | Every signature valid, but none by a trusted key | Same as `unsigned` |
| `invalid` | A `.sig` present but not verifying, `pack.json.sig` with no `pack.json`, or a malformed manifest | Refused (`pack_signature_invalid`), **no override** |

`module:inspect-pack` previews this (and a manifest summary) without installing anything; `module:install-pack-from-path` always re-verifies independently regardless of what a prior inspect call reported. Trusted keys are `getOfficialPublicKeys()` plus any keys the user approved for the official scope (`ApprovedCatalogKeys`) - the same trust anchors the official catalog itself uses; a pack has no URL of its own, so there is no trust-on-first-use fallback.

**Two confirmation surfaces, same decision, same underlying re-verification:**

- **Drag-and-drop** (`ModuleManagerDialog.handleDrop`): the renderer calls `module:inspect-pack`, then shows `shared/ConfirmDialog` ("This pack isn't verified" / Cancel / "Install anyway") for `unsigned`/`untrusted`, or an inline error for `invalid` with no install option. Declining resolves like a cancelled dialog - not an error.
- **"Install from File"** (`module:install-from-file`, both the Module Manager's "Upload Module" button and first run's "Install from a file…"): this is one main-process round trip - `dialog.showOpenDialog` picks the file(s) and the same call installs them, with no later turn in which a renderer confirmation could run. So the confirmation happens in main instead: `resolvePackFileTrust` calls `inspectModulePack` directly and raises a **native** `dialog.showMessageBox` (unparented, mirroring `confirmEnable` in `networkHandlers.ts`) - Cancel is both the default button and the `cancelId`, so dismissing the dialog can never read as consent. `invalid` gets `dialog.showErrorBox` instead, with no install attempted. A native confirmation is also a *stronger* guarantee here than a renderer one: a compromised renderer cannot suppress, skip, or spoof the answer to a dialog it is never shown. Every picked file is independent - one being declined does not stop the others - and if every picked pack in the selection is declined (or the selection contained nothing else), `module:install-from-file` returns `null`, the same "nothing to report" result as cancelling the picker.

In both cases the confirmation is only ever a UI convenience: `installModulePackFromPath` re-verifies the signature and the manifest from scratch when it actually runs, and never trusts an `acceptUnverified: true` it receives as a substitute for that check.

**Tooling**, in order:

1. `node scripts/build-module-pack.js manifest <dir> --id <id> --name <name> --version <v> --languages en[,es]` - writes `<dir>/pack.json` from the `*.db`/`*.db.gz` files directly inside `<dir>`.
2. `python scripts/yubikey-sign.py sign-pack <dir>/pack.json` - optional; writes `<dir>/pack.json.sig`.
3. `node scripts/build-module-pack.js bundle <dir> --out <name>.biblepack` - re-hashes the files (refuses if they no longer match `pack.json`) and writes the archive using `scripts/lib/createZip.js`, a small dependency-free zip writer ported from `packages/extension-testing`'s internal one (not imported from it - that package has no build step on a fresh install, so `scripts/` cannot depend on its `dist/` existing).

`scripts/build-module-pack.test.js` (`node scripts/build-module-pack.test.js`) is a small smoke test: manifest → bundle round trip, and bundle refusing a file that changed after `manifest` ran.
