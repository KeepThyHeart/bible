import { describe, expect, it } from 'vitest';
import { GenealogyGraph } from './GenealogyGraph';
import { layoutFamily } from './layoutFamily';
import type { GenealogyDatasetDto, GenealogyEdgeDto, GraphLayout, Sex } from './types';

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
const edge = (type: string, from: string, to: string, sortOrder?: number): GenealogyEdgeDto =>
  ({ id: `e${++eid}`, from, to, type, verses: [{ start: 1001001, end: 1001001 }], ...(sortOrder ? { sortOrder } : {}) });

function abrahamDataset(): GenealogyDatasetDto {
  const people: [string, Sex][] = [
    ['nahor', 'male'], ['terah', 'male'], ['amathlai', 'female'], ['abraham', 'male'], ['sarah', 'female'],
    ['hagar', 'female'], ['keturah', 'female'], ['isaac', 'male'], ['ishmael', 'male'], ['zimran', 'male'],
    ['jokshan', 'male'], ['rebekah', 'female'], ['esau', 'male'], ['jacob', 'male'], ['reuben', 'male'],
  ];
  return {
    module: 't', sources: [], lineages: [],
    persons: people.map(([id, sex]) => ({ id, name: id[0].toUpperCase() + id.slice(1), sex, kind: 'individual' })),
    edges: [
      edge('father_of', 'nahor', 'terah'),
      edge('father_of', 'terah', 'abraham'), edge('mother_of', 'amathlai', 'abraham'),
      edge('father_of', 'terah', 'sarah'),
      edge('husband_of', 'abraham', 'sarah'), edge('husband_of', 'abraham', 'hagar'), edge('husband_of', 'abraham', 'keturah'),
      // Keturah's children listed first in the data; grouping must follow the spouse order.
      edge('father_of', 'abraham', 'jokshan', 2), edge('mother_of', 'keturah', 'jokshan'),
      edge('father_of', 'abraham', 'zimran', 1), edge('mother_of', 'keturah', 'zimran'),
      edge('father_of', 'abraham', 'ishmael', 1), edge('mother_of', 'hagar', 'ishmael'),
      edge('father_of', 'abraham', 'isaac', 2), edge('mother_of', 'sarah', 'isaac'),
      edge('husband_of', 'isaac', 'rebekah'),
      edge('father_of', 'isaac', 'esau', 1), edge('father_of', 'isaac', 'jacob', 2),
      edge('mother_of', 'rebekah', 'esau'), edge('mother_of', 'rebekah', 'jacob'),
      edge('father_of', 'jacob', 'reuben'),
    ],
  };
}

describe('layoutFamily', () => {
  const g = GenealogyGraph.from(abrahamDataset());
  const node = (l: GraphLayout, id: string) => l.nodes.find(n => n.id === id);

  it('lays out an hourglass with spouses and children grouped by mother', () => {
    const l = layoutFamily(g, 'abraham');
    expectSane(l);
    const f = node(l, 'abraham')!;
    expect(f.flags.focus).toBe(true);
    expect(f.importance).toBe(0);
    expect(f.x).toBe(0);
    expect(node(l, 'terah')!.y).toBeLessThan(0);
    expect(node(l, 'amathlai')!.y).toBe(node(l, 'terah')!.y);
    expect(node(l, 'nahor')!.y).toBeLessThan(node(l, 'terah')!.y);
    for (const s of ['sarah', 'hagar', 'keturah']) {
      expect(node(l, s)!.y).toBe(0);
      expect(l.edges.some(e => e.kind === 'spouse' && e.from === 'abraham' && e.to === s)).toBe(true);
    }
    const kids = l.nodes.filter(n => n.y > 0 && n.y === node(l, 'isaac')!.y).sort((a, b) => a.x - b.x).map(n => n.id);
    expect(kids).toEqual(['isaac', 'ishmael', 'zimran', 'jokshan']);
    expect(node(l, 'jacob')!.y).toBeGreaterThan(node(l, 'isaac')!.y);
    // Depth limit: Jacob's son is hidden behind a badge.
    expect(node(l, 'reuben')).toBeUndefined();
    expect(node(l, 'jacob')!.flags.collapsed).toBe(1);
    // Sarah is also Terah's daughter: a non-tree link.
    const cross = l.edges.find(e => e.from === 'terah' && e.to === 'sarah')!;
    expect(cross.kind).toBe('cross');
    expect(cross.style).toBe('dashed');
    // Mothers are linked to their children too.
    expect(l.edges.some(e => e.from === 'hagar' && e.to === 'ishmael' && e.kind === 'parent')).toBe(true);
    // Rebekah is not a spouse of the focus and not placed.
    expect(node(l, 'rebekah')).toBeUndefined();
  });

  it('honours collapsed ids, fathers-only and depth options', () => {
    const l = layoutFamily(g, 'abraham', { collapsed: ['isaac'], showMothers: false, up: 1, down: 3 });
    expectSane(l);
    expect(node(l, 'amathlai')).toBeUndefined();
    expect(node(l, 'nahor')).toBeUndefined();
    expect(node(l, 'terah')!.flags.collapsed).toBe(1);
    expect(node(l, 'esau')).toBeUndefined();
    expect(node(l, 'isaac')!.flags.collapsed).toBe(3);
    const deep = layoutFamily(g, 'abraham', { down: 3 });
    expect(node(deep, 'reuben')).toBeDefined();
    expectSane(deep);
  });

  it('is deterministic and handles unknown ids', () => {
    expect(layoutFamily(g, 'isaac')).toEqual(layoutFamily(GenealogyGraph.from(abrahamDataset()), 'isaac'));
    expectSane(layoutFamily(g, 'isaac'));
    expect(layoutFamily(g, 'nobody').nodes).toEqual([]);
  });
});
