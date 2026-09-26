import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetVerseWordTextCache,
  getCachedVerseWords,
  registerVerseWords,
  sumCachedMatches,
} from './VerseWordTextCache';

describe('VerseWordTextCache', () => {
  beforeEach(() => __resetVerseWordTextCache());

  it('stores and returns a verse\'s word text, per module', () => {
    registerVerseWords(1, 100, [{ text: 'a' }, { text: 'b' }]);
    expect(getCachedVerseWords(1, 100)).toEqual(['a', 'b']);
    expect(getCachedVerseWords(2, 100)).toBeUndefined();
  });

  it('sums matcher results over cached verses in [start, end) of one module', () => {
    registerVerseWords(1, 100, [{ text: 'x' }, { text: 'y' }]);
    registerVerseWords(1, 101, [{ text: 'x' }]);
    registerVerseWords(1, 102, [{ text: 'x' }]);
    registerVerseWords(2, 100, [{ text: 'x' }]);
    const countX = (w: string[]) => w.filter((t) => t === 'x').length;
    expect(sumCachedMatches(1, 100, 102, countX)).toBe(2);
  });
});
