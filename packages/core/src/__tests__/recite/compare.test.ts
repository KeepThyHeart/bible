import { compareWords } from '../../recite/compare';
import { englishKit as kit } from '../../recite/lang/en';

describe('compareWords', () => {
  it.each([
    ['lord', 'lord', 'correct', 0],
    ['thy', 'thigh', 'variant', 0],
    ['there', 'their', 'variant', 0],
    ['holy', 'wholly', 'variant', 0],
    ['saviour', 'savior', 'variant', 0],
    ['honour', 'honor', 'variant', 0],
    ['judgement', 'judgment', 'variant', 0],
    ['an', 'one', 'variant', 0],
    ['one', 'a', 'variant', 0],
    ['believeth', 'believes', 'near', 0.4],
    ['believes', 'believeth', 'near', 0.4],
    ['hath', 'has', 'near', 0.4],
    ['doth', 'does', 'near', 0.4],
    ['saith', 'says', 'near', 0.4],
    ['thou', 'you', 'near', 0.4],
    ['unto', 'to', 'near', 0.4],
    ['knoweth', 'know', 'near', 0.4],
    ['runneth', 'runs', 'near', 0.4],
    ['lord', 'word', 'near', 0.4],
    ['mercy', 'nation', 'wrong', 1],
    ['your', 'or', 'wrong', 1],
    ['the', 'a', 'wrong', 1],
    ['four', 'or', 'wrong', 1],
  ])('%s vs %s -> %s', (t, h, verdict, cost) => {
    expect(compareWords(t, h, kit)).toEqual({ verdict, cost });
  });

  it('never treats "ever lasting" halves as matching "everlasting" (alignment joins them)', () => {
    expect(compareWords('everlasting', 'ever', kit).verdict).toBe('wrong');
    expect(compareWords('everlasting', 'lasting', kit).verdict).toBe('wrong');
  });

  it('memoises per target+heard pair', () => {
    const cache = new Map();
    let calls = 0;
    const counting = { ...kit, equivalent: (a: string, b: string) => { calls++; return kit.equivalent(a, b); } };
    const a = compareWords('hath', 'has', counting, cache);
    const b = compareWords('hath', 'has', counting, cache);
    expect(b).toBe(a);
    expect(calls).toBe(1);
    expect(cache.size).toBe(1);
    compareWords('has', 'hath', counting, cache);
    expect(cache.size).toBe(2);
  });
});
