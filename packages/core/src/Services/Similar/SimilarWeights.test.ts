import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_SIMILAR_WEIGHTS,
  compileKindClassifier,
  resolveSimilarWeights,
  similarWeightsHash,
  channelOf,
} from './SimilarWeights';

afterEach(() => vi.restoreAllMocks());

describe('resolveSimilarWeights', () => {
  it('returns defaults (as a copy) for no override', () => {
    const w = resolveSimilarWeights();
    expect(w).toEqual(DEFAULT_SIMILAR_WEIGHTS);
    w.channels.text = 9;
    expect(DEFAULT_SIMILAR_WEIGHTS.channels.text).toBe(1);
  });

  it('deep-merges a partial override, object or JSON string', () => {
    const a = resolveSimilarWeights({ channels: { text: 0.5 }, combine: 'blend', levelBias: { paragraph: 0.02 } });
    expect(a.channels).toEqual({ text: 0.5, meaning: 1 });
    expect(a.combine).toBe('blend');
    expect(a.levelBias).toEqual({ verse: 0, paragraph: 0.02, chapter: 0 });
    const b = resolveSimilarWeights('{"crossChannel":0.3,"maxQueryVectors":8}');
    expect(b.crossChannel).toBe(0.3);
    expect(b.maxQueryVectors).toBe(8);
    expect(b.perQueryTopK).toBe(200);
  });

  it('ignores bad values with a warning and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = resolveSimilarWeights({
      channels: { text: -1, meaning: Number.NaN },
      crossChannel: 'x',
      facetDamping: -0.1,
      combine: 'sum',
      maxQueryVectors: 0,
      perQueryTopK: 2.5,
      levelBias: { verse: Infinity },
      bogus: 1,
      kindRules: [{ kind: 'text', idPattern: '(' }, { kind: 'nope', idPattern: 'a' }, { kind: 'text', idPattern: '^t_' }],
    });
    expect(w.channels).toEqual({ text: 1, meaning: 1 });
    expect(w.crossChannel).toBe(0);
    expect(w.facetDamping).toBe(0.92);
    expect(w.combine).toBe('max');
    expect(w.maxQueryVectors).toBe(12);
    expect(w.perQueryTopK).toBe(200);
    expect(w.levelBias.verse).toBe(0);
    expect(w.kindRules).toEqual([{ kind: 'text', idPattern: '^t_' }]);
    expect(warn).toHaveBeenCalled();
  });

  it.each([['not json'], [42], [[1, 2]], [null]])('falls back to defaults for %j', (bad) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveSimilarWeights(bad)).toEqual(DEFAULT_SIMILAR_WEIGHTS);
  });
});

describe('compileKindClassifier', () => {
  it('classifies sub-facets, everything else explanation', () => {
    const c = compileKindClassifier(DEFAULT_SIMILAR_WEIGHTS);
    expect(c('abc_s0')).toBe('facet');
    expect(c('abc_s12')).toBe('facet');
    expect(c('abc_s')).toBe('explanation');
    expect(c('abc')).toBe('explanation');
  });

  it('first matching rule wins', () => {
    const w = resolveSimilarWeights({
      kindRules: [
        { kind: 'text', idPattern: '^raw_' },
        { kind: 'facet', idPattern: '_s\\d+$' },
      ],
    });
    const c = compileKindClassifier(w);
    expect(c('raw_1_s0')).toBe('text');
    expect(c('x_s1')).toBe('facet');
    expect(c('x')).toBe('explanation');
  });

  it('skips a rule that does not compile', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = compileKindClassifier({ ...DEFAULT_SIMILAR_WEIGHTS, kindRules: [{ kind: 'text', idPattern: '(' }] });
    expect(c('a')).toBe('explanation');
  });
});

describe('channelOf / hash', () => {
  it('maps kinds to channels', () => {
    expect(channelOf('text')).toBe('text');
    expect(channelOf('explanation')).toBe('meaning');
    expect(channelOf('facet')).toBe('meaning');
  });

  it('hash is stable across key order and changes with content', () => {
    const a = DEFAULT_SIMILAR_WEIGHTS;
    const b = JSON.parse(JSON.stringify(a), (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).reverse())
        : v);
    expect(similarWeightsHash(b)).toBe(similarWeightsHash(a));
    expect(similarWeightsHash(a)).toMatch(/^[0-9a-f]{8}$/);
    expect(similarWeightsHash({ ...a, facetDamping: 0.5 })).not.toBe(similarWeightsHash(a));
  });
});
