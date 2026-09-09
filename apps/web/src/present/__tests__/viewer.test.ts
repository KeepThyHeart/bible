import { describe, it, expect } from 'vitest';
import { joinCodeFromLocation } from '../ViewerApp';
import { fontScaleForStep } from '../typography';
import { selectedVerses, type ChapterVerse, type Passage } from '../usePassage';
import type { PresentPassageItem } from '../protocol';

describe('reading the join code out of the URL', () => {
  it('takes it from the path people are handed', () => {
    expect(joinCodeFromLocation('/present/v/ABCD2345')).toBe('ABCD2345');
  });

  it('survives a trailing slash, query or hash', () => {
    expect(joinCodeFromLocation('/present/v/ABCD2345/')).toBe('ABCD2345');
    expect(joinCodeFromLocation('/present/v/ABCD2345?x=1')).toBe('ABCD2345');
    expect(joinCodeFromLocation('/present/v/ABCD2345#y')).toBe('ABCD2345');
  });

  it('works when the app is served from a sub-path', () => {
    expect(joinCodeFromLocation('/bible/present/v/ABCD2345')).toBe('ABCD2345');
  });

  it('returns empty rather than guessing when there is no code', () => {
    expect(joinCodeFromLocation('/present/v/')).toBe('');
    expect(joinCodeFromLocation('/')).toBe('');
  });
});

describe('font steps', () => {
  it('grows monotonically across the whole scale', () => {
    const sizes = Array.from({ length: 10 }, (_, i) => fontScaleForStep(i + 1));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    }
  });

  it('clamps rather than reading off the end of the scale', () => {
    // A malformed or future state must not produce NaN on a wall.
    expect(fontScaleForStep(0)).toBe(fontScaleForStep(1));
    expect(fontScaleForStep(-5)).toBe(fontScaleForStep(1));
    expect(fontScaleForStep(99)).toBe(fontScaleForStep(10));
  });

  it('keeps each step a similar proportional jump', () => {
    // A step from 2 to 3 should feel like the same change as 8 to 9, which a
    // linear scale does not deliver.
    const ratios = Array.from({ length: 9 }, (_, i) => fontScaleForStep(i + 2) / fontScaleForStep(i + 1));
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(1.1);
      expect(ratio).toBeLessThan(1.25);
    }
  });
});

describe('narrowing a chapter to the requested verses', () => {
  const verses: ChapterVerse[] = Array.from({ length: 36 }, (_, i) => ({
    verse_id: 43003001 + i,
    verse: i + 1,
    text: '',
    text_html: '',
  }));
  const passage: Passage = {
    key: 'KJV/43/3', module: 'KJV', book: 43, chapter: 3, bookName: 'John', verses,
  };
  const whole: PresentPassageItem = { kind: 'passage', module: 'KJV', book: 43, chapter: 3 };

  it('shows the whole chapter when no range is given', () => {
    expect(selectedVerses(passage, whole)).toHaveLength(36);
  });

  it('honours a range without a second fetch', () => {
    // The whole chapter is already cached, so narrowing is a filter rather than
    // a round trip that would empty the screen while it completed.
    const selection = selectedVerses(passage, { ...whole, verseStart: 16, verseEnd: 17 });
    expect(selection.map(v => v.verse)).toEqual([16, 17]);
  });

  it('treats an open end as running to the end of the chapter', () => {
    expect(selectedVerses(passage, { ...whole, verseStart: 30 }).map(v => v.verse))
      .toEqual([30, 31, 32, 33, 34, 35, 36]);
  });
});
