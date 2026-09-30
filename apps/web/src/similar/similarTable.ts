/**
 * Loads the precomputed similar-passages neighbour table (task 0070) from the asset store.
 *
 * The table is the `similar-neighbours` data asset (`table.bin.gz`). Installed: read it. Not installed but
 * offered by the catalog: install it unpinned (evictable; it shows in Settings > Downloads) and read it.
 * Neither: null, which the pane reports as "not available on this server". Nothing user-specific is stored.
 */

import { NeighbourTable } from '@bible/core/browser';
import type { AssetProgress } from '@bible/core/browser';
import { getReadyAssetManager, refreshAssetCatalog } from '../assets/webAssets';

export const SIMILAR_ASSET_ID = 'similar-neighbours';
export const SIMILAR_ASSET_FILE = 'table.bin.gz';

export type SimilarTableProgress = (p: { loaded: number; total: number }) => void;

let memo: Promise<NeighbourTable | null> | null = null;
let loaded: NeighbourTable | null = null;

/** The table once loaded, else null (the service reads it through this getter). */
export function getLoadedSimilarTable(): NeighbourTable | null {
  return loaded;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes; // raw .bin
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress the similar passages data (DecompressionStream is missing).');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function load(onProgress?: SimilarTableProgress): Promise<NeighbourTable | null> {
  const m = await getReadyAssetManager();
  if (!m.installed(SIMILAR_ASSET_ID)) {
    let offered = m.getSnapshot().entries.some((e) => e.id === SIMILAR_ASSET_ID);
    if (!offered) {
      try { await refreshAssetCatalog(); } catch { /* keep going with what we have */ }
      offered = m.getSnapshot().entries.some((e) => e.id === SIMILAR_ASSET_ID);
    }
    if (!offered) return null;
    await m.install(SIMILAR_ASSET_ID, {
      pinned: false,
      onProgress: (p: AssetProgress) => onProgress?.({ loaded: p.loaded, total: p.total }),
    });
  }
  const raw = await m.readFile(SIMILAR_ASSET_ID, SIMILAR_ASSET_FILE);
  const table = NeighbourTable.fromBytes(await gunzip(raw));
  loaded = table;
  return table;
}

/** Memoised. A failed load (AssetError, bad bytes) is forgotten so the next call retries; a null (not offered) is kept. */
export function loadSimilarTable(onProgress?: SimilarTableProgress): Promise<NeighbourTable | null> {
  if (!memo) {
    const p = load(onProgress);
    memo = p;
    p.catch(() => {
      if (memo === p) memo = null;
    });
  }
  return memo;
}

/** Test seam (and "try again" after an unavailable answer). */
export function resetSimilarTable(): void {
  memo = null;
  loaded = null;
}
