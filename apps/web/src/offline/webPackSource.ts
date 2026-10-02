/**
 * The web app's `IPackSource` (task 0075): offers every catalog module (from the module asset
 * manager) plus TTS voices and data files from the main asset catalog. Status comes from the
 * managers' own list snapshots, so installs started elsewhere show up here too.
 *
 * Only Bible modules are `offlineReadable`: the web app has no offline reader for other module
 * types yet, so the UI shows those disabled with a reason.
 *
 * Licence: GPL-3.0-or-later.
 */

import { compareAssetVersions, packKey } from '@bible/core/browser';
import type { AssetEntry, AssetManifest, IAssetManager, IPackSource, PackGroup, PackOffer, PackPreset } from '@bible/core/browser';
import { getAssetManager } from '../assets/webAssets';
import { offlineStore } from '../stores/offlineStore';
import type { DownloadedModule } from '../stores/offlineStore';
import { getModuleAssetManager, getModuleCatalog, refreshModuleCatalog } from './moduleAssets';
import { getWebPresets } from './webPresets';

const PIPER_RUNTIME_ID = 'piper-runtime';

export interface WebPackSourceDeps {
  moduleManager?: () => IAssetManager;
  moduleCatalog?: () => readonly AssetManifest[];
  refreshModules?: (signal?: AbortSignal) => Promise<boolean>;
  assetManager?: () => IAssetManager;
  presets?: () => PackPreset[];
  /** Modules recorded in `offlineStore` (legacy downloads have a file but no asset registry entry). Default the store. */
  legacyModules?: () => readonly DownloadedModule[];
  /** Default `navigator.storage.estimate`. */
  estimate?: () => Promise<{ quota?: number; usage?: number } | undefined>;
}

const MODULE_GROUPS: Record<string, PackGroup> = {
  bible: 'bible',
  commentary: 'commentary',
  dictionary: 'dictionary',
  crossref: 'crossref',
  topical: 'topical',
};

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function statusOf(
  manager: IAssetManager,
  entries: Map<string, AssetEntry>,
  m: AssetManifest,
): Pick<PackOffer, 'status' | 'installedVersion' | 'installedStoredBytes'> {
  const e = entries.get(m.id.toLowerCase());
  const inst = manager.installed(m.id);
  const out: Pick<PackOffer, 'status' | 'installedVersion' | 'installedStoredBytes'> = { status: 'absent' };
  const installedVersion = inst?.version ?? e?.installedVersion;
  if (installedVersion !== undefined) out.installedVersion = installedVersion;
  if (inst) out.installedStoredBytes = inst.size;
  else if (e && e.storedBytes > 0) out.installedStoredBytes = e.storedBytes;
  if (e && (e.status === 'queued' || e.status === 'downloading')) out.status = 'installing';
  else if (installedVersion !== undefined) {
    out.status = compareAssetVersions(installedVersion, m.version) < 0 ? 'update-available' : 'installed';
  }
  return out;
}

export function createWebPackSource(deps: WebPackSourceDeps = {}): IPackSource {
  const moduleManager = deps.moduleManager ?? getModuleAssetManager;
  const moduleCatalog = deps.moduleCatalog ?? getModuleCatalog;
  const refreshModules = deps.refreshModules ?? refreshModuleCatalog;
  const assetManager = deps.assetManager ?? getAssetManager;
  const presets = deps.presets ?? getWebPresets;
  const legacyModules = deps.legacyModules ?? (() => offlineStore.downloadedModules);
  const estimate =
    deps.estimate ??
    (async () => (typeof navigator !== 'undefined' && navigator.storage?.estimate ? navigator.storage.estimate() : undefined));

  const entryMap = (m: IAssetManager): Map<string, AssetEntry> =>
    new Map(m.getSnapshot().entries.map((e) => [e.id.toLowerCase(), e]));

  return {
    async listOffers(signal) {
      try {
        await refreshModules(signal);
      } catch {
        /* offline: offer whatever catalog is already held */
      }
      const offers: PackOffer[] = [];

      const mm = moduleManager();
      const mEntries = entryMap(mm);
      const legacy = new Map(legacyModules().map((x) => [x.abbreviation.toLowerCase(), x]));
      for (const m of moduleCatalog()) {
        if (m.kind !== 'module') continue;
        const meta = m.meta ?? {};
        const abbr = typeof meta.abbreviation === 'string' && meta.abbreviation ? meta.abbreviation : m.id.replace(/^module\./, '');
        const moduleType = typeof meta.moduleType === 'string' ? meta.moduleType : '';
        const ref = { kind: 'module' as const, id: abbr };
        const offer: PackOffer = {
          ref,
          key: packKey(ref),
          title: typeof meta.name === 'string' && meta.name ? `${meta.name} (${abbr})` : abbr,
          group: MODULE_GROUPS[moduleType] ?? 'other',
          version: m.version,
          downloadBytes: m.size,
          storedBytes: num(meta.storedSize) || m.size,
          offlineReadable: moduleType === 'bible',
          ...statusOf(mm, mEntries, m),
        };
        // A legacy (pre-asset-store) download is on this device but not in the registry.
        const old = legacy.get(abbr.toLowerCase());
        if (old && offer.status === 'absent') {
          offer.status = 'installed';
          offer.installedStoredBytes = old.sizeBytes;
        }
        if (typeof meta.languageCode === 'string' && meta.languageCode) offer.language = meta.languageCode;
        offers.push(offer);
      }

      const am = assetManager();
      const aEntries = entryMap(am);
      const catalog = am.getSnapshot().entries;
      const manifestLike = (e: AssetEntry): AssetManifest =>
        ({ id: e.id, kind: e.kind, version: e.version, title: e.title, license: e.license, size: e.size, files: [] }) as AssetManifest;
      const runtime = catalog.find((e) => e.kind === 'tts-runtime');
      for (const e of catalog) {
        if (e.kind !== 'tts-voice' && e.kind !== 'data' && e.kind !== 'tts-runtime') continue;
        const ref = { kind: 'asset' as const, id: e.id };
        const offer: PackOffer = {
          ref,
          key: packKey(ref),
          title: e.title,
          group: e.kind === 'data' ? 'data' : 'speech',
          version: e.version,
          downloadBytes: e.size,
          storedBytes: e.size,
          offlineReadable: true,
          ...statusOf(am, aEntries, manifestLike(e)),
        };
        if (e.kind === 'tts-voice') offer.requires = [{ kind: 'asset', id: runtime?.id ?? PIPER_RUNTIME_ID }];
        offers.push(offer);
      }
      return offers;
    },

    async listPresets() {
      return presets();
    },

    async freeBytes() {
      try {
        const est = await estimate();
        if (est && typeof est.quota === 'number' && est.quota > 0) return Math.max(0, est.quota - (est.usage ?? 0));
      } catch {
        /* unknown */
      }
      return null;
    },
  };
}
