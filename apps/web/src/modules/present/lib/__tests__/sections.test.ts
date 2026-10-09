import { describe, expect, it } from 'vitest';
import { FALLBACK_SECTION_STRIDE, sectionTarget, type SectionVerse } from '../sections';

function chapter(count: number, headings: number[] = [], paragraphs: number[] = []): SectionVerse[] {
  return Array.from({ length: count }, (_, i) => ({
    verse: i + 1,
    section_heading: headings.includes(i + 1) ? 'Heading' : null,
    is_paragraph_start: paragraphs.includes(i + 1),
  }));
}

describe('sectionTarget', () => {
  it('jumps forward to the next section heading', () => {
    const verses = chapter(30, [1, 11, 21]);
    expect(sectionTarget(verses, 3, 'next')).toBe(11);
    expect(sectionTarget(verses, 11, 'next')).toBe(21);
  });

  it('lands on the last verse when no section follows', () => {
    expect(sectionTarget(chapter(30, [1, 11, 21]), 25, 'next')).toBe(30);
  });

  it('jumps back to the start of the current section, then the one before it', () => {
    const verses = chapter(30, [1, 11, 21]);
    expect(sectionTarget(verses, 15, 'previous')).toBe(11);
    expect(sectionTarget(verses, 11, 'previous')).toBe(1);
  });

  it('lands on the first verse when no section precedes', () => {
    expect(sectionTarget(chapter(30, [5, 11]), 3, 'previous')).toBe(1);
  });

  it('treats the first verse as a section start even without a heading', () => {
    expect(sectionTarget(chapter(30, [11]), 15, 'previous')).toBe(11);
    expect(sectionTarget(chapter(30, [11]), 11, 'previous')).toBe(1);
  });

  it('falls back to paragraph starts when a module ships no headings', () => {
    expect(sectionTarget(chapter(30, [], [1, 8, 20]), 2, 'next')).toBe(8);
  });

  it('falls back to a fixed stride with neither, clamped to the chapter', () => {
    const verses = chapter(12);
    expect(sectionTarget(verses, 3, 'next')).toBe(3 + FALLBACK_SECTION_STRIDE);
    expect(sectionTarget(verses, 10, 'next')).toBe(12);
    expect(sectionTarget(verses, 3, 'previous')).toBe(1);
  });

  it('ignores the verse-0 preface and copes with an empty chapter', () => {
    const verses: SectionVerse[] = [{ verse: 0, section_heading: 'Preface' }, ...chapter(10, [6])];
    expect(sectionTarget(verses, 2, 'next')).toBe(6);
    expect(sectionTarget([], 4, 'next')).toBe(4);
  });
});
