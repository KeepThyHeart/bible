import { describe, it, expect, vi } from 'vitest';
import { encodeChapterArcs, packPairs, CHAPTER_COUNT } from '@bible/core/browser';
import { XrefGraphProvider } from './XrefGraphProvider';

function json(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('XrefGraphProvider', () => {
  it('asks for an ego graph with its options', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ anchor: 1, nodes: [], edges: [], truncated: false }));
    const p = new XrefGraphProvider('/x', fetcher);
    await p.getEgoGraph(43003016, { depth: 2, maxNodes: 40, minWeight: 0.3, sources: ['TSK'] });
    expect(fetcher).toHaveBeenCalledWith('/x/ego/43003016?depth=2&maxNodes=40&minWeight=0.3&sources=TSK');
  });

  it('asks for ranked neighbours with a limit', async () => {
    const fetcher = vi.fn().mockResolvedValue(json([]));
    await new XrefGraphProvider('/x', fetcher).getNeighbours(1001001, 12);
    expect(fetcher).toHaveBeenCalledWith('/x/neighbours/1001001?limit=12');
  });

  it('throws on a failed response', async () => {
    const p = new XrefGraphProvider('/x', vi.fn().mockResolvedValue(json({}, false, 500)));
    await expect(p.getNeighbours(1001001)).rejects.toThrow(/500/);
  });

  it('decodes the chapter index once and filters by weight on the client', async () => {
    const totals = new Uint32Array(CHAPTER_COUNT);
    const bytes = encodeChapterArcs({
      chapterCount: CHAPTER_COUNT, chapterTotals: totals, fingerprint: 'fp',
      pairs: packPairs([{ a: 0, b: 1, weight: 1000, count: 2 }, { a: 2, b: 3, weight: 100, count: 1 }]),
    });
    const fetcher = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      headers: { get: (k: string) => (k === 'X-Xref-Fingerprint' ? 'fp' : null) },
    } as unknown as Response);
    const p = new XrefGraphProvider('/x', fetcher);
    const all = await p.getChapterArcs();
    expect(all.fingerprint).toBe('fp');
    expect(all.pairs.length).toBe(8);
    const heavy = await p.getChapterArcs(0.5);
    expect(heavy.pairs.length).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed index fetch so a retry can succeed', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({}, false, 503))
      .mockResolvedValueOnce(json({ books: [[1]] }));
    const p = new XrefGraphProvider('/x', fetcher);
    await expect(p.getBookMatrix()).rejects.toThrow();
    await expect(p.getBookMatrix()).resolves.toEqual([[1]]);
  });
});
