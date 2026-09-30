import { describe, it, expect, vi } from 'vitest';
import { CHAPTER_COUNT, packPairs } from '@bible/core/browser';
import { XrefGraphIpcProvider } from './xrefGraphProvider';

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

describe('XrefGraphIpcProvider', () => {
  it('unwraps ego graphs and neighbours', async () => {
    const api = {
      getEgoGraph: vi.fn(() => ok({ anchor: 1001001, nodes: [], edges: [], truncated: false })),
      getNeighbours: vi.fn(() => ok([])),
      getBookMatrix: vi.fn(), getChapterArcs: vi.fn(),
    };
    const p = new XrefGraphIpcProvider(() => api as never);
    await expect(p.getEgoGraph(1001001, { depth: 2 })).resolves.toMatchObject({ anchor: 1001001 });
    expect(api.getEgoGraph).toHaveBeenCalledWith(1001001, { depth: 2 });
    await expect(p.getNeighbours(1001001, 5)).resolves.toEqual([]);
    expect(api.getNeighbours).toHaveBeenCalledWith(1001001, 5);
  });

  it('turns an error envelope into a rejection', async () => {
    const api = { getNeighbours: vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'internal', message: 'boom' } })) };
    await expect(new XrefGraphIpcProvider(() => api as never).getNeighbours(1001001)).rejects.toThrow('boom');
  });

  it('fetches the chapter index once and filters on the client', async () => {
    const arcs = {
      chapterCount: CHAPTER_COUNT, chapterTotals: new Uint32Array(CHAPTER_COUNT), fingerprint: 'f',
      pairs: packPairs([{ a: 0, b: 1, weight: 1000, count: 1 }, { a: 2, b: 3, weight: 10, count: 1 }]),
    };
    const api = { getChapterArcs: vi.fn(() => ok(arcs)) };
    const p = new XrefGraphIpcProvider(() => api as never);
    expect((await p.getChapterArcs()).pairs.length).toBe(8);
    expect((await p.getChapterArcs(0.5)).pairs.length).toBe(4);
    expect(api.getChapterArcs).toHaveBeenCalledTimes(1);
  });
});
