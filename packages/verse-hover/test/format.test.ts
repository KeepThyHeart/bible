// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { decodeRef, encodeRef, linkFor, refText } from '../src/format';
import type { Ref } from '../src/types';

const r = (o: Partial<Ref>): Ref => ({ book: 43, chapter: 3, start: 0, end: 0, score: 100, ...o });

describe('ref ids', () => {
  const cases: [Partial<Ref>, string][] = [
    [{ verse: 16 }, '43003016'],
    [{ verse: 16, endVerse: 18 }, '43003016-43003018'],
    [{}, '43003'],
    [{ book: 1, chapter: 1 }, '1001'],
    [{ verse: 16, endChapter: 4, endVerse: 2 }, '43003016-43004002'],
    [{ book: 1, chapter: 1, endChapter: 3 }, '1001-1003'],
  ];
  for (const [o, id] of cases) it(id, () => {
    expect(encodeRef(r(o))).toBe(id);
    const d = decodeRef(id)!;
    expect(d.book).toBe(o.book ?? 43);
    expect(d.chapter).toBe(o.chapter ?? 3);
    expect(d.verse).toBe(o.verse);
    expect(d.endChapter).toBe(o.endChapter);
    expect(d.endVerse).toBe(o.endVerse);
  });
  it('rejects junk', () => {
    expect(decodeRef('abc')).toBeNull();
    expect(decodeRef('99003016')).toBeNull();
    expect(decodeRef('')).toBeNull();
  });
});

describe('refText', () => {
  it('formats', () => {
    expect(refText(r({ verse: 16 }), 'John')).toBe('John 3:16');
    expect(refText(r({ verse: 16, endVerse: 18 }), 'John')).toBe('John 3:16–18');
    expect(refText(r({}), 'John')).toBe('John 3');
    expect(refText(r({ verse: 16, endChapter: 4, endVerse: 2 }), 'John')).toBe('John 3:16–4:2');
  });
});

describe('linkFor', () => {
  it('fills and encodes placeholders', () => {
    expect(linkFor('https://x.test/{version}/{bookName}/{chapter}/{verse}', r({ verse: 16 }), 'K JV', 'Song of Solomon', 'x')).toBe('https://x.test/K%20JV/Song%20of%20Solomon/3/16');
  });
  it('accepts relative urls', () => {
    expect(linkFor('/read?b={book}', r({}), 'KJV', 'John', 'x')).toBe('/read?b=43');
  });
  it('rejects non-http schemes', () => {
    expect(linkFor('javascript:alert(1)', r({}), 'KJV', 'John', 'x')).toBeNull();
    expect(linkFor('data:text/html,{ref}', r({}), 'KJV', 'John', 'x')).toBeNull();
    expect(linkFor('{ref}', r({}), 'KJV', 'John', 'javascript:alert(1)')).toBe('javascript%3Aalert(1)');
  });
  it('is null without a template', () => expect(linkFor(undefined, r({}), 'KJV', 'John', 'x')).toBeNull());
});
