import { describe, it, expect } from 'vitest';
import sample from './fixtures/sampleDataset.json';
import { GenealogyGraph } from './GenealogyGraph';
import { lineToChrist, ancestors, kinshipLabel } from './queries';
import { layoutLineage } from './layoutLineage';
import { layoutFamily } from './layoutFamily';
import { layoutTribes } from './layoutTribes';
import { computeGenealogyLayout } from './computeLayout';
import { DEFAULT_GENEALOGY_STATE } from './store';
import type { GenealogyDatasetDto, GraphLayout } from './types';

const ds = sample as unknown as GenealogyDatasetDto;

function noOverlap(l: GraphLayout): void {
  const ns = l.nodes;
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i], b = ns[j];
      const ox = Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.5;
      const oy = Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 0.5;
      expect(ox && oy, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}

describe('sample dataset (KJV-based fixture)', () => {
  const g = GenealogyGraph.from(ds);

  it('is internally consistent', () => {
    const ids = new Set(ds.persons.map(p => p.id));
    for (const e of ds.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); expect(e.verses.length).toBeGreaterThan(0); }
    for (const l of ds.lineages) for (const s of l.steps) expect(ids.has(s.personId)).toBe(true);
  });

  it('gives a line from Adam to Jesus in both Matthew and Luke', () => {
    const lines = lineToChrist(g);
    expect(lines.map(l => l.lineageId).sort()).toEqual(['luke_3', 'matthew_1']);
    for (const l of lines) {
      expect(l.path[0]).toBe('adam');
      expect(l.path[l.path.length - 1]).toBe('jesus');
    }
    expect(ancestors(g, 'jesus')).toContain('adam');
    expect(kinshipLabel(g, 'jesus', 'david')).toMatch(/ancestor|grandfather/);
  });

  it('keeps Heli as a disputed reading group with the KJV wording as default', () => {
    const rows = g.readingsOf('lk3_23_heli');
    expect(rows.length).toBe(3);
    expect(rows.find(r => r.reading === 'default')?.from).toBe('heli');
  });

  it('lays out all three views without overlaps', () => {
    const line = layoutLineage(g);
    expect(line.nodes.length).toBeGreaterThan(60);
    noOverlap(line);
    const fam = layoutFamily(g, 'david');
    expect(fam.nodes.length).toBeGreaterThan(5);
    noOverlap(fam);
    const tribes = layoutTribes(g, { list: 'num_26' });
    expect(tribes.nodes.length).toBeGreaterThan(12);
    noOverlap(tribes);
    for (const view of ['line', 'family', 'tribes'] as const) {
      expect(computeGenealogyLayout(g, { ...DEFAULT_GENEALOGY_STATE, view, focusId: 'jesus' }).nodes.length).toBeGreaterThan(0);
    }
  });

  it('flags Cainan (Luke 3:36) as in one text only', () => {
    const line = layoutLineage(g);
    expect(line.nodes.some(n => n.flags.oneTextOnly && /Cainan/.test(n.label))).toBe(true);
  });

  describe('data corrections (KJV text is exact)', () => {
    const alias = (id: string) => g.person(id)?.aliases ?? [];

    it('does not call Judah "David" or Moses "Manasseh"', () => {
      expect(alias('judah')).not.toContain('David');
      expect(alias('judah')).toEqual(expect.arrayContaining(['Juda', 'Judas']));
      expect(alias('moses')).not.toContain('Manasseh');
    });

    it('makes Nahash Abigail\'s father and gives David no named mother (2 Sam 17:25)', () => {
      const nahash = g.person('nahash_2sa_17_25');
      expect(nahash?.sex).toBe('male');
      expect(ds.edges.some(e => e.type === 'father_of' && e.from === 'nahash_2sa_17_25' && e.to === 'abigail_2sa_17_25')).toBe(true);
      expect(ds.edges.some(e => e.type === 'mother_of' && e.from === 'nahash_2sa_17_25')).toBe(false);
      expect(ds.edges.some(e => e.type === 'mother_of' && e.to === 'david')).toBe(false);
    });

    it('has readable notes: no markup, codes, doubled spaces or glued words', () => {
      for (const p of ds.persons) {
        expect(p.notes ?? '', p.id).not.toMatch(/@[A-Za-z0-9]+\.\d|\(\?\)|TIPNR|BibleData|_of_|\s{2}|Monarchyand/);
      }
      expect(g.person('rehoboam')?.notes).toContain('United Monarchy and Divided Monarchy');
    });
  });
});
