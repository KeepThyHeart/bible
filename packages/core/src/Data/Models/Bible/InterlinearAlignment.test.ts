import { describe, it, expect } from 'vitest';
import {
  InterlinearWord,
  parseWordPositionList,
  stringifyWordPositionList
} from './BibleVerse';

/**
 * An interlinear alignment is a *list* of word ranges. Greek and Hebrew word
 * order differs from English often enough that one original word regularly maps
 * to non-adjacent translated words -- `ou me` -> "not ... at all".
 */
describe('parseWordPositionList', () => {
  it('treats a missing value as a contiguous alignment', () => {
    expect(parseWordPositionList(null)).toEqual([]);
    expect(parseWordPositionList(undefined)).toEqual([]);
    expect(parseWordPositionList('')).toEqual([]);
  });

  it('reads a bare index as a single-word range', () => {
    expect(parseWordPositionList('18')).toEqual([{ start: 18, end: 18 }]);
  });

  it('reads a start-end pair as an inclusive range', () => {
    expect(parseWordPositionList('12-14')).toEqual([{ start: 12, end: 14 }]);
  });

  it('reads a mixed list', () => {
    expect(parseWordPositionList('12-14,18')).toEqual([
      { start: 12, end: 14 },
      { start: 18, end: 18 }
    ]);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseWordPositionList(' 3 - 5 , 9 ')).toEqual([
      { start: 3, end: 5 },
      { start: 9, end: 9 }
    ]);
  });

  it('skips malformed entries rather than discarding the whole list', () => {
    // A bad annotation must never stop a verse from being read.
    expect(parseWordPositionList('4,oops,7-9')).toEqual([
      { start: 4, end: 4 },
      { start: 7, end: 9 }
    ]);
  });

  it('skips an inverted range', () => {
    expect(parseWordPositionList('9-7')).toEqual([]);
  });
});

describe('stringifyWordPositionList', () => {
  it('returns null for an empty list, so the column stores NULL', () => {
    expect(stringifyWordPositionList([])).toBeNull();
  });

  it('collapses a single-word range to a bare index', () => {
    expect(stringifyWordPositionList([{ start: 18, end: 18 }])).toBe('18');
  });

  it('round-trips a mixed list', () => {
    const spans = [
      { start: 12, end: 14 },
      { start: 18, end: 18 }
    ];
    const encoded = stringifyWordPositionList(spans);
    expect(encoded).toBe('12-14,18');
    expect(parseWordPositionList(encoded)).toEqual(spans);
  });
});

describe('InterlinearWord alignment', () => {
  const base = { verseId: 43003016, wordPositionStart: 4, wordPositionEnd: 4 };

  it('is contiguous by default', () => {
    const word = new InterlinearWord(base);
    expect(word.isDiscontiguous()).toBe(false);
    expect(word.getWordSpans()).toEqual([{ start: 4, end: 4 }]);
  });

  it('reports every range, own first, when the alignment is split', () => {
    const word = new InterlinearWord({ ...base, extraSpans: [{ start: 7, end: 8 }] });
    expect(word.isDiscontiguous()).toBe(true);
    expect(word.getWordSpans()).toEqual([
      { start: 4, end: 4 },
      { start: 7, end: 8 }
    ]);
  });
});
