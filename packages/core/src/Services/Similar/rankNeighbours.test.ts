import { describe, it, expect } from 'vitest';
import { rankNeighbours, resolveSimilarOptions } from './rankNeighbours';
import type { NeighbourHit, PassageRange, SimilarOptions } from './SimilarTypes';

const v = (book: number, ch: number, vs: number) => book * 1_000_000 + ch * 1000 + vs;
const hit = (s: number, e: number, score: number, level: NeighbourHit['level'] = 'verse'): NeighbourHit => ({
  startVerseId: s, endVerseId: e, level, score,
});
const one = (id: number, score: number) => hit(id, id, score);
const GEN = 1, PS = 19, ISA = 23, MATT = 40, JOHN = 43, ROM = 45;

function run(
  source: PassageRange,
  cands: NeighbourHit[],
  opts: SimilarOptions = {},
  ctx: Partial<{ crossRefs: PassageRange[]; floor: number }> = {},
) {
  return rankNeighbours(source, cands, resolveSimilarOptions({ minSimilarity: 0, ...opts }), {
    crossRefs: [], floor: 0, via: 'table', ...ctx,
  });
}
const ids = (r: ReturnType<typeof run>) => r.map((p) => p.startVerseId);
const src = (id: number): PassageRange => ({ startVerseId: id, endVerseId: id });

describe('resolveSimilarOptions', () => {
  it('fills defaults and ignores undefined', () => {
    const o = resolveSimilarOptions({ maxResults: 5, perBookCap: undefined });
    expect(o.maxResults).toBe(5);
    expect(o.perBookCap).toBe(3);
    expect(o.minSimilarity).toBeNull();
    expect(o.levels).toEqual(['verse', 'paragraph']);
  });
});

describe('rankNeighbours adjacency', () => {
  const s = src(v(PS, 10, 10));
  it.each([
    ['self', v(PS, 10, 10), false],
    ['-5 same chapter', v(PS, 10, 5), false],
    ['+5 same chapter', v(PS, 10, 15), false],
    ['-6 same chapter', v(PS, 10, 4), true],
    ['+6 same chapter', v(PS, 10, 16), true],
    ['same verse number, other chapter', v(PS, 11, 10), true],
  ])('%s -> kept=%s', (_n, id, kept) => {
    expect(ids(run(s, [one(id, 0.9)]))).toEqual(kept ? [id] : []);
  });

  it('window at chapter start does not reach into the previous chapter', () => {
    expect(ids(run(src(v(PS, 10, 1)), [one(v(PS, 9, 20), 0.9), one(v(PS, 10, 6), 0.8), one(v(PS, 10, 7), 0.7)])))
      .toEqual([v(PS, 9, 20), v(PS, 10, 7)]);
  });

  it('window at chapter end does not reach into the next chapter', () => {
    expect(ids(run(src(v(GEN, 1, 31)), [one(v(GEN, 2, 1), 0.9), one(v(GEN, 1, 26), 0.8), one(v(GEN, 1, 25), 0.7)])))
      .toEqual([v(GEN, 2, 1), v(GEN, 1, 25)]);
  });

  it('measures the window from the nearest end of a range source', () => {
    const range = { startVerseId: v(PS, 10, 10), endVerseId: v(PS, 10, 14) };
    const out = run(range, [one(v(PS, 10, 19), 0.9), one(v(PS, 10, 20), 0.8), one(v(PS, 10, 5), 0.7), one(v(PS, 10, 4), 0.6)]);
    expect(ids(out)).toEqual([v(PS, 10, 20), v(PS, 10, 4)]);
  });

  it('drops anything overlapping the source, and the source paragraph', () => {
    const range = { startVerseId: v(PS, 10, 10), endVerseId: v(PS, 10, 12) };
    const out = run(range, [
      hit(v(PS, 10, 8), v(PS, 10, 14), 0.99, 'paragraph'),
      hit(v(PS, 10, 11), v(PS, 10, 11), 0.98),
      hit(v(PS, 10, 12), v(PS, 10, 30), 0.97, 'paragraph'),
      one(v(ISA, 1, 1), 0.5),
    ]);
    expect(ids(out)).toEqual([v(ISA, 1, 1)]);
  });

  it('a candidate spanning a chapter boundary compares both ends', () => {
    // candidate Gen 1:30 - 2:2 shares the chapter of source Gen 1:27 and lies within 5 verses
    const out = run(src(v(GEN, 1, 27)), [hit(v(GEN, 1, 30), v(GEN, 2, 2), 0.9, 'paragraph')]);
    expect(out).toEqual([]);
    // but beyond the window it is kept
    expect(run(src(v(GEN, 1, 20)), [hit(v(GEN, 1, 30), v(GEN, 2, 2), 0.9, 'paragraph')])).toHaveLength(1);
  });

  it('excludeNearby 0 keeps neighbours', () => {
    expect(ids(run(s, [one(v(PS, 10, 11), 0.9)], { excludeNearby: 0 }))).toEqual([v(PS, 10, 11)]);
  });

  it('excludeSameChapter / excludeSameBook', () => {
    const cands = [one(v(PS, 10, 30), 0.9), one(v(PS, 11, 1), 0.8), one(v(ISA, 1, 1), 0.7)];
    expect(ids(run(s, cands, { excludeSameChapter: true }))).toEqual([v(PS, 11, 1), v(ISA, 1, 1)]);
    expect(ids(run(s, cands, { excludeSameBook: true }))).toEqual([v(ISA, 1, 1)]);
  });
});

describe('rankNeighbours testament and sections', () => {
  const cands = [one(v(ISA, 1, 1), 0.9), one(v(MATT, 1, 1), 0.85), one(v(ROM, 5, 8), 0.8)];
  it.each([
    ['any', src(v(JOHN, 3, 16)), [v(ISA, 1, 1), v(MATT, 1, 1), v(ROM, 5, 8)]],
    ['ot', src(v(JOHN, 3, 16)), [v(ISA, 1, 1)]],
    ['nt', src(v(JOHN, 3, 16)), [v(MATT, 1, 1), v(ROM, 5, 8)]],
    ['other', src(v(JOHN, 3, 16)), [v(ISA, 1, 1)]],
    ['other', src(v(PS, 23, 1)), [v(MATT, 1, 1), v(ROM, 5, 8)]],
  ] as const)('testament %s from %j', (testament, source, expected) => {
    expect(ids(run(source, cands, { testament }))).toEqual(expected);
  });

  it('crossesTestament is always computed', () => {
    const out = run(src(v(JOHN, 3, 16)), cands);
    expect(out.map((p) => p.crossesTestament)).toEqual([true, false, false]);
  });

  it('sections filter', () => {
    const out = run(src(v(JOHN, 3, 16)), cands, { sections: ['gospels'] as never });
    expect(ids(out)).toEqual([v(MATT, 1, 1)]);
  });
});

describe('rankNeighbours cross-references', () => {
  const s = src(v(JOHN, 3, 16));
  const cands = [one(v(ROM, 5, 8), 0.9), one(v(ISA, 53, 5), 0.8)];
  const crossRefs = [{ startVerseId: v(ROM, 5, 7), endVerseId: v(ROM, 5, 9) }];
  it('flag', () => {
    expect(run(s, cands, { crossRefs: 'flag' }, { crossRefs }).map((p) => p.isCrossReference)).toEqual([true, false]);
  });
  it('hide', () => {
    expect(ids(run(s, cands, { crossRefs: 'hide' }, { crossRefs }))).toEqual([v(ISA, 53, 5)]);
  });
  it('ignore', () => {
    expect(run(s, cands, { crossRefs: 'ignore' }, { crossRefs }).map((p) => p.isCrossReference)).toEqual([false, false]);
  });
});

describe('rankNeighbours cap, floor, consolidation', () => {
  const s = src(v(JOHN, 3, 16));

  it('per-book cap keeps score order, 0 = off', () => {
    const cands = [1, 2, 3, 4, 5].map((i) => one(v(PS, i, 1), 1 - i * 0.01)).concat(one(v(ISA, 1, 1), 0.93));
    expect(ids(run(s, cands, { perBookCap: 3 }))).toEqual([v(PS, 1, 1), v(PS, 2, 1), v(PS, 3, 1), v(ISA, 1, 1)]);
    expect(run(s, cands, { perBookCap: 0 })).toHaveLength(6);
  });

  it('maxResults slices', () => {
    const cands = [1, 2, 3].map((i) => one(v(PS, i, 1), 1 - i * 0.01));
    expect(run(s, cands, { maxResults: 2, perBookCap: 0 })).toHaveLength(2);
  });

  it('floor = max(ctx.floor, 0.8 * top1)', () => {
    const cands = [one(v(PS, 1, 1), 1), one(v(PS, 2, 1), 0.81), one(v(PS, 3, 1), 0.79)];
    const o = resolveSimilarOptions({ perBookCap: 0 });
    const r = rankNeighbours(s, cands, o, { crossRefs: [], floor: 0.1, via: 'live' });
    expect(ids(r)).toEqual([v(PS, 1, 1), v(PS, 2, 1)]);
    expect(r[0].via).toBe('live');
    const hi = rankNeighbours(s, cands, o, { crossRefs: [], floor: 0.9, via: 'live' });
    expect(ids(hi)).toEqual([v(PS, 1, 1)]);
  });

  it('top1 is taken after self and near removal', () => {
    const cands = [one(v(JOHN, 3, 17), 1), one(v(PS, 2, 1), 0.5), one(v(PS, 3, 1), 0.45)];
    const o = resolveSimilarOptions({ perBookCap: 0 });
    const r = rankNeighbours(s, cands, o, { crossRefs: [], floor: 0, via: 'table' });
    expect(ids(r)).toEqual([v(PS, 2, 1), v(PS, 3, 1)]);
  });

  it('explicit minSimilarity overrides the floor rule', () => {
    const cands = [one(v(PS, 1, 1), 1), one(v(PS, 2, 1), 0.3)];
    const r = rankNeighbours(s, cands, resolveSimilarOptions({ minSimilarity: 0.2, perBookCap: 0 }), {
      crossRefs: [], floor: 0.9, via: 'table',
    });
    expect(r).toHaveLength(2);
  });

  it('a verse and its paragraph take one slot; similarity is the hit score', () => {
    const cands = [
      hit(v(PS, 5, 3), v(PS, 5, 3), 0.9),
      hit(v(PS, 5, 1), v(PS, 5, 6), 0.88, 'paragraph'),
      one(v(ISA, 1, 1), 0.85),
    ];
    const r = run(s, cands, { perBookCap: 0 });
    expect(r).toHaveLength(2);
    expect(r.map((p) => p.similarity).sort()).toContain(0.85);
    expect(r.filter((p) => p.startVerseId >= v(PS, 5, 1) && p.startVerseId <= v(PS, 5, 6))).toHaveLength(1);
  });

  it('empty input and all filtered give []', () => {
    expect(run(s, [])).toEqual([]);
    expect(run(s, [one(v(JOHN, 3, 16), 1), one(v(JOHN, 3, 18), 0.9)])).toEqual([]);
  });
});
