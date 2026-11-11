import { describe, expect, it } from 'vitest';
import { scanReferences } from '../referenceScan';

describe('scanReferences', () => {
  it('finds a reference by its full book name', () => {
    expect(scanReferences('Please read John 3:16 tonight.')).toEqual([
      { book: 43, chapter: 3, verseStart: 16, verseEnd: undefined, matchedText: 'John 3:16', from: 12, to: 21, bookText: 'John', group: 0 },
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

  it('returns repeats when asked, with their positions', () => {
    const text = 'John 3:16 ... and again, John 3:16.';
    const found = scanReferences(text, { keepDuplicates: true });
    expect(found.map(ref => text.slice(ref.from, ref.to))).toEqual(['John 3:16', 'John 3:16']);
  });

  it('reads "Phil" as Philippians and "Phm" as Philemon', () => {
    expect(scanReferences('Phil 4:6-7')).toMatchObject([{ book: 50, chapter: 4, verseStart: 6, verseEnd: 7, matchedText: 'Phil 4:6-7' }]);
    expect(scanReferences('Phil. 2:5')).toMatchObject([{ book: 50, chapter: 2, verseStart: 5 }]);
    expect(scanReferences('Phm 1:6')).toMatchObject([{ book: 57, chapter: 1, verseStart: 6 }]);
    expect(scanReferences('Philip went down to Samaria')).toEqual([]);
  });

  it('reads a roman-numeral prefix', () => {
    expect(scanReferences('II Tim 1:7')).toMatchObject([{ book: 55, chapter: 1, verseStart: 7 }]);
  });

  describe('a chapter:verse after a semicolon continues the book', () => {
    it.each([
      ['John 14:1–3; 14:27', [
        { book: 43, chapter: 14, verseStart: 1, verseEnd: 3, matchedText: 'John 14:1–3' },
        { book: 43, chapter: 14, verseStart: 27, matchedText: '14:27', listed: true },
      ]],
      ['Rom 8:28; 12:1', [
        { book: 45, chapter: 8, verseStart: 28 },
        { book: 45, chapter: 12, verseStart: 1, listed: true, bookText: 'Rom' },
      ]],
      ['Rom 8:28; 12:1-2; 15:13', [
        { chapter: 8, verseStart: 28 },
        { chapter: 12, verseStart: 1, verseEnd: 2 },
        { chapter: 15, verseStart: 13 },
      ]],
    ])('%s', (text, expected) => {
      const found = scanReferences(text);
      expect(found).toMatchObject(expected);
      expect(found).toHaveLength(expected.length);
      expect(new Set(found.map(ref => ref.group)).size).toBe(1);
      for (const ref of found) expect(text.slice(ref.from, ref.to).replace(/\s+/g, ' ')).toBe(ref.matchedText);
    });

    it('does not take a following book with a leading digit as a chapter', () => {
      expect(scanReferences('Rom 8:28; 1 Cor 13:4')).toMatchObject([
        { book: 45, chapter: 8, verseStart: 28 },
        { book: 46, chapter: 13, verseStart: 4 },
      ]);
    });

    it('needs a verse after the semicolon', () => {
      expect(scanReferences('Read John 3:16; 3 people will pray.')).toHaveLength(1);
    });
  });

  describe('comma lists within a chapter', () => {
    it.each([
      ['Isaiah 26:3,4', [{ book: 23, chapter: 26, verseStart: 3, verseEnd: 4, matchedText: 'Isaiah 26:3,4' }]],
      ['Isaiah 26:3, 4', [{ book: 23, chapter: 26, verseStart: 3, verseEnd: 4 }]],
      ['Psalm 23:1-3, 6', [
        { book: 19, chapter: 23, verseStart: 1, verseEnd: 3, matchedText: 'Psalm 23:1-3' },
        { book: 19, chapter: 23, verseStart: 6, matchedText: '6', listed: true },
      ]],
      ['Psalm 23:1-3, 4-6', [{ chapter: 23, verseStart: 1, verseEnd: 6 }]],
      ['Ps 23:1, 4, 6.', [
        { chapter: 23, verseStart: 1 },
        { chapter: 23, verseStart: 4 },
        { chapter: 23, verseStart: 6 },
      ]],
    ])('%s', (text, expected) => {
      const found = scanReferences(text);
      expect(found).toMatchObject(expected);
      expect(found).toHaveLength(expected.length);
    });

    it('leaves a number that starts prose alone', () => {
      expect(scanReferences('Read Romans 8:28, 3 times over.')).toMatchObject([{ chapter: 8, verseStart: 28 }]);
      expect(scanReferences('Read Romans 8:28, 3 times over.')).toHaveLength(1);
    });

    it('does not read a chapter:verse after a comma as a verse', () => {
      expect(scanReferences('Rom 8:28, 12:1')).toEqual([expect.objectContaining({ chapter: 8, verseStart: 28 })]);
    });

    it('does not continue past a following book', () => {
      expect(scanReferences('See also Rom. 8:28, Phil 4:6-7 and 1 Pet 5:7')).toMatchObject([
        { book: 45, chapter: 8, verseStart: 28, matchedText: 'Rom. 8:28' },
        { book: 50, chapter: 4, verseStart: 6, verseEnd: 7 },
        { book: 60, chapter: 5, verseStart: 7 },
      ]);
    });
  });

  describe('a dot between chapter and verse', () => {
    it.each([
      ['Jn 3.16', { book: 43, chapter: 3, verseStart: 16, matchedText: 'Jn 3.16' }],
      ['Jn 3.16-18', { book: 43, chapter: 3, verseStart: 16, verseEnd: 18 }],
      ['Rom 8.28; 12.1', { book: 45, chapter: 8, verseStart: 28 }],
    ])('%s', (text, expected) => {
      expect(scanReferences(text)[0]).toMatchObject(expected);
    });

    it('is a sentence end, not a verse, when a space follows', () => {
      expect(scanReferences('see John 3. 16 people came')).toEqual([
        expect.objectContaining({ book: 43, chapter: 3, verseStart: undefined, matchedText: 'John 3' }),
      ]);
    });

    it('is a sentence end at the end of the text', () => {
      expect(scanReferences('Read John 3.')).toMatchObject([{ chapter: 3, verseStart: undefined }]);
    });
  });

  it('reads a cross-chapter range as its first verse', () => {
    expect(scanReferences('John 3:1-4:2')).toEqual([expect.objectContaining({ chapter: 3, verseStart: 1, verseEnd: undefined })]);
  });
});
