import { describe, expect, it } from 'vitest';
import { GenealogyGraph } from './GenealogyGraph';
import { layoutLineage } from './layoutLineage';
import type { GenealogyDatasetDto, GenealogyEdgeDto, GraphLayout, LineageDto } from './types';

function expectSane(l: GraphLayout): void {
  const ids = l.nodes.map(n => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (let i = 0; i < l.nodes.length; i++) {
    const a = l.nodes[i];
    const b0 = l.bounds;
    expect(a.x - a.w / 2).toBeGreaterThanOrEqual(b0.x);
    expect(a.x + a.w / 2).toBeLessThanOrEqual(b0.x + b0.w);
    expect(a.y - a.h / 2).toBeGreaterThanOrEqual(b0.y);
    expect(a.y + a.h / 2).toBeLessThanOrEqual(b0.y + b0.h);
    for (let j = i + 1; j < l.nodes.length; j++) {
      const b = l.nodes[j];
      const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
  for (const e of l.edges) {
    expect(ids).toContain(e.from);
    expect(ids).toContain(e.to);
  }
}

let eid = 0;
const father = (from: string, to: string, extra: Partial<GenealogyEdgeDto> = {}): GenealogyEdgeDto =>
  ({ id: `e${++eid}`, from, to, type: 'father_of', verses: [{ start: 40001002, end: 40001002 }], ...extra });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_.*/, '');
const lineage = (id: string, direction: 'ascending' | 'descending', ids: string[], gaps: Record<string, string[]> = {}): LineageDto => ({
  id, name: id, kind: 'genealogy', direction, range: { start: 1, end: 2 },
  steps: ids.map((p, i) => ({ personId: p, verseId: 1000 + i, ...(gaps[p] ? { gapBefore: gaps[p] } : {}) })),
});

function christDataset(): GenealogyDatasetDto {
  const pre = ['adam', 'seth', 'arphaxad', 'cainan', 'sala', 'terah'];
  const shared = ['abraham', 'isaac', 'jacob', 'judah', 'david'];
  const mt = ['solomon', 'rehoboam', 'joram', 'ozias', 'salathiel_mt', 'abiud'];
  const lk = ['nathan', 'mattatha', 'salathiel_lk', 'rhesa', 'heli'];
  const all = [...pre, ...shared, ...mt, ...lk, 'ahaziah', 'joash', 'amaziah', 'joseph', 'jesus'];
  const matthew = [...shared, ...mt, 'joseph', 'jesus'];
  const luke = ['jesus', 'joseph', ...[...lk].reverse(), ...[...shared].reverse(), ...[...pre].reverse()];
  const edges: GenealogyEdgeDto[] = [];
  const chain = (ids: string[]) => { for (let i = 1; i < ids.length; i++) edges.push(father(ids[i - 1], ids[i])); };
  chain([...pre, ...shared]);
  chain(['david', ...mt, 'joseph']);
  chain(['david', ...lk]);
  edges.push(father('joseph', 'jesus', { qualifier: 'legal' }));
  edges.push({ id: 'same', from: 'salathiel_mt', to: 'salathiel_lk', type: 'possibly_same_as', verses: [] });
  return {
    module: 't', sources: [],
    persons: all.map(id => ({ id, name: cap(id), kind: 'individual', sex: 'male' })),
    edges,
    lineages: [
      lineage('genesis_11', 'descending', ['arphaxad', 'sala', 'terah', 'abraham']),
      lineage('matthew_1', 'descending', matthew, { ozias: ['ahaziah', 'joash', 'amaziah'] }),
      lineage('luke_3', 'ascending', luke),
    ],
  };
}

describe('layoutLineage', () => {
  it('draws the spine, the Matthew/Luke fork, gaps, one-text-only persons and same-as links', () => {
    const g = GenealogyGraph.from(christDataset());
    const l = layoutLineage(g);
    expectSane(l);
    const n = (id: string) => l.nodes.find(x => x.id === id)!;
    for (const id of ['adam', 'terah', 'abraham', 'david', 'joseph', 'jesus']) expect(n(id).y).toBe(0);
    expect(n('adam').x).toBeLessThan(n('abraham').x);
    expect(n('solomon').y).toBeLessThan(0);
    expect(n('nathan').y).toBeGreaterThan(0);
    // Shorter Luke track stretched between David and Joseph.
    for (const id of ['nathan', 'heli', 'solomon', 'abiud']) {
      expect(n(id).x).toBeGreaterThan(n('david').x);
      expect(n(id).x).toBeLessThan(n('joseph').x);
    }
    expect(n('ozias').flags.gapNote).toBe('3 not named: Ahaziah, Joash, Amaziah');
    const gap = l.edges.find(e => e.from === 'joram' && e.to === 'ozias')!;
    expect(gap.kind).toBe('gap');
    expect(gap.style).toBe('dashed');
    expect(n('cainan').flags.oneTextOnly).toBe(true);
    expect(n('solomon').flags.oneTextOnly).toBeFalsy();
    const same = l.edges.find(e => e.kind === 'same_as')!;
    expect(same.style).toBe('dotted');
    expect(n('salathiel_mt').flags.disputed).toBe(true);
    expect(l.edges.find(e => e.from === 'joseph' && e.to === 'jesus')!.style).toBe('double');
    expect(n('jesus').importance).toBe(0);
    expect(n('seth').importance).toBe(1);
    expect(n('adam').flags.onLineToChrist).toBe(true);
    expect(n('heli').flags.lineages).toEqual(['luke_3']);
    expect(n('david').flags.lineages).toEqual(['matthew_1', 'luke_3']);
  });

  it('can skip the highlight', () => {
    const l = layoutLineage(GenealogyGraph.from(christDataset()), { highlightLineToChrist: false });
    expect(l.nodes.some(n => n.flags.onLineToChrist)).toBe(false);
  });

  it('is deterministic', () => {
    const a = layoutLineage(GenealogyGraph.from(christDataset()));
    const b = layoutLineage(GenealogyGraph.from(christDataset()));
    expect(a).toEqual(b);
  });

  it('forks an insertion off the main track and handles order conflicts', () => {
    const ids = ['a', 'b', 'c', 'd', 'x'];
    const ds: GenealogyDatasetDto = {
      module: 't', sources: [], edges: [],
      persons: ids.map(id => ({ id, name: id.toUpperCase(), kind: 'individual' })),
      lineages: [
        lineage('one', 'descending', ['a', 'b', 'c', 'd']),
        lineage('two', 'descending', ['a', 'b', 'x', 'c', 'd']),
        lineage('three', 'descending', ['a', 'c', 'b']),
      ],
    };
    const g = GenealogyGraph.from(ds);
    const l = layoutLineage(g, { lineageIds: ['one', 'two'] });
    expectSane(l);
    const x = l.nodes.find(n => n.id === 'x')!;
    expect(x.flags.oneTextOnly).toBe(true);
    expect(x.y).not.toBe(0);
    const all = layoutLineage(g);
    expectSane(all);
    expect(all.nodes.some(n => n.id.includes('@'))).toBe(true);
  });

  it('returns an empty layout without lineages', () => {
    const l = layoutLineage(GenealogyGraph.from({ module: 't', sources: [], edges: [], persons: [], lineages: [] }));
    expect(l.nodes).toEqual([]);
  });
});
