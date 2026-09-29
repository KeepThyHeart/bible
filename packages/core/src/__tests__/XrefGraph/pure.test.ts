import { describe, it, expect } from 'vitest';
import {
  CHAPTER_COUNT, bookOf, chapterIndex, chapterFromIndex, canonPosition, bookFirstChapterIndex,
  edgeWeight, baseWeight, weightStep,
  packPairs, unpackPairs, filterPairs, encodeChapterArcs, decodeChapterArcs, uint32ToBytes, bytesToUint32,
  buildEgoGraph,
} from '../../Services/XrefGraph';
import type { XrefEdge } from '../../Services/XrefGraph';

describe('canon geometry', () => {
  it('has 1189 chapters', () => {
    expect(CHAPTER_COUNT).toBe(1189);
  });
  it('maps verse ids to chapter indexes and back', () => {
    expect(chapterIndex(1001001)).toBe(0);
    expect(chapterIndex(66022021)).toBe(1188);
    expect(chapterFromIndex(0)).toEqual({ book: 1, chapter: 1 });
    expect(chapterFromIndex(1188)).toEqual({ book: 66, chapter: 22 });
    for (let i = 0; i < CHAPTER_COUNT; i++) {
      const { book, chapter } = chapterFromIndex(i);
      expect(chapterIndex(book * 1_000_000 + chapter * 1000 + 1)).toBe(i);
    }
  });
  it('rejects verse ids outside the canon', () => {
    expect(chapterIndex(67001001)).toBe(-1);
    expect(chapterIndex(1051001)).toBe(-1);
    expect(chapterIndex(0)).toBe(-1);
  });
  it('orders canon positions and keeps them inside 0..1', () => {
    expect(canonPosition(1001001)).toBeLessThan(canonPosition(43003016));
    expect(canonPosition(43003016)).toBeLessThan(canonPosition(66022021));
    expect(canonPosition(66022021)).toBeLessThan(1);
    expect(canonPosition(19119176)).toBeLessThan(canonPosition(19120001));
  });
  it('knows where each book starts', () => {
    expect(bookFirstChapterIndex(2)).toBe(50);
    expect(bookOf(43003016)).toBe(43);
  });
});

describe('edgeWeight', () => {
  const ranked = (rank: number) => ({ source: 'TSK', kind: 'ranked' as const, rank });
  it('is 1 for the first TSK link and decays with rank', () => {
    expect(baseWeight(ranked(0))).toBe(1);
    expect(baseWeight(ranked(10))).toBeCloseTo(0.4);
    expect(edgeWeight({ items: [ranked(0)], reciprocal: false })).toBe(1);
    expect(edgeWeight({ items: [ranked(5)], reciprocal: false })).toBeLessThan(edgeWeight({ items: [ranked(2)], reciprocal: false }));
  });
  it('boosts reciprocal links but never past 1', () => {
    const plain = edgeWeight({ items: [ranked(10)], reciprocal: false });
    const both = edgeWeight({ items: [ranked(10)], reciprocal: true });
    expect(both).toBeCloseTo(plain * 1.25);
    expect(edgeWeight({ items: [ranked(0)], reciprocal: true })).toBe(1);
  });
  it('rewards agreement between sources', () => {
    const one = edgeWeight({ items: [ranked(10)], reciprocal: false });
    const two = edgeWeight({ items: [ranked(10), { source: 'OBI', kind: 'votes', votes: 1, maxVotes: 100 }], reciprocal: false });
    expect(two).toBeGreaterThan(one);
  });
  it('drops non-positive votes and treats user links as strong', () => {
    expect(edgeWeight({ items: [{ source: 'OBI', kind: 'votes', votes: -3, maxVotes: 50 }], reciprocal: false })).toBe(0);
    expect(edgeWeight({ items: [{ source: 'user', kind: 'user' }], reciprocal: false })).toBe(1);
    expect(edgeWeight({ items: [], reciprocal: false })).toBe(0);
  });
  it('applies per-source trust', () => {
    expect(edgeWeight({ items: [ranked(0)], reciprocal: false, trust: { TSK: 0.5 } })).toBe(0.5);
  });
  it('maps weights to 1..5 steps', () => {
    expect(weightStep(0)).toBe(1);
    expect(weightStep(0.5)).toBe(3);
    expect(weightStep(1)).toBe(5);
  });
});

describe('chapter-pair packing', () => {
  const pairs = [
    { a: 0, b: 5, weight: 1200, count: 3 },
    { a: 2, b: 1000, weight: 300, count: 1 },
    { a: 7, b: 8, weight: 4_000_000_000, count: 9 },
  ];
  it('round-trips through Uint32Array and bytes', () => {
    expect(unpackPairs(packPairs(pairs))).toEqual(pairs);
    const packed = packPairs(pairs);
    expect(Array.from(bytesToUint32(uint32ToBytes(packed)))).toEqual(Array.from(packed));
  });
  it('is little-endian on the wire', () => {
    expect(Array.from(uint32ToBytes(Uint32Array.of(0x01020304)))).toEqual([4, 3, 2, 1]);
  });
  it('encodes and decodes a whole arcs block', () => {
    const totals = new Uint32Array(CHAPTER_COUNT);
    totals[3] = 77;
    const arcs = { chapterCount: CHAPTER_COUNT, pairs: packPairs(pairs), chapterTotals: totals, fingerprint: 'abc' };
    const back = decodeChapterArcs(encodeChapterArcs(arcs), 'abc');
    expect(Array.from(back.pairs)).toEqual(Array.from(arcs.pairs));
    expect(back.chapterTotals[3]).toBe(77);
    expect(() => decodeChapterArcs(new Uint8Array(8), 'x')).toThrow();
  });
  it('filters by a fraction of the heaviest pair', () => {
    const arcs = { chapterCount: CHAPTER_COUNT, pairs: packPairs(pairs.slice(0, 2)), chapterTotals: new Uint32Array(CHAPTER_COUNT), fingerprint: '' };
    expect(unpackPairs(filterPairs(arcs, 0.5)).length).toBe(1);
    expect(filterPairs(arcs, 0)).toBe(arcs.pairs);
  });
});

/** A small symmetric graph: hub 1 links to 2..N, each of 2..N links to two private leaves. */
function fakeGraph(hubDegree: number) {
  const adj = new Map<number, XrefEdge[]>();
  const add = (from: number, to: number, weight: number) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ from, to, weight, sources: ['TSK'], direction: 'both' });
  };
  for (let i = 0; i < hubDegree; i++) {
    const v = 100 + i;
    const w = 1 - i / (hubDegree * 2);
    add(1, v, w); add(v, 1, w);
    for (let k = 0; k < 2; k++) {
      const leaf = 1000 + i * 10 + k;
      add(v, leaf, 0.5); add(leaf, v, 0.5);
    }
  }
  for (const list of adj.values()) list.sort((a, b) => b.weight - a.weight || a.to - b.to);
  return (v: number) => adj.get(v) ?? [];
}

describe('buildEgoGraph', () => {
  it('returns the anchor alone when there are no links', () => {
    const g = buildEgoGraph(5, { depth: 2 }, () => []);
    expect(g.nodes).toEqual([{ verseId: 5, hop: 0, degree: 0 }]);
    expect(g.edges).toEqual([]);
    expect(g.truncated).toBe(false);
  });
  it('keeps the strongest links when the budget is smaller than the fan-out', () => {
    const g = buildEgoGraph(1, { depth: 1, maxNodes: 6 }, fakeGraph(20));
    expect(g.nodes.length).toBe(6);
    expect(g.truncated).toBe(true);
    expect(g.nodes.map(n => n.verseId).sort()).toEqual([1, 100, 101, 102, 103, 104]);
  });
  it('never exceeds the budget at depth 3 and reports hops', () => {
    const g = buildEgoGraph(1, { depth: 3, maxNodes: 30 }, fakeGraph(20));
    expect(g.nodes.length).toBeLessThanOrEqual(30);
    expect(Math.max(...g.nodes.map(n => n.hop))).toBeGreaterThanOrEqual(2);
    const ids = new Set(g.nodes.map(n => n.verseId));
    for (const e of g.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
  });
  it('leaves room for later hops', () => {
    const g = buildEgoGraph(1, { depth: 2, maxNodes: 20 }, fakeGraph(30));
    expect(g.nodes.some(n => n.hop === 1)).toBe(true);
    expect(g.nodes.some(n => n.hop === 2)).toBe(true);
  });
  it('emits each undirected pair once and fills degrees', () => {
    const g = buildEgoGraph(1, { depth: 1, maxNodes: 200 }, fakeGraph(3));
    expect(g.edges.length).toBe(3 + 0 + 6 * 0);
    expect(g.nodes.find(n => n.verseId === 1)!.degree).toBe(3);
    expect(g.nodes.find(n => n.verseId === 100)!.degree).toBe(3);
  });
  it('honours minWeight and clamps the budget', () => {
    const g = buildEgoGraph(1, { depth: 1, minWeight: 0.9, maxNodes: 9999 }, fakeGraph(20));
    expect(g.nodes.length).toBeLessThan(21);
    expect(g.truncated).toBe(true);
  });
  it('keeps range targets as their start with the end recorded', () => {
    const g = buildEgoGraph(1, { depth: 1 }, v => v === 1 ? [{ from: 1, to: 10, toEnd: 13, weight: 0.8, sources: ['TSK'], direction: 'out' }] : []);
    expect(g.nodes.find(n => n.verseId === 10)!.endVerseId).toBe(13);
  });
});
