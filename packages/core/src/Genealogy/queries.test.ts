import { describe, expect, it } from 'vitest';
import { GenealogyGraph } from './GenealogyGraph';
import { ancestors, descendants, kinshipLabel, lineToChrist, pathBetween } from './queries';
import type { GenealogyDatasetDto, GenealogyEdgeDto, GenealogyPersonDto, LineageDto } from './types';

const P = (id: string, sex?: 'male' | 'female'): GenealogyPersonDto => ({ id, name: id, sex, kind: 'individual' });
let n = 0;
const father = (from: string, to: string, extra: Partial<GenealogyEdgeDto> = {}): GenealogyEdgeDto =>
  ({ id: `e${n++}`, from, to, type: 'father_of', verses: [], ...extra });
const mother = (from: string, to: string): GenealogyEdgeDto => ({ id: `e${n++}`, from, to, type: 'mother_of', verses: [] });
const wife = (from: string, to: string): GenealogyEdgeDto => ({ id: `e${n++}`, from, to, type: 'wife_of', verses: [] });

const range = { start: 0, end: 0 };
const matthew: LineageDto = {
  id: 'matthew_1', name: 'Matthew', kind: 'genealogy', direction: 'descending', range,
  steps: ['abraham', 'isaac', 'jacob', 'david', 'solomon', 'jacob2', 'joseph', 'jesus'].map(p => ({ personId: p, verseId: 1 })),
};
const luke: LineageDto = {
  id: 'luke_3', name: 'Luke', kind: 'genealogy', direction: 'ascending', range,
  steps: ['jesus', 'heli', 'nathan', 'david', 'jacob', 'isaac', 'abraham', 'noah', 'seth', 'adam'].map(p => ({ personId: p, verseId: 1 })),
};

function dataset(extraEdges: GenealogyEdgeDto[] = [], lineages: LineageDto[] = [matthew, luke]): GenealogyDatasetDto {
  const ids = ['adam', 'seth', 'noah', 'abraham', 'isaac', 'jacob', 'david', 'solomon', 'nathan', 'jacob2', 'joseph', 'heli', 'jesus',
    'esau', 'reuben', 'levi', 'mary', 'bathsheba', 'daughterA', 'kidA', 'kidB', 'stranger'];
  const females = new Set(['mary', 'bathsheba', 'daughterA']);
  const chain: [string, string][] = [['adam', 'seth'], ['seth', 'noah'], ['noah', 'abraham'], ['abraham', 'isaac'], ['isaac', 'jacob'],
    ['isaac', 'esau'], ['jacob', 'reuben'], ['jacob', 'levi'], ['jacob', 'david'], ['david', 'solomon'], ['david', 'nathan'],
    ['solomon', 'jacob2'], ['jacob2', 'joseph'], ['nathan', 'heli'], ['reuben', 'kidA'], ['esau', 'kidB'], ['esau', 'daughterA']];
  return {
    module: 't',
    persons: ids.map(i => P(i, females.has(i) ? 'female' : 'male')),
    edges: [
      ...chain.map(([a, b]) => father(a, b)),
      // Heli reading group: Joseph's father is Jacob2 (default) or Heli.
      father('jacob2', 'joseph', { readingGroup: 'joseph', reading: 'default' }),
      father('heli', 'joseph', { readingGroup: 'joseph', reading: 'heli' }),
      mother('mary', 'jesus'), father('joseph', 'jesus'), wife('mary', 'joseph'), wife('bathsheba', 'david'),
      ...extraEdges,
    ].filter(e => !(e.from === 'jacob2' && e.to === 'joseph' && !e.readingGroup)),
    lineages,
    sources: [],
  };
}

const g = GenealogyGraph.from(dataset());

describe('ancestors / descendants', () => {
  it('lists nearest first with depth limit', () => {
    expect(ancestors(g, 'noah')).toEqual(['seth', 'adam']);
    expect(ancestors(g, 'noah', 1)).toEqual(['seth']);
    expect(descendants(g, 'isaac', 1)).toEqual(['jacob', 'esau']);
    expect(ancestors(g, 'nobody')).toEqual([]);
  });
  it('has no duplicates on diamonds and handles cycles', () => {
    const cyc = GenealogyGraph.from(dataset([father('jesus', 'adam'), father('adam', 'adam')]));
    const a = ancestors(cyc, 'jesus');
    expect(new Set(a).size).toBe(a.length);
    expect(a).not.toContain('jesus');
    const d = descendants(cyc, 'adam');
    expect(new Set(d).size).toBe(d.length);
    expect(pathBetween(cyc, 'kidA', 'kidB')).not.toBeNull();
    expect(kinshipLabel(cyc, 'kidA', 'kidB')).toBeTypeOf('string');
  });
  it('are inverse of each other', () => {
    for (const p of g.allPersons()) {
      for (const a of ancestors(g, p.id)) expect(descendants(g, a)).toContain(p.id);
      for (const d of descendants(g, p.id)) expect(ancestors(g, d)).toContain(p.id);
    }
  });
});

describe('pathBetween', () => {
  it('finds shortest paths in either direction', () => {
    expect(pathBetween(g, 'adam', 'noah')).toEqual(['adam', 'seth', 'noah']);
    expect(pathBetween(g, 'kidA', 'kidB')).toEqual(['kidA', 'reuben', 'jacob', 'isaac', 'esau', 'kidB']);
    expect(pathBetween(g, 'noah', 'noah')).toEqual(['noah']);
    expect(pathBetween(g, 'noah', 'stranger')).toBeNull();
    expect(pathBetween(g, 'noah', 'zzz')).toBeNull();
  });
  it('is symmetric in length', () => {
    const ids = g.allPersons().map(p => p.id);
    for (const a of ids) for (const b of ids) {
      expect(pathBetween(g, a, b)?.length).toBe(pathBetween(g, b, a)?.length);
    }
  });
});

describe('lineToChrist', () => {
  it('returns Matthew and Luke lines from Adam to Jesus', () => {
    const r = lineToChrist(g);
    expect(r.map(x => x.lineageId)).toEqual(['matthew_1', 'luke_3']);
    expect(r[0].path).toEqual(['adam', 'seth', 'noah', 'abraham', 'isaac', 'jacob', 'david', 'solomon', 'jacob2', 'joseph', 'jesus']);
    expect(r[1].path).toEqual(['adam', 'seth', 'noah', 'abraham', 'isaac', 'jacob', 'david', 'nathan', 'heli', 'jesus']);
  });
  it('falls back to the father chain', () => {
    const g2 = GenealogyGraph.from(dataset([], []));
    const r = lineToChrist(g2);
    expect(r).toHaveLength(1);
    expect(r[0].lineageId).toBe('parents');
    expect(r[0].path[0]).toBe('adam');
    expect(r[0].path.at?.(-1) ?? r[0].path[r[0].path.length - 1]).toBe('jesus');
  });
  it('follows the chosen Heli reading in the fallback', () => {
    const g2 = GenealogyGraph.from(dataset([], []), { readings: { joseph: 'heli' } });
    expect(lineToChrist(g2)[0].path).toContain('heli');
    expect(lineToChrist(g2)[0].path).not.toContain('jacob2');
  });
  it('returns [] for unknown ids and terminates on cycles', () => {
    expect(lineToChrist(g, 'zzz')).toEqual([]);
    const cyc = GenealogyGraph.from(dataset([father('jesus', 'adam')], []));
    expect(lineToChrist(cyc)[0].path.length).toBeGreaterThan(0);
  });
});

describe('kinshipLabel', () => {
  const k = (a: string, b: string) => kinshipLabel(g, a, b);
  it('direct relatives', () => {
    expect(k('jesus', 'mary')).toBe('mother');
    expect(k('jesus', 'joseph')).toBe('father');
    expect(k('isaac', 'jacob')).toBe('son');
    expect(k('mary', 'jesus')).toBe('son');
    expect(k('joseph', 'mary')).toBe('wife');
    expect(k('david', 'bathsheba')).toBe('wife');
    expect(k('bathsheba', 'david')).toBe('husband');
    expect(k('jacob', 'jacob')).toBe('self');
    expect(k('jesus', 'stranger')).toBe('unrelated');
  });
  it('grandparents and great generations', () => {
    expect(k('noah', 'adam')).toBe('grandfather');
    expect(k('abraham', 'adam')).toBe('great-grandfather');
    expect(k('adam', 'abraham')).toBe('great-grandson');
    expect(k('adam', 'noah')).toBe('grandson');
    expect(k('jesus', 'adam')).toBe('ancestor');
    expect(k('adam', 'jesus')).toBe('descendant');
  });
  it('siblings, uncles, nephews, cousins', () => {
    expect(k('reuben', 'levi')).toBe('brother');
    expect(k('jacob', 'esau')).toBe('brother');
    expect(k('kidA', 'kidB')).toBe('first cousin once removed');
    expect(k('kidA', 'daughterA')).toBe('first cousin once removed');
    expect(k('reuben', 'kidB')).toBe('first cousin');
    expect(k('kidB', 'reuben')).toBe('first cousin');
    expect(k('reuben', 'esau')).toBe('uncle');
    expect(k('esau', 'reuben')).toBe('nephew');
    expect(k('kidB', 'levi')).toBe('first cousin');
    expect(k('kidA', 'isaac')).toBe('great-grandfather');
  });
  it('great-uncles and second cousins', () => {
    const ds = dataset([father('kidB', 'x2'), father('kidA', 'x1')]);
    ds.persons.push(P('x1', 'male'), P('x2', 'male'));
    const g3 = GenealogyGraph.from(ds);
    expect(kinshipLabel(g3, 'kidA', 'x2')).toBe('second cousin');
    expect(kinshipLabel(g3, 'kidA', 'esau')).toBe('great-uncle');
    expect(kinshipLabel(g3, 'esau', 'kidA')).toBe('great-nephew');
    expect(kinshipLabel(g3, 'x1', 'x2')).toBe('second cousin once removed');
  });
  it('neutral wording when sex unknown; relative when only linked by marriage', () => {
    const ds = dataset();
    ds.persons.push({ id: 'kid', name: 'kid', kind: 'individual' });
    ds.edges.push(father('jacob', 'kid'));
    expect(kinshipLabel(GenealogyGraph.from(ds), 'jacob', 'kid')).toBe('child');
    expect(kinshipLabel(GenealogyGraph.from(ds), 'kid', 'jacob')).toBe('father');
    expect(kinshipLabel(GenealogyGraph.from(ds), 'reuben', 'kid')).toBe('sibling');
  });
});
