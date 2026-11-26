import { describe, it, expect } from 'vitest';
import { VERSE_COUNTS, verseCount } from './VerseCounts';
import { MAX_CHAPTERS } from './BookNames';

describe('VERSE_COUNTS', () => {
  it('has one entry per chapter of every book', () => {
    for (const [book, chapters] of Object.entries(MAX_CHAPTERS)) {
      expect(VERSE_COUNTS[Number(book)]).toHaveLength(chapters);
    }
  });
  it('knows landmark chapters and totals 31,102 verses', () => {
    expect(verseCount(43, 3)).toBe(36);
    expect(verseCount(19, 119)).toBe(176);
    expect(verseCount(1, 1)).toBe(31);
    expect(verseCount(31, 1)).toBe(21);
    expect(Object.values(VERSE_COUNTS).flat().reduce((a, b) => a + b, 0)).toBe(31102);
  });
  it('returns 0 outside the canon', () => {
    expect(verseCount(67, 1)).toBe(0);
    expect(verseCount(1, 51)).toBe(0);
  });
});
