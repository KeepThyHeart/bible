import { describe, it, expect } from 'vitest';
import { aggregateHits } from './aggregateHits';
import { DEFAULT_SIMILAR_WEIGHTS, compileKindClassifier, resolveSimilarWeights } from './SimilarWeights';
import type { SimilarRowKind } from './SimilarWeights';
import type { QueryRow, RowHit } from './SimilarTypes';

const classify = compileKindClassifier(
  resolveSimilarWeights({
    kindRules: [
      { kind: 'text', idPattern: '^t_' },
      { kind: 'facet', idPattern: '_s\\d+$' },
    ],
  }),
);
const q = (id: string, kind: SimilarRowKind): QueryRow => ({ id, kind, level: 'verse', vector: new Float32Array(1) });
const hit = (id: string, v: number, similarity: number, level: RowHit['level'] = 'verse'): RowHit => ({
  id, level, startVerseId: v, endVerseId: v, similarity,
});
const W = DEFAULT_SIMILAR_WEIGHTS;
const score = (r: ReturnType<typeof aggregateHits>, v: number) => r.find((h) => h.startVerseId === v)?.score;

describe('aggregateHits', () => {
  it('takes the max over pairs and sorts desc', () => {
    const r = aggregateHits(
      [q('a', 'explanation'), q('b', 'explanation')],
      [[hit('x', 1, 0.5), hit('y', 2, 0.9)], [hit('x', 1, 0.7)]],
      classify, W,
    );
    expect(r.map((h) => h.startVerseId)).toEqual([2, 1]);
    expect(score(r, 1)).toBeCloseTo(0.7);
  });

  it('dampens pairs involving a facet', () => {
    const r = aggregateHits(
      [q('a', 'explanation'), q('a_s0', 'facet')],
      [[hit('x_s0', 1, 0.8), hit('y', 2, 0.8)], [hit('z', 3, 0.8)]],
      classify, W,
    );
    expect(score(r, 1)).toBeCloseTo(0.8 * 0.92);
    expect(score(r, 2)).toBeCloseTo(0.8);
    expect(score(r, 3)).toBeCloseTo(0.8 * 0.92);
  });

  it('ignores text<->meaning pairs while crossChannel is 0, counts them otherwise', () => {
    const qs = [q('a', 'explanation')];
    const hits = [[hit('t_1', 1, 0.9), hit('y', 2, 0.6)]];
    const off = aggregateHits(qs, hits, classify, W);
    expect(off.map((h) => h.startVerseId)).toEqual([2]);
    const on = aggregateHits(qs, hits, classify, { ...W, crossChannel: 0.5 });
    expect(score(on, 1)).toBeCloseTo(0.45);
  });

  it('channels.text = 0 equals meaning-only', () => {
    const qs = [q('a', 'explanation'), q('t_a', 'text')];
    const hits = [[hit('y', 2, 0.6)], [hit('t_1', 1, 0.95), hit('t_2', 2, 0.99)]];
    const r = aggregateHits(qs, hits, classify, { ...W, channels: { text: 0, meaning: 1 } });
    expect(r).toEqual(aggregateHits([qs[0]], [hits[0]], classify, W));
    expect(r).toHaveLength(1);
  });

  it('blend: weighted mean over source channels; missing channel uses the lowest retrieved score', () => {
    const w = { ...W, combine: 'blend' as const, channels: { text: 1, meaning: 3 } };
    const qs = [q('a', 'explanation'), q('t_a', 'text')];
    const hits = [
      [hit('x', 1, 0.8), hit('y', 2, 0.6)],
      [hit('t_1', 1, 0.9), hit('t_3', 3, 0.5)],
    ];
    const r = aggregateHits(qs, hits, classify, w);
    expect(score(r, 1)).toBeCloseTo((3 * 0.8 + 1 * 0.9) / 4);
    // verse 2 has no text hit: text lowest = 0.5
    expect(score(r, 2)).toBeCloseTo((3 * 0.6 + 1 * 0.5) / 4);
    // verse 3 has no meaning hit: meaning lowest = 0.6
    expect(score(r, 3)).toBeCloseTo((3 * 0.6 + 1 * 0.5) / 4);
  });

  it('blend only counts channels the source has rows in', () => {
    const w = { ...W, combine: 'blend' as const };
    const r = aggregateHits([q('a', 'explanation')], [[hit('x', 1, 0.7)]], classify, w);
    expect(score(r, 1)).toBeCloseTo(0.7);
  });

  it('adds levelBias and keeps one hit per level|start|end', () => {
    const w = { ...W, levelBias: { verse: 0, paragraph: 0.05, chapter: 0 } };
    const r = aggregateHits(
      [q('a', 'explanation')],
      [[hit('p', 5, 0.7, 'paragraph'), hit('v', 5, 0.72, 'verse'), hit('p2', 5, 0.6, 'paragraph')]],
      classify, w,
    );
    expect(r).toHaveLength(2);
    expect(r.find((h) => h.level === 'paragraph')!.score).toBeCloseTo(0.75);
    expect(r.find((h) => h.level === 'verse')!.score).toBeCloseTo(0.72);
  });

  it('handles empty input', () => {
    expect(aggregateHits([], [], classify, W)).toEqual([]);
    expect(aggregateHits([q('a', 'explanation')], [[]], classify, W)).toEqual([]);
  });
});
