/**
 * Loads the precomputed similar-passages neighbour table (task 0070) from the asset store.
 *
 * The table is the `similar-neighbours` data asset (`table.bin.gz`). Installed: read it. Not installed but
 * offered by the catalog: install it unpinned (evictable; it shows in Settings > Downloads) and read it.
 * Neither: null, which the pane reports as "not available on this server". Nothing user-specific is stored.
 */

import { NeighbourTable } from '@bible/core/browser';
import type { AssetProgress } from '@bible/core/browser';
import { getReadyAssetManager, refreshAssetCatalog } from '../../assets/webAssets';

import { SIMILAR_ASSET_ID } from './assetId';
export { SIMILAR_ASSET_ID };
export const SIMILAR_ASSET_FILE = 'table.bin.gz';

export type SimilarTableProgress = (p: { loaded: number; total: number }) => void;

let memo: Promise<NeighbourTable | null> | null = null;
let loaded: NeighbourTable | null = null;
/** True only when the last load ended null after a successful catalog read (a definite "not offered"). */
let definiteNull = false;

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
  let catalogRead = false;
  definiteNull = false;
  const m = await getReadyAssetManager();
  if (!m.installed(SIMILAR_ASSET_ID)) {
    let offered = m.getSnapshot().entries.some((e) => e.id === SIMILAR_ASSET_ID);
    if (!offered) {
      try {
        await refreshAssetCatalog();
        catalogRead = true;
      } catch { /* keep going with what we have; a null from here is not definite */ }
      offered = m.getSnapshot().entries.some((e) => e.id === SIMILAR_ASSET_ID);
    }
    if (!offered) {
      definiteNull = catalogRead;
      return null;
    }
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

/** Memoised. A failed load (AssetError, bad bytes) is forgotten so the next call retries; a null is kept only when the catalog was read successfully and does not offer the table. */
export function loadSimilarTable(onProgress?: SimilarTableProgress): Promise<NeighbourTable | null> {
  if (!memo) {
    const p = load(onProgress);
    memo = p;
    p.then(
      (t) => { if (t === null && !definiteNull && memo === p) memo = null; },
      () => { if (memo === p) memo = null; },
    );
  }
  return memo;
}

/** Test seam (and "try again" after an unavailable answer). */
export function resetSimilarTable(): void {
  memo = null;
  loaded = null;
  definiteNull = false;
}
