import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import { encodeNeighbourTable } from '@bible/core/browser';
import type { NeighbourTableMeta } from '@bible/core/browser';

const state = vi.hoisted(() => ({ manager: null as unknown, refresh: null as null | (() => Promise<void>) }));
vi.mock('../../assets/webAssets', () => ({
  getReadyAssetManager: async () => state.manager,
  refreshAssetCatalog: async () => { await state.refresh?.(); },
}));

import { loadSimilarTable, resetSimilarTable, getLoadedSimilarTable } from './similarTable';

const meta: NeighbourTableMeta = { neighbourFloor: 0.5, scoreMin: 0.5, scoreMax: 1, k: 3, levels: ['verse'], excludeWindow: 2 };
const raw = encodeNeighbourTable(meta, [
  { key: { startVerseId: 43003016, endVerseId: 43003016, level: 'verse' }, neighbours: [{ startVerseId: 45005008, endVerseId: 45005008, level: 'verse', score: 0.9 }] },
]);
const gz = new Uint8Array(gzipSync(raw));

function fakeManager(opts: { installed?: boolean; inCatalog?: boolean; file?: Uint8Array; installError?: Error }) {
  let installed = !!opts.installed;
  const m = {
    installed: vi.fn(() => (installed ? { id: 'similar-neighbours' } : undefined)),
    getSnapshot: vi.fn(() => ({ entries: opts.inCatalog ? [{ id: 'similar-neighbours' }] : [], storedBytes: 0, active: 0 })),
    install: vi.fn(async (_id: string, o?: { onProgress?: (p: unknown) => void }) => {
      if (opts.installError) throw opts.installError;
      o?.onProgress?.({ loaded: 5, total: 10 });
      installed = true;
      return {};
    }),
    readFile: vi.fn(async () => opts.file ?? gz),
  };
  state.manager = m;
  return m;
}

describe('loadSimilarTable', () => {
  beforeEach(() => { resetSimilarTable(); state.refresh = null; });

  it('reads an installed table and gunzips it', async () => {
    const m = fakeManager({ installed: true });
    const t = await loadSimilarTable();
    expect(t?.lookup({ startVerseId: 43003016, endVerseId: 43003016 })?.[0].startVerseId).toBe(45005008);
    expect(m.install).not.toHaveBeenCalled();
    expect(getLoadedSimilarTable()).toBe(t);
  });

  it('accepts a raw (uncompressed) table', async () => {
    fakeManager({ installed: true, file: raw });
    expect(await loadSimilarTable()).not.toBeNull();
  });

  it('installs on demand (unpinned) with progress', async () => {
    const m = fakeManager({ inCatalog: true });
    const onProgress = vi.fn();
    const t = await loadSimilarTable(onProgress);
    expect(t).not.toBeNull();
    expect(m.install).toHaveBeenCalledWith('similar-neighbours', expect.objectContaining({ pinned: false }));
    expect(onProgress).toHaveBeenCalledWith({ loaded: 5, total: 10 });
  });

  it('returns null when the catalog does not offer it', async () => {
    const m = fakeManager({});
    expect(await loadSimilarTable()).toBeNull();
    expect(m.install).not.toHaveBeenCalled();
  });

  it('memoises, and forgets the memo after an AssetError', async () => {
    const err = Object.assign(new Error('offline'), { name: 'AssetError', code: 'offline' });
    const m = fakeManager({ inCatalog: true, installError: err });
    await expect(loadSimilarTable()).rejects.toThrow('offline');
    await Promise.resolve();
    const m2 = fakeManager({ inCatalog: true });
    expect(await loadSimilarTable()).not.toBeNull();
    const first = loadSimilarTable();
    expect(loadSimilarTable()).toBe(first);
    expect(m.install).toHaveBeenCalledTimes(1);
    expect(m2.install).toHaveBeenCalledTimes(1);
  });

  it('does not memoise a null after a failed catalog fetch, but keeps a definite not-offered', async () => {
    let fail = true;
    const m = fakeManager({});
    const refresh = vi.fn(async () => { if (fail) throw new Error('offline'); });
    state.refresh = refresh;
    expect(await loadSimilarTable()).toBeNull();
    expect(await loadSimilarTable()).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(2); // retried, not memoised
    fail = false;
    expect(await loadSimilarTable()).toBeNull();
    expect(await loadSimilarTable()).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(3); // definite null is memoised
    expect(m.install).not.toHaveBeenCalled();
  });
});
