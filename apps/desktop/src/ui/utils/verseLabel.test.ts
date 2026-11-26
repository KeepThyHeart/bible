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
  it('widens the gutter for the longer labels only', () => {
    expect(verseGutterClass('number', 'standard')).toBe('w-11');
    expect(verseGutterClass('bookChapterVerse', 'standard')).toContain('whitespace-nowrap');
  });
});
