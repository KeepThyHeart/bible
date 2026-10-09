import { describe, it, expect } from 'vitest';
import { levenshtein } from './distance.js';

describe('levenshtein', () => {
  it.each([
    ['identical strings', 'peter', 'peter', 0],
    ['both empty', '', '', 0],
    ['one empty', '', 'ruth', 4],
    ['the other empty', 'ruth', '', 4],
    ['one substitution', 'cain', 'rain', 1],
    ['one insertion', 'lord', 'lords', 1],
    ['one deletion', 'lords', 'lord', 1],
    ['a transposition costs two', 'form', 'from', 2],
    ['the textbook pair', 'kitten', 'sitting', 3],
    ['another textbook pair', 'saturday', 'sunday', 3],
    ['overlapping edits', 'flaw', 'lawn', 2],
    ['nothing in common', 'abc', 'xyz', 3],
    ['a space counts as a character', 'wellbeloved', 'well beloved', 1],
    ['a long biblical name', 'nebuchadnezzar', 'nebuchadnezar', 1],
    ['different lengths entirely', 'go', 'goeth', 3],
  ])('%s', (_name, a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
  });

  it.each([
    ['kitten', 'sitting'],
    ['ruth', ''],
    ['nebuchadnezzar', 'ne'],
    ['a', 'abcdefgh'],
  ])('is symmetric for %s and %s', (a, b) => {
    expect(levenshtein(a, b)).toBe(levenshtein(b, a));
  });

  it('never exceeds the length of the longer string', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['shepherd', 'lamb'],
      ['jerusalem', 'jericho'],
      ['a', 'zzzzzzzz'],
    ];
    for (const [a, b] of pairs) {
      expect(levenshtein(a, b)).toBeLessThanOrEqual(Math.max(a.length, b.length));
    }
  });

  it('gives the same answer whichever string is longer, so row choice is invisible', () => {
    expect(levenshtein('prophet', 'prophets and kings')).toBe(
      levenshtein('prophets and kings', 'prophet'),
    );
  });
});
