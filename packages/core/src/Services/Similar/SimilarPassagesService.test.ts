import { describe, it, expect, vi } from 'vitest';
import { SimilarPassagesService, pickQueryRows } from './SimilarPassagesService';
import { NeighbourTable, encodeNeighbourTable } from './NeighbourTable';
import type {
  INeighbourTable,
  IPassageVectorSource,
  NeighbourHit,
  NeighbourTableMeta,
  PassageRange,
  QueryRow,
  RowHit,
} from './SimilarTypes';

const PS23_1 = 19023001;
const JOHN10_11 = 43010011;
const EZEK34_11 = 26034011;
const ISA40_11 = 23040011;

const meta: NeighbourTableMeta = {
  neighbourFloor: 0.5,
  scoreMin: 0.4,
  scoreMax: 1,
  k: 30,
  levels: ['verse', 'paragraph'],
  excludeWindow: 2,
};
const vh = (id: number, score: number): NeighbourHit => ({ startVerseId: id, endVerseId: id, level: 'verse', score });
const vkey = (id: number) => ({ startVerseId: id, endVerseId: id, level: 'verse' as const });

function makeTable(): NeighbourTable {
  return NeighbourTable.fromBytes(
    encodeNeighbourTable(meta, [
      { key: vkey(PS23_1), neighbours: [vh(JOHN10_11, 0.9), vh(EZEK34_11, 0.8)] },
      { key: vkey(PS23_1 + 1), neighbours: [vh(ISA40_11, 0.95), vh(JOHN10_11, 0.7)] },
    ])
  );
}

function makeLive(overrides: Partial<IPassageVectorSource> = {}): IPassageVectorSource & {
  getPassageRows: ReturnType<typeof vi.fn>;
  searchRows: ReturnType<typeof vi.fn>;
} {
  const rows: QueryRow[] = [
    { id: 'a', kind: 'explanation', level: 'verse', vector: Float32Array.from([1, 0]) },
    { id: 'a_s0', kind: 'facet', level: 'verse', vector: Float32Array.from([0.9, 0.1]) },
  ];
  const hit = (id: number, similarity: number, rowId = 'x'): RowHit => ({
    id: rowId,
    level: 'verse',
    startVerseId: id,
    endVerseId: id,
    similarity,
  });
  return {
    neighbourFloor: () => 0.3,
    getPassageRows: vi.fn(() => rows),
    searchRows: vi.fn((queries: Float32Array[]) =>
      queries.map(() => [hit(JOHN10_11, 0.9), hit(EZEK34_11, 0.85), hit(ISA40_11, 0.1)])
    ),
    ...overrides,
  } as never;
}

const verse = (id: number): PassageRange => ({ startVerseId: id, endVerseId: id });

describe('SimilarPassagesService source selection', () => {
  it('auto answers a single verse from the table', async () => {
    const live = makeLive();
    const svc = new SimilarPassagesService({ table: makeTable as () => INeighbourTable, live: () => live });
    const res = await svc.findSimilar(verse(PS23_1));

    expect(res.via).toBe('table');
    expect(res.approximate).toBe(false);
    expect(res.passages.map(p => p.startVerseId)).toEqual([JOHN10_11, EZEK34_11]);
    expect(res.passages.every(p => p.via === 'table')).toBe(true);
    expect(live.getPassageRows).not.toHaveBeenCalled();
  });

  it('auto uses live for levels the table lacks', async () => {
    const live = makeLive();
    const svc = new SimilarPassagesService({ table: () => makeTable(), live: () => live });
    const res = await svc.findSimilar(verse(PS23_1), { levels: ['verse', 'chapter'] });

    expect(res.via).toBe('live');
    expect(live.searchRows).toHaveBeenCalledTimes(1);
  });

  it('auto uses live for a range without a table key when live exists', async () => {
    const svc = new SimilarPassagesService({ table: () => makeTable(), live: () => makeLive() });
    const res = await svc.findSimilar({ startVerseId: PS23_1, endVerseId: PS23_1 + 1 });
    expect(res.via).toBe('live');
  });

  it('auto unions the verse lists of a range (approximate) when only the table exists', async () => {
    const svc = new SimilarPassagesService({ table: () => makeTable() });
    const res = await svc.findSimilar({ startVerseId: PS23_1, endVerseId: PS23_1 + 1 });

    expect(res.via).toBe('table');
    expect(res.approximate).toBe(true);
    expect(res.passages.map(p => p.startVerseId)).toEqual([ISA40_11, JOHN10_11, EZEK34_11]);
  });

  it('auto gives none with a reason when the table has nothing for the range', async () => {
    const svc = new SimilarPassagesService({ table: () => makeTable() });
    const range = await svc.findSimilar({ startVerseId: 1001001, endVerseId: 1001003 });
    expect(range).toMatchObject({ via: 'none', reason: 'range-needs-live', passages: [] });
    const single = await svc.findSimilar(verse(1001001));
    expect(single).toMatchObject({ via: 'none', reason: 'no-data' });
  });

  it('gives none/no-data with no source at all', async () => {
    const res = await new SimilarPassagesService().findSimilar(verse(PS23_1));
    expect(res).toMatchObject({ via: 'none', reason: 'no-data', passages: [], approximate: false });
  });

  it('forced table with no key gives none/range-needs-live even when live exists', async () => {
    const live = makeLive();
    const svc = new SimilarPassagesService({ table: () => makeTable(), live: () => live });
    const res = await svc.findSimilar({ startVerseId: PS23_1, endVerseId: PS23_1 + 1 }, { source: 'table' });

    expect(res).toMatchObject({ via: 'none', reason: 'range-needs-live' });
    expect(live.searchRows).not.toHaveBeenCalled();
  });

  it('forced live without a live source gives none/no-data', async () => {
    const svc = new SimilarPassagesService({ table: () => makeTable() });
    expect(await svc.findSimilar(verse(PS23_1), { source: 'live' })).toMatchObject({ via: 'none', reason: 'no-data' });
  });
});

describe('SimilarPassagesService live path', () => {
  it('queries with the stored rows and applies the floor and ranking', async () => {
    const live = makeLive();
    const svc = new SimilarPassagesService({ live: () => live });
    const res = await svc.findSimilar(verse(PS23_1));

    expect(res.via).toBe('live');
    expect(live.getPassageRows).toHaveBeenCalledWith(verse(PS23_1), ['verse', 'paragraph']);
    const [vectors, opts] = live.searchRows.mock.calls[0];
    expect(vectors).toHaveLength(2);
    expect(opts.topK).toBe(200);
    // 0.1 is under max(0.3, 0.9 * 0.8).
    expect(res.passages.map(p => p.startVerseId)).toEqual([JOHN10_11, EZEK34_11]);
    expect(res.passages[0].via).toBe('live');
  });

  it('reports no-data when the verse has no index rows', async () => {
    const live = makeLive({ getPassageRows: () => [] });
    const res = await new SimilarPassagesService({ live: () => live }).findSimilar(verse(PS23_1));
    expect(res).toMatchObject({ via: 'none', reason: 'no-data' });
  });

  it('flags cross-references from an async provider and survives a failing one', async () => {
    const flagged = new SimilarPassagesService({
      live: () => makeLive(),
      crossRefsFor: async () => [verse(JOHN10_11)],
    });
    const res = await flagged.findSimilar(verse(PS23_1));
    expect(res.passages.map(p => p.isCrossReference)).toEqual([true, false]);

    const failing = new SimilarPassagesService({
      live: () => makeLive(),
      crossRefsFor: () => {
        throw new Error('boom');
      },
    });
    expect((await failing.findSimilar(verse(PS23_1))).passages).toHaveLength(2);
  });
});

describe('pickQueryRows', () => {
  const row = (id: string, kind: QueryRow['kind'], v: number[]): QueryRow => ({
    id,
    kind,
    level: 'verse',
    vector: Float32Array.from(v),
  });

  it('keeps all rows under the cap', () => {
    const rows = [row('a', 'explanation', [1, 0]), row('b', 'explanation', [0, 1])];
    expect(pickQueryRows(rows, 8)).toBe(rows);
  });

  it('keeps the most central rows but at least one per kind', () => {
    const rows = [
      row('e1', 'explanation', [1, 0]),
      row('e2', 'explanation', [0.99, 0.1]),
      row('e3', 'explanation', [0.98, 0.15]),
      row('t1', 'text', [0, 1]), // far from the centroid
    ];
    const ids = pickQueryRows(rows, 2).map(r => r.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('t1');
    expect(ids.filter(id => id.startsWith('e'))).toHaveLength(1);
  });
});

describe('SimilarPassagesService cache', () => {
  it('serves a repeat from the LRU until reset()', async () => {
    const live = makeLive();
    const svc = new SimilarPassagesService({ live: () => live });

    const first = await svc.findSimilar(verse(PS23_1));
    const second = await svc.findSimilar(verse(PS23_1));
    expect(second).toBe(first);
    expect(live.searchRows).toHaveBeenCalledTimes(1);

    await svc.findSimilar(verse(PS23_1), { maxResults: 5 });
    expect(live.searchRows).toHaveBeenCalledTimes(2);

    svc.reset();
    await svc.findSimilar(verse(PS23_1));
    expect(live.searchRows).toHaveBeenCalledTimes(3);
  });

  it('evicts the least recently used entry', async () => {
    const live = makeLive();
    const svc = new SimilarPassagesService({ live: () => live, cacheSize: 2 });
    await svc.findSimilar(verse(1));
    await svc.findSimilar(verse(2));
    await svc.findSimilar(verse(1)); // refresh 1; 2 is now oldest
    await svc.findSimilar(verse(3)); // evicts 2
    expect(live.searchRows).toHaveBeenCalledTimes(3);
    await svc.findSimilar(verse(1)); // still cached
    expect(live.searchRows).toHaveBeenCalledTimes(3);
    await svc.findSimilar(verse(2)); // recomputed
    expect(live.searchRows).toHaveBeenCalledTimes(4);
  });

  it('re-reads the getters on every call', async () => {
    let table: INeighbourTable | null = null;
    let live: IPassageVectorSource | null = null;
    const svc = new SimilarPassagesService({ table: () => table, live: () => live });

    expect((await svc.findSimilar(verse(PS23_1))).via).toBe('none');
    table = makeTable();
    expect((await svc.findSimilar(verse(PS23_1))).via).toBe('table');
    live = makeLive();
    expect((await svc.findSimilar(verse(PS23_1), { source: 'live' })).via).toBe('live');
    table = null;
    expect((await svc.findSimilar(verse(PS23_1))).via).toBe('live');
  });

  it('does not cache a none result', async () => {
    let table: INeighbourTable | null = null;
    const svc = new SimilarPassagesService({ table: () => table });
    await svc.findSimilar(verse(PS23_1));
    table = makeTable();
    expect((await svc.findSimilar(verse(PS23_1))).passages.length).toBeGreaterThan(0);
  });
});
