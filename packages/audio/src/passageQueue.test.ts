import { describe, it, expect } from 'vitest';
import {
  MAX_PASSAGES, nextIndex, passageContains, passageLastChapter, passageStart, prevIndex,
  sanitizeBookmark, sanitizeQueue, stopVerseIn, toPassages, type PassageQueue,
} from './passageQueue';

const q = (n: number, index = 0, kind: 'chapter' | 'list' = 'list'): PassageQueue => ({
  kind, index, passages: Array.from({ length: n }, (_, i) => ({ book: 43, chapter: i + 1 })),
});

describe('toPassages', () => {
  it('expands a whole book and keeps explicit ranges', () => {
    const out = toPassages([
      { book: 43, chapter: 1, wholeBook: true },
      { book: 43, chapter: 3, verse: 16, endChapter: 4, endVerse: 5 },
      { book: 57, chapter: 1, wholeBook: true },
      { book: 19, chapter: 23 },
    ], b => (b === 43 ? 21 : 1));
    expect(out).toEqual([
      { book: 43, chapter: 1, endChapter: 21 },
      { book: 43, chapter: 3, verse: 16, endChapter: 4, endVerse: 5 },
      { book: 57, chapter: 1 },
      { book: 19, chapter: 23 },
    ]);
  });
  it('caps at MAX_PASSAGES', () => {
    const many = Array.from({ length: 80 }, () => ({ book: 1, chapter: 1 }));
    expect(toPassages(many, () => 50)).toHaveLength(MAX_PASSAGES);
  });
});

describe('start, last chapter, stop verse', () => {
  it('passageStart defaults verse to 1', () => {
    expect(passageStart({ book: 43, chapter: 3 })).toEqual({ book: 43, chapter: 3, verse: 1 });
    expect(passageStart({ book: 43, chapter: 3, verse: 16 })).toEqual({ book: 43, chapter: 3, verse: 16 });
  });
  it('passageLastChapter', () => {
    expect(passageLastChapter({ book: 43, chapter: 3 })).toBe(3);
    expect(passageLastChapter({ book: 43, chapter: 3, endChapter: 5 })).toBe(5);
  });
  it('stopVerseIn', () => {
    expect(stopVerseIn({ book: 43, chapter: 3, verse: 16 }, 43, 3)).toBe(16);          // single verse
    expect(stopVerseIn({ book: 43, chapter: 3, verse: 16, endVerse: 18 }, 43, 3)).toBe(18);
    const cross = { book: 43, chapter: 3, verse: 34, endChapter: 4, endVerse: 2 };
    expect(stopVerseIn(cross, 43, 3)).toBeNull();                                      // not the last chapter
    expect(stopVerseIn(cross, 43, 4)).toBe(2);
    expect(stopVerseIn({ book: 43, chapter: 3 }, 43, 3)).toBeNull();                   // whole chapter
    expect(stopVerseIn({ book: 43, chapter: 3, endChapter: 5 }, 43, 5)).toBeNull();
    expect(stopVerseIn({ book: 43, chapter: 3, verse: 5, endChapter: 4 }, 43, 4)).toBeNull();
    expect(stopVerseIn({ book: 43, chapter: 3, verse: 16 }, 42, 3)).toBeNull();        // other book
  });
});

describe('passageContains', () => {
  const cross = { book: 43, chapter: 3, verse: 34, endChapter: 4, endVerse: 2 };
  it('handles cross-chapter bounds', () => {
    expect(passageContains(cross, 43, 3, 33)).toBe(false);
    expect(passageContains(cross, 43, 3, 34)).toBe(true);
    expect(passageContains(cross, 43, 4, 2)).toBe(true);
    expect(passageContains(cross, 43, 4, 3)).toBe(false);
    expect(passageContains(cross, 43, 5, 1)).toBe(false);
    expect(passageContains(cross, 42, 3, 40)).toBe(false);
  });
  it('single verse and whole chapter', () => {
    const one = { book: 43, chapter: 3, verse: 16 };
    expect(passageContains(one, 43, 3, 16)).toBe(true);
    expect(passageContains(one, 43, 3, 17)).toBe(false);
    expect(passageContains({ book: 43, chapter: 3 }, 43, 3, 99)).toBe(true);
    expect(passageContains({ book: 43, chapter: 3, endChapter: 5 }, 43, 4, 1)).toBe(true);
  });
});

describe('nextIndex / prevIndex', () => {
  it('once ends, list wraps, passage repeats', () => {
    expect(nextIndex(q(3, 0), 'once')).toBe(1);
    expect(nextIndex(q(3, 2), 'once')).toBeNull();
    expect(nextIndex(q(3, 2), 'list')).toBe(0);
    expect(nextIndex(q(1, 0), 'list')).toBe(0);
    expect(nextIndex(q(3, 1), 'passage')).toBe(1);
    expect(nextIndex({ kind: 'list', passages: [], index: 0 }, 'list')).toBeNull();
  });
  it('prev does not wrap', () => {
    expect(prevIndex(q(3, 2))).toBe(1);
    expect(prevIndex(q(3, 0))).toBeNull();
  });
});

describe('sanitizeQueue / sanitizeBookmark', () => {
  it('rejects garbage', () => {
    for (const bad of [null, 5, 'x', [], {}, { kind: 'x', passages: [{ book: 1, chapter: 1 }], index: 0 },
      { kind: 'list', passages: 'no', index: 0 }, { kind: 'list', passages: [], index: 0 },
      { kind: 'list', passages: [{ book: 0, chapter: 1 }], index: 0 }]) {
      expect(sanitizeQueue(bad)).toBeNull();
    }
  });
  it('drops bad passages and repairs the index', () => {
    const out = sanitizeQueue({
      kind: 'list', index: 9,
      passages: [{ book: 1, chapter: 1, junk: true }, { book: 'x' }, { book: 2, chapter: 3, endChapter: 2 }, { book: 3, chapter: 4, verse: 5, endVerse: 6 }],
    });
    expect(out).toEqual({ kind: 'list', index: 0, passages: [{ book: 1, chapter: 1 }, { book: 3, chapter: 4, verse: 5, endVerse: 6 }] });
  });
  it('keeps a valid queue and caps its size', () => {
    expect(sanitizeQueue(q(3, 2))).toEqual(q(3, 2));
    const big = { kind: 'list', index: 0, passages: Array.from({ length: 70 }, () => ({ book: 1, chapter: 1 })) };
    expect(sanitizeQueue(big)!.passages).toHaveLength(MAX_PASSAGES);
  });
  it('sanitizeBookmark validates fields and drops only a bad queue', () => {
    const good = { moduleAbbr: 'KJV', book: 43, chapter: 3, verse: 16 };
    expect(sanitizeBookmark(good)).toEqual(good);
    expect(sanitizeBookmark({ ...good, queue: q(2, 1) })).toEqual({ ...good, queue: q(2, 1) });
    expect(sanitizeBookmark({ ...good, queue: 'junk' })).toEqual(good);
    expect(sanitizeBookmark({ ...good, verse: 0 })).toBeNull();
    expect(sanitizeBookmark({ ...good, moduleAbbr: '' })).toBeNull();
    expect(sanitizeBookmark(null)).toBeNull();
  });
});

describe('selAtSave and chapter counts', () => {
  it('sanitizeBookmark keeps a valid selAtSave and drops a bad one', () => {
    const base = { moduleAbbr: 'KJV', book: 43, chapter: 3, verse: 16 };
    expect(sanitizeBookmark({ ...base, selAtSave: 43_003_016 })?.selAtSave).toBe(43_003_016);
    expect(sanitizeBookmark({ ...base, selAtSave: 'x' })?.selAtSave).toBeUndefined();
  });
  it('drops passages beyond the book\'s chapter count', () => {
    const q = sanitizeQueue({ kind: 'list', index: 0, passages: [{ book: 43, chapter: 3 }, { book: 43, chapter: 40 }, { book: 43, chapter: 2, endChapter: 30 }] }, () => 21);
    expect(q?.passages).toEqual([{ book: 43, chapter: 3 }]);
  });
});
