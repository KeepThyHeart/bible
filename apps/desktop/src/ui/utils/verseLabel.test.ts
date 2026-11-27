import { describe, it, expect } from 'vitest';
import { EnglishLocalizer } from '@bible/core';
import { verseLabelText, verseGutterClass } from './verseLabel';

const jn316 = { book: 43, chapter: 3, verse: 16 };

describe('verseLabelText', () => {
  it('shows the bare number by default', () => {
    expect(verseLabelText('number', jn316, EnglishLocalizer)).toBe('16');
  });
  it('shows chapter:verse', () => {
    expect(verseLabelText('chapterVerse', jn316, EnglishLocalizer)).toBe('3:16');
  });
  it('shows an abbreviated book name with chapter:verse', () => {
    const label = verseLabelText('bookChapterVerse', jn316, EnglishLocalizer);
    expect(label).toMatch(/^\S+ 3:16$/);
    expect(label.length).toBeLessThan('John 3:16'.length + 1);
  });
  it('keeps verse numbers in a fixed, right-aligned gutter', () => {
    expect(verseGutterClass('number', 'standard')).toBe('w-11 pe-2 text-end');
    expect(verseGutterClass('number', 'parallel')).toBe('w-9 pe-2 text-end');
  });
  it('gives the book style more room before the text than chapter:verse', () => {
    expect(verseGutterClass('chapterVerse', 'standard')).toContain('pe-2');
    expect(verseGutterClass('bookChapterVerse', 'standard')).toContain('pe-3');
    expect(verseGutterClass('bookChapterVerse', 'standard')).toContain('ps-1.5');
  });
  it('left-aligns reference labels in a column sized from the measured width', () => {
    for (const mode of ['chapterVerse', 'bookChapterVerse'] as const) {
      for (const surface of ['standard', 'study', 'parallel'] as const) {
        const cls = verseGutterClass(mode, surface);
        expect(cls).toContain('text-start');
        expect(cls).not.toContain('text-end');
        expect(cls).toContain('var(--verse-label-width');
        expect(cls).toContain('whitespace-nowrap');
      }
    }
  });
});
