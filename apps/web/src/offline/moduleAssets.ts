/**
 * Web module downloads on the asset store (task 0075).
 *
 * A SECOND `AssetManager` (separate from webAssets.ts's on purpose, so modules stay out of the
 * "Downloads & storage" list) over `OpfsModuleStore` and the same fetch transport. The catalog is
 * the server's `GET /api/offline/manifest` (an asset index; one `module.<safeabbr>` asset per module,
 * one `<abbr>.db.gz` file each). Committing gunzips to OPFS `modules/<abbr>.db`, which bibleWorker opens.
 *
 * The worker holds an OPFS handle on an open DB, so install (update) and remove ask the registered
 * closer (OfflineBibleProvider registers the BibleWorkerProxy) to close it first.
 */

import { AssetError, AssetManager, parseAssetIndex } from '@bible/core/browser';
import type { AssetManifest, AssetProgress } from '@bible/core/browser';
import { FetchTransport } from '../assets/FetchTransport';
import { offlineStore } from '../stores/offlineStore';
import { API_BASE } from '../utils/apiUrl';
import { OpfsModuleStore } from './OpfsModuleStore';
import { OpfsRegistryStore } from './OpfsRegistryStore';

export const MODULE_ASSET_KIND = 'module';

let manager: AssetManager | null = null;
let ready: Promise<void> | null = null;
let transport: FetchTransport | null = null;
let catalog: readonly AssetManifest[] = [];
let closeDb: ((abbreviation: string) => void) | null = null;

const getTransport = (): FetchTransport => (transport ??= new FetchTransport());

/** Called once by OfflineBibleProvider so updates/removals can release the worker's file handle. */
export function setModuleDbCloser(fn: ((abbreviation: string) => void) | null): void {
  closeDb = fn;
}

function closeWorkerDb(abbr: string): void {
  try { closeDb?.(abbr); } catch { /* the worker may not exist yet */ }
}

/** Same rule as the server's `safeAbbr` (server/offline/offlineFiles.ts). */
export function moduleAssetId(abbr: string): string {
  return `${MODULE_ASSET_KIND}.${abbr.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}`;
}

/**
 * The module asset manager (lazy singleton; `init()` runs once).
 * @throws AssetError('storage') when OPFS is unavailable.
 */
export function getModuleAssetManager(): AssetManager {
  if (!manager) {
    const m = new AssetManager({
      transport: getTransport(),
      store: new OpfsModuleStore(),
      registry: new OpfsRegistryStore(),
    });
    m.setCatalog(catalog);
    manager = m;
    ready = m.init().catch(() => {});
  }
  return manager;
}

async function readyManager(): Promise<AssetManager> {
  const m = getModuleAssetManager();
  await ready;
  return m;
}

export const moduleManifestUrl = (): string => `${API_BASE}/api/offline/manifest`;

/**
 * Fetch the manifest and hand the module assets to the manager.
 * false on 404 (site flags off), an invalid index, offline or any failure; never throws.
 */
export async function refreshModuleCatalog(signal?: AbortSignal): Promise<boolean> {
  try {
    const url = moduleManifestUrl();
    const text = await getTransport().getText(url, signal ?? new AbortController().signal);
    if (text === null) return false;
    const parsed = parseAssetIndex(JSON.parse(text), url);
    if (parsed.rejected.some((r) => r.index === -1)) return false;
    catalog = parsed.assets.filter((a) => a.kind === MODULE_ASSET_KIND);
    if (manager) manager.setCatalog(catalog);
    return true;
  } catch {
    return false;
  }
}

/** The catalog as last refreshed (empty until a refresh succeeds). */
export function getModuleCatalog(): readonly AssetManifest[] {
  return catalog;
}

/**
 * The catalog manifest for a client-facing abbreviation. The server keys the asset id on the
 * DATABASE abbreviation while `meta.abbreviation` (and the file name) carry the client one
 * (`shortName || abbr`), so match `meta.abbreviation` first (case-insensitive), then the derived id.
 */
export function findModuleManifest(abbr: string): AssetManifest | undefined {
  const lower = abbr.toLowerCase();
  const byMeta = catalog.find((a) => {
    const m = a.meta?.abbreviation;
    return typeof m === 'string' && m.toLowerCase() === lower;
  });
  if (byMeta) return byMeta;
  const id = moduleAssetId(abbr);
  return catalog.find((a) => a.id === id);
}

export interface InstallModuleOptions {
  /** Explicit user install: never auto-evicted. Default false. */
  pinned?: boolean;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Download, verify, decompress and register one module from the catalog, then record it in
 * `offlineStore`. Rejects with AssetError (`not-found` when the catalog lacks the module).
 */
export async function installModuleAsset(abbr: string, opts: InstallModuleOptions = {}): Promise<void> {
  const manifest = findModuleManifest(abbr);
  if (!manifest) throw new AssetError('not-found', `Module ${abbr} is not in the offline catalog`);
  // The canonical (client) abbreviation keys the file, the worker DB and the offlineStore entry,
  // whatever casing the caller used.
  const canonical = manifest.meta?.abbreviation;
  if (typeof canonical === 'string' && canonical) abbr = canonical;
  const m = await readyManager();
  const current = m.installed(manifest.id);
  // An update replaces the file the worker may hold open.
  if (current && current.version !== manifest.version) closeWorkerDb(abbr);
  let closedForCommit = false;
  const installed = await m.install(manifest, {
    pinned: opts.pinned,
    signal: opts.signal,
    onProgress: (p: AssetProgress) => {
      if (p.phase === 'committing' && !closedForCommit) {
        closedForCommit = true;
        closeWorkerDb(abbr);
      }
      opts.onProgress?.(p.loaded, p.total);
    },
  });
  const meta = (installed.meta ?? manifest.meta ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const previous = offlineStore.downloadedModules.find((x) => x.abbreviation.toLowerCase() === abbr.toLowerCase());
  offlineStore.addDownloadedModule({
    abbreviation: abbr,
    name: typeof meta.name === 'string' && meta.name ? meta.name : manifest.title,
    type: typeof meta.moduleType === 'string' && meta.moduleType ? meta.moduleType : 'bible',
    sizeBytes: typeof meta.storedSize === 'number' ? meta.storedSize : installed.size,
    downloadedAt: now,
    lastUsedAt: now,
    // Pinned (explicit) installs are never auto-cleaned; a later unpinned refresh keeps that.
    autoDownloaded: opts.pinned ? false : (previous ? previous.autoDownloaded : true),
  });
}

/**
 * Keep an already-installed module on this device: pins its asset registry entry (no download when the
 * installed version is the offered one) and clears `autoDownloaded` so the 15-day cleanup skips it.
 * A legacy download (no registry entry) only gets the offlineStore flag; nothing is downloaded.
 */
export async function pinModuleAsset(abbr: string): Promise<void> {
  const manifest = findModuleManifest(abbr);
  if (manifest) {
    const m = await readyManager();
    const current = m.installed(manifest.id);
    if (current && current.version === manifest.version) {
      await installModuleAsset(abbr, { pinned: true });
      return;
    }
  }
  const lower = abbr.toLowerCase();
  const previous = offlineStore.downloadedModules.find((x) => x.abbreviation.toLowerCase() === lower);
  if (previous && previous.autoDownloaded) offlineStore.addDownloadedModule({ ...previous, autoDownloaded: false });
}

/** Close the worker DB, remove the asset (file, partials, registry entry) and the offlineStore entry. */
export async function removeModuleAsset(abbr: string): Promise<void> {
  const canonical = findModuleManifest(abbr)?.meta?.abbreviation;
  if (typeof canonical === 'string' && canonical) abbr = canonical;
  closeWorkerDb(abbr);
  try {
    const m = await readyManager();
    await m.remove(findModuleManifest(abbr)?.id ?? moduleAssetId(abbr));
  } finally {
    offlineStore.removeDownloadedModule(abbr);
  }
}

/** Test seam. */
export function resetModuleAssetsForTests(): void {
  manager = null;
  ready = null;
  transport = null;
  catalog = [];
  closeDb = null;
}
