import { describe, expect, it } from 'vitest';
import { scanReferences } from '../referenceScan';

describe('scanReferences', () => {
  it('finds a reference by its full book name', () => {
    expect(scanReferences('Please read John 3:16 tonight.')).toEqual([
      { book: 43, chapter: 3, verseStart: 16, verseEnd: undefined, matchedText: 'John 3:16' },
    ]);
  });

  it('finds a reference by a common abbreviation', () => {
    expect(scanReferences('Rom 8:28 is the theme.')).toMatchObject([
      { book: 45, chapter: 8, verseStart: 28 },
    ]);
  });

  it('finds a numbered book written with a leading digit', () => {
    expect(scanReferences('Turn to 1 Corinthians 13:4-7.')).toMatchObject([
      { book: 46, chapter: 13, verseStart: 4, verseEnd: 7 },
    ]);
  });

  it('finds a bare chapter with no verse', () => {
    expect(scanReferences('Start in Genesis 1 this week.')).toMatchObject([
      { book: 1, chapter: 1, verseStart: undefined },
    ]);
  });

  it('drops extra leading words rather than failing the whole phrase', () => {
    expect(scanReferences('As the Gospel of John 3:16 says,')).toMatchObject([
      { book: 43, chapter: 3, verseStart: 16 },
    ]);
  });

  it('finds several references in one block of text, in order', () => {
    const outline = `
      Call to worship: Psalm 100
      Reading: John 3:16-18
      Sermon text: Romans 8:28
    `;
    expect(scanReferences(outline)).toMatchObject([
      { book: 19, chapter: 100 },
      { book: 43, chapter: 3, verseStart: 16, verseEnd: 18 },
      { book: 45, chapter: 8, verseStart: 28 },
    ]);
  });

  it('accepts an en dash or an em dash in a verse range', () => {
    expect(scanReferences('John 3:16–18')).toMatchObject([{ verseStart: 16, verseEnd: 18 }]);
    expect(scanReferences('John 3:16—18')).toMatchObject([{ verseStart: 16, verseEnd: 18 }]);
  });

  it('is case-insensitive', () => {
    expect(scanReferences('read JOHN 3:16')).toMatchObject([{ book: 43, chapter: 3 }]);
    expect(scanReferences('read john 3:16')).toMatchObject([{ book: 43, chapter: 3 }]);
  });

  it('drops an exact duplicate, keeping the first occurrence', () => {
    expect(scanReferences('John 3:16 ... and again, John 3:16.')).toHaveLength(1);
  });

  it('does not treat two bare numbers as a reference', () => {
    // No book name anywhere -- this is what "3 16" being interpreted as a
    // chapter/verse jump in the search box must never do to pasted prose.
    expect(scanReferences('In 2020, 3 events happened, and 16 people came.')).toEqual([]);
  });

  it('ignores a verse range where the end comes before the start', () => {
    expect(scanReferences('John 3:18-16')).toEqual([]);
  });

  it('returns nothing for text with no references', () => {
    expect(scanReferences('Welcome everyone, please stand for the opening hymn.')).toEqual([]);
  });
});
