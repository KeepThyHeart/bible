/**
 * Tests for the real verse-ID helpers.
 *
 * These replace the "Verse ID parsing" block in `src/__tests__/utils.test.ts`,
 * which declared its own local copy of `parseVerseId` and tested that — so it
 * passed regardless of what `src/utils/verseId.ts` did. One of its cases
 * (`expect((43 * 1000000) + (3 * 1000) + 16).toBe(43003016)`) tested nothing
 * but JavaScript arithmetic.
 */
import { describe, it, expect, vi } from 'vitest';

// getLocalizedBookName goes through i18n, which is not initialized under
// vitest; stub it with the English names so the formatting assertions below
// are about the range logic rather than about translation loading.
const BOOK_NAMES: Record<string, string> = {
  '19': 'Psalms',
  '43': 'John',
  '57': 'Philemon',
  '65': 'Jude',
};

vi.mock('../i18n', () => ({
  default: {
    t: (key: string, opts?: { defaultValue?: string }) => BOOK_NAMES[key] ?? opts?.defaultValue ?? key,
  },
}));

import { parseVerseId, formatVerseRange, isTskModule } from './verseId';

describe('parseVerseId', () => {
  it.each([
    ['John 3:16', 43003016, 43, 3, 16],
    ['Genesis 1:1', 1001001, 1, 1, 1],
    ['Revelation 22:21', 66022021, 66, 22, 21],
    ['Psalm 119:176', 19119176, 19, 119, 176],
  ])('parses %s', (_label, verseId, bookNumber, chapter, verse) => {
    expect(parseVerseId(verseId)).toEqual({ bookNumber, chapter, verse });
  });

  it('round-trips a verse id built from its parts', () => {
    const verseId = (43 * 1000000) + (3 * 1000) + 16;
    expect(parseVerseId(verseId)).toEqual({ bookNumber: 43, chapter: 3, verse: 16 });
  });
});

describe('formatVerseRange', () => {
  it('formats a single verse', () => {
    expect(formatVerseRange(43003016)).toBe('John 3:16');
  });

  it('formats a range within one chapter', () => {
    expect(formatVerseRange(43003016, 43003018)).toBe('John 3:16-18');
  });

  it('spells out the chapter again when the range crosses one', () => {
    expect(formatVerseRange(43003016, 43004005)).toBe('John 3:16-4:5');
  });

  it('omits the chapter for single-chapter books', () => {
    // Jude 1:3-5 reads as "Jude 3-5" — printing "Jude 1:3-5" is the tell that
    // the single-chapter branch was skipped.
    expect(formatVerseRange(65001003, 65001005)).toBe('Jude 3-5');
    expect(formatVerseRange(65001003)).toBe('Jude 3');
    expect(formatVerseRange(57001010)).toBe('Philemon 10');
  });

  it('treats an end equal to the start as a single verse', () => {
    expect(formatVerseRange(43003016, 43003016)).toBe('John 3:16');
  });

  it('treats a null or absent end as a single verse', () => {
    expect(formatVerseRange(43003016, null)).toBe('John 3:16');
    expect(formatVerseRange(43003016, undefined)).toBe('John 3:16');
  });
});

describe('isTskModule', () => {
  it('matches regardless of case', () => {
    expect(isTskModule('TSK')).toBe(true);
    expect(isTskModule('tsk')).toBe(true);
  });

  it('does not match other commentaries', () => {
    expect(isTskModule('MHC')).toBe(false);
    expect(isTskModule('')).toBe(false);
  });
});
