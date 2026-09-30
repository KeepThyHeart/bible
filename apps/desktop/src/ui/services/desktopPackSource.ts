/**
 * Desktop IPackSource (task 0075): maps the module store (merged signed catalogs, installed modules,
 * active downloads, starter packs) to pack offers and presets. Pure mapping; the store is injected so
 * it can be tested without Electron.
 *
 * Licence: GPL-3.0-or-later.
 */

import { packKey, presetFromStarterPack } from '@bible/core/browser';
import type { IPackSource, PackGroup, PackItemRef, PackOffer, PackPreset } from '@bible/core/browser';

/** The slice of `CatalogModule` the source reads. `catalogId` is optional: the catalog list carries none today. */
export interface PackCatalogModule {
  module_id: string;
  module_type: string;
  name: string;
  abbreviation: string;
  language_code: string;
  version: string;
  download_size_bytes: number;
  installed_size_bytes: number;
  requires_module?: string;
  catalogId?: number;
}

export interface PackInstalledModule {
  abbreviation: string;
  version: string;
  update_available: boolean;
}

export interface PackActiveDownload {
  moduleId: string;
  status: string;
}

export interface PackStarterPack {
  pack_id: string;
  name: string;
  description?: string;
  version?: string;
  module_ids: string[];
  source?: { catalogId: number };
}

export interface DesktopPackSourceDeps {
  getAvailable(): readonly PackCatalogModule[];
  getInstalled(): readonly PackInstalledModule[];
  getActiveDownloads(): readonly PackActiveDownload[];
  /** `getStarterPacks(lang)` of the module manager API, already bound to the UI language. */
  getStarterPacks(): Promise<readonly PackStarterPack[]>;
  /**
   * Free bytes on the modules volume. Desktop has no statfs IPC yet, so callers omit it and the plan's
   * fit is 'unknown'. NEXT STEP: add a `system:get-free-space` IPC and pass it here.
   */
  getFreeBytes?: () => Promise<number | null>;
}

const GROUPS: Record<string, PackGroup> = {
  bible: 'bible',
  commentary: 'commentary',
  dictionary: 'dictionary',
  cross_reference: 'crossref',
  topical_index: 'topical',
};

export function packGroupOf(moduleType: string): PackGroup {
  return GROUPS[moduleType] ?? 'other';
}

export function createDesktopPackSource(deps: DesktopPackSourceDeps): IPackSource & {
  /** Catalog scoping learned from starter packs, for modules whose catalog entry carries none. */
  catalogIdFor(moduleId: string): number | undefined;
} {
  const starterCatalog = new Map<string, number>();

  const loadStarters = async (): Promise<readonly PackStarterPack[]> => {
    try {
      const packs = await deps.getStarterPacks();
      for (const p of packs) {
        if (p.source) for (const id of p.module_ids) starterCatalog.set(id.toLowerCase(), p.source.catalogId);
      }
      return packs;
    } catch {
      return [];
    }
  };

  return {
    catalogIdFor: (id) => starterCatalog.get(id.toLowerCase()),

    async listOffers(): Promise<PackOffer[]> {
      await loadStarters();
      const installed = new Map(deps.getInstalled().map((m) => [m.abbreviation.toLowerCase(), m]));
      const downloading = new Set(
        deps
          .getActiveDownloads()
          .filter((d) => d.status === 'pending' || d.status === 'downloading')
          .map((d) => d.moduleId.toLowerCase()),
      );
      return deps.getAvailable().map((m): PackOffer => {
        const ref: PackItemRef = { kind: 'module', id: m.module_id };
        const inst = installed.get(m.abbreviation.toLowerCase());
        const status: PackOffer['status'] = downloading.has(m.module_id.toLowerCase())
          ? 'installing'
          : !inst
            ? 'absent'
            : inst.update_available
              ? 'update-available'
              : 'installed';
        const offer: PackOffer = {
          ref,
          key: packKey(ref),
          title: m.name,
          group: packGroupOf(m.module_type),
          language: m.language_code,
          version: m.version,
          downloadBytes: m.download_size_bytes,
          storedBytes: m.installed_size_bytes,
          offlineReadable: true,
          status,
        };
        if (m.requires_module) offer.requires = [{ kind: 'module', id: m.requires_module }];
        if (inst) {
          offer.installedVersion = inst.version;
          offer.installedStoredBytes = m.installed_size_bytes;
        }
        const catalogId = m.catalogId ?? starterCatalog.get(m.module_id.toLowerCase());
        if (catalogId !== undefined) offer.catalogId = catalogId;
        return offer;
      });
    },

    async listPresets(): Promise<PackPreset[]> {
      return (await loadStarters()).map((p) => presetFromStarterPack(p));
    },

    async freeBytes(): Promise<number | null> {
      return deps.getFreeBytes ? deps.getFreeBytes() : null;
    },
  };
}
