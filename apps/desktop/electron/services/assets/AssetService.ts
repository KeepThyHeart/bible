/**
 * Desktop asset service (task 0090): the `AssetManager` for the main process.
 *
 * The renderer only ever sends asset ids (see `ipc/assetHandlers.ts`); the manifests (urls,
 * digests, sizes) come from the enabled catalogs' `assets` sections and, for development,
 * the unsigned index named by `BIBLE_ASSET_INDEX_URL`.
 */

import log from 'electron-log';
import {
  AssetManager,
  parseAssetIndex,
  type AssetListSnapshot,
  type AssetManifest,
  type IAssetManager,
} from '@bible/core/browser';
import { ModuleCatalogService } from '../ModuleCatalogService';
import { getSharedMainDb } from '../sharedMainDb';
import { getNetworkGateway, type INetworkGateway } from '../NetworkGateway';
import { getAssetStoreRoot } from '../../utils/appPaths';
import { FsAssetRegistryStore, FsAssetStore, createNodeHasher } from './FsAssetStore';
import { GatewayTransport } from './GatewayTransport';

export interface AssetServiceDeps {
  root: string;
  gateway: INetworkGateway;
  /** Validated (absolute-url) manifests from the enabled catalogs. */
  getCatalogAssets: () => AssetManifest[];
  /** Env lookup seam (`BIBLE_ASSET_INDEX_URL`). */
  getDevIndexUrl?: () => string | undefined;
  /** Manager overrides for tests. */
  managerOptions?: Partial<ConstructorParameters<typeof AssetManager>[0]>;
}

export class AssetService {
  private readonly store: FsAssetStore;
  private readonly transport: GatewayTransport;
  private readonly manager: AssetManager;
  private ready: Promise<void> | null = null;
  private wasActive = false;

  constructor(private readonly deps: AssetServiceDeps) {
    this.store = new FsAssetStore(deps.root);
    this.transport = new GatewayTransport(deps.gateway);
    this.manager = new AssetManager({
      transport: this.transport,
      store: this.store,
      registry: new FsAssetRegistryStore(this.store.registryPath),
      createHasher: createNodeHasher,
      log: (message, detail) => log.info(`[Assets] ${message}`, detail ?? ''),
      ...deps.managerOptions,
    });
    // After a job ends, reclaim old-version files the manager's url-keyed cleanup left behind.
    this.manager.subscribe(() => {
      const active = this.manager.getSnapshot().active > 0;
      if (this.wasActive && !active) void this.pruneOldVersions();
      this.wasActive = active;
    });
  }

  /** The manager, for in-process consumers (0059/0071/0070). Call `ensureReady()` first. */
  get assets(): IAssetManager {
    return this.manager;
  }

  ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.manager.init();
        await this.loadCatalog();
        await this.pruneOldVersions();
      })().catch((e) => {
        this.ready = null;
        throw e;
      });
    }
    return this.ready;
  }

  private async pruneOldVersions(): Promise<void> {
    try {
      await this.store.pruneOtherVersions(
        this.manager.getSnapshot().entries
          .filter((e) => e.installedVersion !== undefined)
          .map((e) => ({ kind: e.kind, id: e.id, version: e.installedVersion as string })),
        // A new install may start (or finish) while we scan: re-check per removal.
        (_kind, id, version) => {
          const e = this.manager.getSnapshot().entries.find((x) => x.id === id);
          if (!e) return true;
          if (e.status === 'queued' || e.status === 'downloading') return false;
          return e.installedVersion !== version;
        },
      );
    } catch (e) {
      log.warn('[Assets] pruning old versions failed', e);
    }
  }

  /** Re-read the catalogs and the dev index; catalog entries win on an id clash. */
  private async loadCatalog(): Promise<void> {
    const merged = new Map<string, AssetManifest>();
    const devUrl = this.deps.getDevIndexUrl?.();
    if (devUrl) {
      try {
        const text = await this.transport.getText(devUrl, new AbortController().signal);
        if (text === null) {
          log.warn(`[Assets] dev index ${devUrl} not found`);
        } else {
          log.warn(`[Assets] using UNSIGNED dev asset index ${devUrl} (BIBLE_ASSET_INDEX_URL)`);
          const { assets, rejected } = parseAssetIndex(JSON.parse(text), devUrl);
          for (const r of rejected) log.warn(`[Assets] ignoring dev index entry #${r.index}: ${r.errors.join('; ')}`);
          for (const a of assets) merged.set(a.id, a);
        }
      } catch (e) {
        log.warn(`[Assets] could not load dev index ${devUrl}`, e);
      }
    }
    for (const a of this.deps.getCatalogAssets()) merged.set(a.id, a);
    this.manager.setCatalog([...merged.values()]);
  }

  async list(): Promise<AssetListSnapshot> {
    await this.ensureReady();
    return this.manager.getSnapshot();
  }

  async refresh(): Promise<AssetListSnapshot> {
    await this.ensureReady();
    await this.loadCatalog();
    return this.manager.getSnapshot();
  }

  /** True when `id` is offered by a catalog or installed. */
  async knows(id: string): Promise<boolean> {
    await this.ensureReady();
    return this.manager.getSnapshot().entries.some((e) => e.id === id);
  }

  /** Start an explicit (pinned) install; not awaited by callers. Failures land in the entry `error`. */
  async install(id: string): Promise<void> {
    await this.ensureReady();
    try {
      await this.manager.install(id, { pinned: true });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'aborted') log.warn(`[Assets] install of ${id} failed`, e);
    }
  }

  async cancel(id: string): Promise<boolean> {
    await this.ensureReady();
    const entry = this.manager.getSnapshot().entries.find((e) => e.id === id);
    const running = entry?.status === 'queued' || entry?.status === 'downloading';
    if (running) this.manager.cancel(id);
    return !!running;
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureReady();
    const entry = this.manager.getSnapshot().entries.find((e) => e.id === id);
    const had = !!entry && (entry.storedBytes > 0 || entry.status === 'queued' || entry.status === 'downloading' || entry.installedVersion !== undefined);
    await this.manager.remove(id);
    return had;
  }

  /** Absolute path of an installed file for main-process consumers (marks the asset used), else null. */
  async resolvePath(id: string, path: string): Promise<string | null> {
    await this.ensureReady();
    const inst = this.manager.installed(id);
    const file = inst?.files.find((f) => f.path === path);
    if (!inst || !file) return null;
    const ref = {
      assetId: inst.id, kind: inst.kind, version: inst.version,
      path: file.path, url: file.url, size: file.size,
    };
    if (!(await this.store.exists(ref))) return null;
    this.manager.markUsed(id);
    return this.store.pathOf(ref);
  }

  /** Persist a pending last-used update (call on app quit). */
  async flush(): Promise<void> {
    await this.manager.flush();
  }
}

let instance: AssetService | null = null;

export function getAssetService(): AssetService {
  if (!instance) {
    let catalogs: ModuleCatalogService | null = null;
    instance = new AssetService({
      root: getAssetStoreRoot(),
      gateway: getNetworkGateway(),
      getCatalogAssets: () => {
        catalogs ??= new ModuleCatalogService(getSharedMainDb());
        return catalogs.getAvailableAssets();
      },
      getDevIndexUrl: () => process.env.BIBLE_ASSET_INDEX_URL || undefined,
    });
  }
  return instance;
}

/** Flush on quit and drop the singleton. */
export async function closeAssetService(): Promise<void> {
  const svc = instance;
  instance = null;
  if (svc) await svc.flush().catch((e) => log.warn('[Assets] flush failed', e));
}

export function __resetAssetServiceForTests(): void {
  instance = null;
}
