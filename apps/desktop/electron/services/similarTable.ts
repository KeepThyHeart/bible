/**
 * Similar passages (task 0070): finds and loads the precomputed neighbour table.
 *
 * Source order: `BIBLE_SIMILAR_TABLE` (dev; a .bin or .bin.gz path) -> the asset store's
 * `similar-neighbours/table.bin.gz` -> a background install when a catalog offers it
 * (unpinned, never awaited) -> missing.
 */
import { promises as fsp } from 'fs';
import zlib from 'zlib';
import log from 'electron-log';
import { NeighbourTable } from '@bible/core';
import type { INeighbourTable } from '@bible/core';
import type { SimilarTableState } from '../ipc/similarTypes';

export const SIMILAR_TABLE_ASSET_ID = 'similar-neighbours';
export const SIMILAR_TABLE_FILE = 'table.bin.gz';

/** The slice of `AssetService` this module uses (a seam for tests). */
export interface SimilarAssetSource {
  ensureReady(): Promise<void>;
  resolvePath(id: string, path: string): Promise<string | null>;
  knows(id: string): Promise<boolean>;
  assets: {
    install(id: string, opts: { pinned: boolean }): Promise<unknown>;
    getSnapshot(): { entries: Array<{ id: string; status: string }> };
  };
}

export interface SimilarTableDeps {
  getAssetService: () => SimilarAssetSource;
  env?: () => string | undefined;
  /** Called when a different table instance becomes current. */
  onChange?: () => void;
}

/** Minimum gap before a failed install is started again. */
const RETRY_MS = 60_000;

export async function readTableFile(path: string): Promise<NeighbourTable> {
  let bytes: Uint8Array = await fsp.readFile(path);
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = zlib.gunzipSync(bytes);
  return NeighbourTable.fromBytes(new Uint8Array(bytes));
}

export class SimilarTableProvider {
  private table: NeighbourTable | null = null;
  private tablePath: string | null = null;
  private lastInstallAt = 0;
  private installing = false;

  constructor(private readonly deps: SimilarTableDeps) {}

  /** The loaded table, synchronously (what the service's `table` getter returns). */
  current(): INeighbourTable | null {
    return this.table;
  }

  private async load(path: string): Promise<boolean> {
    if (this.table && this.tablePath === path) return true;
    try {
      this.table = await readTableFile(path);
      this.tablePath = path;
      this.deps.onChange?.();
      return true;
    } catch (e) {
      log.warn(`[Similar] could not read neighbour table ${path}`, e);
      this.drop();
      return false;
    }
  }

  private drop(): void {
    if (this.table) {
      this.table = null;
      this.tablePath = null;
      this.deps.onChange?.();
    }
  }

  /** Candidate files in order: the dev override, then the installed asset. */
  private async candidates(): Promise<string[]> {
    const out: string[] = [];
    const env = this.deps.env ? this.deps.env() : process.env.BIBLE_SIMILAR_TABLE;
    if (env) out.push(env);
    try {
      const installed = await this.deps.getAssetService().resolvePath(SIMILAR_TABLE_ASSET_ID, SIMILAR_TABLE_FILE);
      if (installed) out.push(installed);
    } catch (e) {
      log.warn('[Similar] asset lookup failed', e);
    }
    return out;
  }

  /**
   * Resolve and load the table; when it is absent but a catalog offers it, start a
   * background install. Cheap enough to call on every request.
   */
  async ensure(startInstall: boolean): Promise<SimilarTableState> {
    const paths = await this.candidates();
    for (const path of paths) if (await this.load(path)) return 'ready';
    if (paths.length === 0) this.drop();

    const svc = this.deps.getAssetService();
    let knows = false;
    try {
      knows = await svc.knows(SIMILAR_TABLE_ASSET_ID);
    } catch {
      return 'missing';
    }
    if (!knows) return 'missing';

    const running = this.isRunning(svc);
    if (running) return 'downloading';
    if (!startInstall) return 'available';
    if (this.installing || Date.now() - this.lastInstallAt < RETRY_MS) return 'downloading';

    this.installing = true;
    this.lastInstallAt = Date.now();
    void svc.assets
      .install(SIMILAR_TABLE_ASSET_ID, { pinned: false })
      .catch(e => {
        if ((e as { code?: string }).code !== 'aborted') log.warn('[Similar] table install failed', e);
      })
      .finally(() => {
        this.installing = false;
      });
    return 'downloading';
  }

  private isRunning(svc: SimilarAssetSource): boolean {
    const entry = svc.assets.getSnapshot().entries.find(e => e.id === SIMILAR_TABLE_ASSET_ID);
    return this.installing || entry?.status === 'queued' || entry?.status === 'downloading';
  }
}
