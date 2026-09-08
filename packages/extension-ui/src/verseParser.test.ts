import { describe, it, expect } from 'vitest';
import {
  calculateVerseId,
  parseReference,
  scanText,
  getBookNumber,
  getBookName,
} from './verseParser';

describe('calculateVerseId', () => {
  it('encodes John 3:16 correctly', () => {
    expect(calculateVerseId(43, 3, 16)).toBe(43003016);
  });

  it('encodes Genesis 1:1', () => {
    expect(calculateVerseId(1, 1, 1)).toBe(1001001);
  });

  it('encodes Revelation 22:21', () => {
    expect(calculateVerseId(66, 22, 21)).toBe(66022021);
  });
});

describe('getBookNumber', () => {
  it('resolves full names', () => {
    expect(getBookNumber('Genesis')).toBe(1);
    expect(getBookNumber('Revelation')).toBe(66);
  });

  it('resolves abbreviations', () => {
    expect(getBookNumber('Gen')).toBe(1);
    expect(getBookNumber('Rev')).toBe(66);
    expect(getBookNumber('Jn')).toBe(43);
  });

  it('is case-insensitive', () => {
    expect(getBookNumber('JOHN')).toBe(43);
    expect(getBookNumber('john')).toBe(43);
  });

  it('resolves numbered books', () => {
    expect(getBookNumber('1 Corinthians')).toBe(46);
    expect(getBookNumber('2 Samuel')).toBe(10);
    expect(getBookNumber('3 John')).toBe(64);
  });

  it('returns undefined for unknown names', () => {
    expect(getBookNumber('FakeBook')).toBeUndefined();
  });
});

describe('getBookName', () => {
  it('returns display names', () => {
    expect(getBookName(1)).toBe('Genesis');
    expect(getBookName(43)).toBe('John');
    expect(getBookName(66)).toBe('Revelation');
  });

  it('returns fallback for out-of-range', () => {
    expect(getBookName(99)).toBe('Book 99');
  });
});

describe('parseReference', () => {
  it('parses "John 3:16"', () => {
    const ref = parseReference('John 3:16');
    expect(ref).toBeDefined();
    expect(ref!.book).toBe(43);
    expect(ref!.chapter).toBe(3);
    expect(ref!.verse).toBe(16);
    expect(ref!.verseId).toBe(43003016);
  });

  it('parses "Gen 1:1"', () => {
    const ref = parseReference('Gen 1:1');
    expect(ref).toBeDefined();
    expect(ref!.book).toBe(1);
    expect(ref!.verseId).toBe(1001001);
  });

  it('parses verse ranges: "Rom 8:28-30"', () => {
    const ref = parseReference('Rom 8:28-30');
    expect(ref).toBeDefined();
    expect(ref!.verse).toBe(28);
    expect(ref!.endVerse).toBe(30);
    expect(ref!.verseId).toBe(45008028);
    expect(ref!.endVerseId).toBe(45008030);
  });

  it('parses cross-chapter ranges: "Genesis 1:1-2:3"', () => {
    const ref = parseReference('Genesis 1:1-2:3');
    expect(ref).toBeDefined();
    expect(ref!.chapter).toBe(1);
    expect(ref!.verse).toBe(1);
    expect(ref!.endChapter).toBe(2);
    expect(ref!.endVerse).toBe(3);
    expect(ref!.endVerseId).toBe(1002003);
  });

  it('parses whole chapter: "Ps 23"', () => {
    const ref = parseReference('Ps 23');
    expect(ref).toBeDefined();
    expect(ref!.chapter).toBe(23);
    expect(ref!.verse).toBeUndefined();
    expect(ref!.verseId).toBe(19023001);
  });

  it('handles single-chapter books: "Jude 5"', () => {
    const ref = parseReference('Jude 5');
    expect(ref).toBeDefined();
    expect(ref!.chapter).toBe(1);
    expect(ref!.verse).toBe(5);
    expect(ref!.verseId).toBe(65001005);
  });

  it('handles single-chapter book range: "Jude 5-8"', () => {
    const ref = parseReference('Jude 5-8');
    expect(ref).toBeDefined();
    expect(ref!.chapter).toBe(1);
    expect(ref!.verse).toBe(5);
    expect(ref!.endVerse).toBe(8);
  });

  it('parses numbered books: "1 Cor 13:4-7"', () => {
    const ref = parseReference('1 Cor 13:4-7');
    expect(ref).toBeDefined();
    expect(ref!.book).toBe(46);
    expect(ref!.chapter).toBe(13);
    expect(ref!.verse).toBe(4);
    expect(ref!.endVerse).toBe(7);
  });

  it('returns undefined for non-references', () => {
    expect(parseReference('Hello world')).toBeUndefined();
    expect(parseReference('FakeBook 1:1')).toBeUndefined();
    expect(parseReference('')).toBeUndefined();
  });
});

describe('scanText', () => {
  it('finds references in running text', () => {
    const text = 'Read John 3:16 and Romans 8:28 for encouragement.';
    const refs = scanText(text);
    expect(refs).toHaveLength(2);
    expect(refs[0].book).toBe(43);
    expect(refs[0].text).toBe('John 3:16');
    expect(refs[0].start).toBe(5);
    expect(refs[1].book).toBe(45);
    expect(refs[1].text).toBe('Romans 8:28');
  });

  it('handles comma-separated verses: "John 3:16, 17"', () => {
    const text = 'See John 3:16, 17 for context.';
    const refs = scanText(text);
    expect(refs).toHaveLength(2);
    expect(refs[0].verseId).toBe(43003016);
    expect(refs[1].verseId).toBe(43003017);
  });

  it('returns empty for text without references', () => {
    expect(scanText('Just a regular sentence.')).toHaveLength(0);
  });

  it('tracks positions correctly', () => {
    const text = 'Start Genesis 1:1 end';
    const refs = scanText(text);
    expect(refs).toHaveLength(1);
    expect(text.slice(refs[0].start, refs[0].end)).toBe('Genesis 1:1');
  });
});
