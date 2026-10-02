/**
 * The web app's single `AssetManager` (task 0090): Cache Storage for bytes and the registry,
 * `fetch` for transport. Without the Cache API (old browsers, some private modes) it falls back to
 * the in-memory store, so downloads still work for the session.
 *
 * The catalog is `/assets/v1/index.json` plus Piper's manifests (audio on and Piper configured).
 */

import {
  AssetManager,
  MemoryAssetRegistryStore,
  MemoryAssetStore,
  parseAssetIndex,
} from '@bible/core/browser';
import type {
  AssetManifest,
  IAssetManager,
  IAssetRegistryStore,
  IAssetStore,
  InstallOptions,
  InstalledAsset,
  TtsEngineConfig,
} from '@bible/core/browser';
import { getAudioConfig } from '../audio/config';
import { CacheAssetRegistryStore, CacheAssetStore } from './CacheAssetStore';
import { FetchTransport } from './FetchTransport';
import { loadPiperManifests } from './piperAssets';

const baseUrl = (): string => {
  try {
    return import.meta.env.BASE_URL || '/';
  } catch {
    return '/';
  }
};

export const assetIndexUrl = (): string => new URL(`${baseUrl().replace(/\/?$/, '/')}assets/v1/index.json`, typeof location !== 'undefined' ? location.href : 'http://localhost/').href;

/** Asks the browser to keep stored data on the first pinned (user-requested) install. Best effort. */
class WebAssetManager extends AssetManager {
  private persistAsked = false;

  override install(target: AssetManifest | string, opts?: InstallOptions): Promise<InstalledAsset> {
    if (opts?.pinned && !this.persistAsked) {
      this.persistAsked = true;
      try {
        void navigator.storage?.persist?.().catch(() => {});
      } catch { /* not available */ }
    }
    return super.install(target, opts);
  }
}

export function createWebStores(storage: CacheStorage | undefined = typeof caches !== 'undefined' ? caches : undefined): {
  store: IAssetStore;
  registry: IAssetRegistryStore;
} {
  if (storage) return { store: new CacheAssetStore(storage), registry: new CacheAssetRegistryStore(storage) };
  return { store: new MemoryAssetStore(), registry: new MemoryAssetRegistryStore() };
}

let manager: IAssetManager | null = null;
let transport: FetchTransport | null = null;
let ready: Promise<void> | null = null;
let catalogRefresh: Promise<void> | null = null;

function getTransport(): FetchTransport {
  return (transport ??= new FetchTransport());
}

/** The shared manager (init and the first catalog refresh start on the first call). */
export function getAssetManager(): IAssetManager {
  if (!manager) {
    const { store, registry } = createWebStores();
    manager = new WebAssetManager({ transport: getTransport(), store, registry });
    const m = manager;
    ready = m.init().catch(() => {});
    void ready.then(() => refreshAssetCatalog());
  }
  return manager;
}

/** The shared manager once its registry is loaded. */
export async function getReadyAssetManager(): Promise<IAssetManager> {
  const m = getAssetManager();
  await ready;
  return m;
}

export function piperConfig(): TtsEngineConfig | undefined {
  return getAudioConfig()?.engines.find((e) => e.id === 'piper' && e.enabled);
}

/** Fetch the catalog and hand it to the manager. Failures leave the previous catalog; never throws. */
export function refreshAssetCatalog(): Promise<void> {
  if (catalogRefresh) return catalogRefresh;
  const m = getAssetManager();
  const run = async () => {
    const signal = new AbortController().signal;
    const t = getTransport();
    const manifests: AssetManifest[] = [];
    let indexOk = true;
    const url = assetIndexUrl();
    try {
      const text = await t.getText(url, signal);
      if (text !== null) manifests.push(...parseAssetIndex(JSON.parse(text), url).assets);
    } catch {
      indexOk = false;
    }
    const piper = piperConfig();
    if (piper) {
      try {
        const extra = await loadPiperManifests(piper, (u, s) => t.getText(u, s), signal);
        const seen = new Set(manifests.map((x) => x.id));
        manifests.push(...extra.filter((x) => !seen.has(x.id)));
      } catch { /* keep what we have */ }
    }
    if (indexOk || manifests.length > 0) m.setCatalog(manifests);
  };
  catalogRefresh = run().finally(() => { catalogRefresh = null; });
  return catalogRefresh;
}

/** Test seam. */
export function setAssetManagerForTests(m: IAssetManager | null): void {
  manager = m;
  ready = m ? Promise.resolve() : null;
  transport = null;
  catalogRefresh = null;
}
