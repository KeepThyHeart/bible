# Offline packs

**Last verified:** feature/offline-packs (2026-09-30)

Pick Bibles (and later other content), see the size, and download them for offline use in one resumable, verified job. Shared planner and runner in core, per-app storage and UI.

## Pieces

| Piece | Where |
|---|---|
| Pack types, `planPack` (dependencies, sizes, fit), `PackRun`, presets from starter packs | `packages/core/src/offline/` (`@bible/core/browser`) |
| Download, verify, cache | `packages/core/src/assets/` (asset store, task 0090). Packs only decide what to fetch and in what order |
| `PackBuilder` component | `packages/ui/src/components/PackBuilder.tsx`, styles `.kth-pack-*` |
| Web server manifest and files | `GET /api/offline/manifest`, `GET /api/offline/files/:id/:version/:name` (`server/routes/offlineRoutes.ts`) |
| Web module store | `src/offline/OpfsModuleStore.ts` (modules gunzipped into OPFS `modules/<abbr>.db`), `moduleAssets.ts` (second `AssetManager`, separate from the Downloads list) |
| Web UI | Settings, Offline tab: `components/Dialogs/OfflinePackSection.tsx` (behind `features.offlineDownloads`) |
| Desktop UI | Module Manager, "Offline packs" tab (`OfflinePacksPanel.tsx`); installs go through the existing module install path |

## Server manifest

An `kth-asset-index/1` document, one asset per visible module (`settings.json` filter applies): id `module.<abbr>`, one gzip file with its SHA-256, `meta.storedSize` for the disk estimate. The client abbreviation (`shortName || abbr`) is in `meta.abbreviation`; look manifests up by it, not by rebuilding the id. Files are gzipped lazily on the first manifest request (level 9, cached next to the lite files, keyed by source mtime), so the first call on a large library is slow. Files are served with Range and ETag, `private, immutable, no-transform`. The routes answer 404 unless `offlineDownloads` or `offlineAutoDownload` is on.

## Rules

- The web app saves no personal content until accounts exist: the selection lives in component state, `MemoryPackSpecStore` is a stand-in for the user-data pack specs of task 0084. Downloaded files, the OPFS registry and the `offlineStore` cache index are device caches.
- Choosing an already downloaded module pins it (the 15-day cleanup skips it).
- Only Bibles can be read offline on web today; other module types are listed but disabled until the offline module worker exists.
- Desktop ignores the site-config flags, runs one install at a time, and does not know free space yet.

## Next

Offline readers for commentary, dictionary, cross-references and topics on web; semantic index into Cache Storage; desktop modules through the asset store (needs a catalog download hash); statfs free space and push progress on desktop; audio and voice items; update prompts per pack; service worker opt-in (0085); user-data pack specs (0084).
