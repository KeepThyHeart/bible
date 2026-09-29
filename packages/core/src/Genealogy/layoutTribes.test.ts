import { describe, expect, it } from 'vitest';
import { GenealogyGraph } from './GenealogyGraph';
import { layoutTribes } from './layoutTribes';
import type { GenealogyDatasetDto, GenealogyEdgeDto, GraphLayout } from './types';

function expectSane(l: GraphLayout): void {
  const ids = l.nodes.map(n => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  const b0 = l.bounds;
  for (let i = 0; i < l.nodes.length; i++) {
    const a = l.nodes[i];
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
  for (const e of l.edges) { expect(ids).toContain(e.from); expect(ids).toContain(e.to); }
}

let eid = 0;
const edge = (type: string, from: string, to: string): GenealogyEdgeDto =>
  ({ id: `e${++eid}`, from, to, type, verses: [{ start: 1029001, end: 1029001 }] });

function jacobDataset(): GenealogyDatasetDto {
  const mothers: Record<string, string[]> = {
    leah: ['reuben', 'simeon', 'levi', 'judah', 'issachar', 'zebulun'],
    bilhah: ['dan', 'naphtali'],
    zilpah: ['gad', 'asher'],
    rachel: ['joseph', 'benjamin'],
  };
  const edges: GenealogyEdgeDto[] = [];
  for (const w of ['leah', 'rachel', 'bilhah', 'zilpah']) edges.push(edge('husband_of', 'jacob', w));
  for (const [m, sons] of Object.entries(mothers)) {
    for (const s of sons) edges.push(edge('father_of', 'jacob', s), edge('mother_of', m, s));
  }
  edges.push(edge('father_of', 'joseph', 'manasseh'), edge('father_of', 'joseph', 'ephraim'));
  edges.push(edge('father_of', 'judah', 'zerah'), edge('father_of', 'judah', 'pharez'), edge('father_of', 'pharez', 'hezron'), edge('father_of', 'hezron', 'ram'));
  const ids = ['jacob', 'leah', 'rachel', 'bilhah', 'zilpah', ...Object.values(mothers).flat(), 'manasseh', 'ephraim', 'zerah', 'pharez', 'hezron', 'ram'];
  return {
    module: 't', sources: [], lineages: [], edges,
    persons: ids.map(id => ({
      id, name: id[0].toUpperCase() + id.slice(1), kind: 'individual',
      ...(id === 'pharez' ? { tribe: 'judah' } : {}),
    })),
  };
}

describe('layoutTribes', () => {
  const g = GenealogyGraph.from(jacobDataset());
  const node = (l: GraphLayout, id: string) => l.nodes.find(n => n.id === id);
  const headsInOrder = (l: GraphLayout, y: number) => l.nodes.filter(n => n.y === y).sort((a, b) => a.x - b.x).map(n => n.id);

  it('orders the sons per Genesis 49 and colours them by mother', () => {
    const l = layoutTribes(g);
    expectSane(l);
    const jacob = node(l, 'jacob')!;
    const reuben = node(l, 'reuben')!;
    expect(jacob.y).toBeLessThan(node(l, 'leah')!.y);
    expect(node(l, 'leah')!.y).toBeLessThan(reuben.y);
    expect(headsInOrder(l, reuben.y)).toEqual(['reuben', 'simeon', 'levi', 'judah', 'zebulun', 'issachar', 'dan', 'gad', 'asher', 'naphtali', 'joseph', 'benjamin']);
    expect(reuben.colorKey).toBe('leah');
    expect(node(l, 'dan')!.colorKey).toBe('bilhah');
    expect(node(l, 'gad')!.colorKey).toBe('zilpah');
    expect(node(l, 'joseph')!.colorKey).toBe('rachel');
    expect(new Set(l.nodes.filter(n => n.y === reuben.y).map(n => n.colorKey))).toEqual(new Set(['leah', 'bilhah', 'zilpah', 'rachel']));
    // Descendants inherit the colour, prefer the tribe's own, and stop at the depth.
    const kids = headsInOrder(l, reuben.y + (node(l, 'pharez')!.y - reuben.y));
    expect(kids.indexOf('pharez')).toBeLessThan(kids.indexOf('zerah'));
    expect(node(l, 'pharez')!.colorKey).toBe('leah');
    expect(node(l, 'hezron')).toBeDefined();
    expect(node(l, 'ram')).toBeUndefined();
    expect(node(l, 'hezron')!.flags.collapsed).toBe(1);
    expect(reuben.importance).toBe(0);
    expect(l.edges.some(e => e.kind === 'spouse' && e.from === 'jacob' && e.to === 'bilhah')).toBe(true);
    expect(l.edges.some(e => e.from === 'bilhah' && e.to === 'dan' && e.kind === 'parent')).toBe(true);
    expect(l.edges.some(e => e.from === 'jacob' && e.to === 'dan')).toBe(false);
  });

  it('Numbers 26: Manasseh and Ephraim under Joseph, Levi apart', () => {
    const l = layoutTribes(g, { list: 'num_26', depth: 0 });
    expectSane(l);
    const m = node(l, 'manasseh')!;
    const order = headsInOrder(l, m.y);
    expect(order).toEqual(['reuben', 'simeon', 'gad', 'judah', 'issachar', 'zebulun', 'manasseh', 'ephraim', 'benjamin', 'dan', 'asher', 'naphtali', 'levi']);
    const joseph = node(l, 'joseph')!;
    expect(joseph.y).toBeLessThan(m.y);
    expect(m.colorKey).toBe('rachel');
    expect(l.edges.some(e => e.from === 'joseph' && e.to === 'manasseh' && e.kind === 'parent')).toBe(true);
    expect(node(l, 'judah')!.flags.collapsed).toBe(4);
  });

  it('Revelation 7 order, collapse, and determinism', () => {
    const l = layoutTribes(g, { list: 'rev_7', collapsed: ['judah'] });
    expectSane(l);
    const y = node(l, 'judah')!.y;
    expect(headsInOrder(l, y)).toEqual(['judah', 'reuben', 'gad', 'asher', 'naphtali', 'manasseh', 'simeon', 'levi', 'issachar', 'zebulun', 'joseph', 'benjamin']);
    expect(node(l, 'pharez')).toBeUndefined();
    expect(l).toEqual(layoutTribes(GenealogyGraph.from(jacobDataset()), { list: 'rev_7', collapsed: ['judah'] }));
    const empty = layoutTribes(GenealogyGraph.from({ ...jacobDataset(), persons: [], edges: [] }));
    expect(empty.nodes).toEqual([]);
  });
});
