// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DatabaseManagerCatalog, MemoryVerseSource } from './DatabaseManagerCatalog.js';

const info = { abbreviation: 'KJV', fullName: 'King James', languageCode: 'en', copyright: null, licenseSpdx: 'PD', licenseUrl: null, canon: null, versification: null, moduleType: 'bible' };
const rows = [
  { verseId: 1001001, text: 'In the beginning God created the heaven and the earth.', wordCount: 10 },
  { verseId: 1001002, text: 'And the earth was without form, and void.', wordCount: 8 },
  { verseId: 19023001, text: 'The LORD is my shepherd; I shall not want.', wordCount: 9 },
  { verseId: 43003016, text: 'For God so loved the world.', wordCount: null },
  { verseId: 66022021, text: 'The grace of our Lord Jesus Christ be with you all. Amen.', wordCount: 12 },
];

describe('MemoryVerseSource', () => {
  const source = new MemoryVerseSource(info, [...rows].reverse());

  it('returns the stored text untouched, by id, list, range, chapter and book', () => {
    expect(source.verse(19023001)?.text).toBe('The LORD is my shepherd; I shall not want.');
    expect(source.verse(1)).toBeNull();
    expect(source.verses([66022021, 5, 1001001]).map((v) => v.id)).toEqual([66022021, 1001001]);
    expect(source.chapter(1, 1).map((v) => v.id)).toEqual([1001001, 1001002]);
    expect(source.book(43).map((v) => v.id)).toEqual([43003016]);
    expect(source.range(1001001, 19023001)).toHaveLength(3);
  });

  it('filters by book, section and minimum words, treating a missing count as 0', () => {
    expect(source.verseCount()).toBe(5);
    expect(source.verseCount({ books: [1] })).toBe(2);
    expect(source.verseCount({ sections: ['gospels'] })).toBe(1);
    expect(source.verseCount({ minWords: 9 })).toBe(3);
    expect(source.verseCount({ books: [99] })).toBe(5);
  });

  it('draws deterministically from a seeded generator and never repeats within a draw', () => {
    const seq = () => { let i = 0; const v = [0.0, 0.99, 0.5, 0.2]; return () => v[i++ % v.length] as number; };
    expect(source.randomVerse({}, seq())?.id).toBe(1001001);
    expect(source.randomVerse({ books: [99] }, () => 1)?.id).toBe(66022021);
    const drawn = source.randomVerses(4, {}, seq());
    expect(new Set(drawn.map((v) => v.id)).size).toBe(4);
    expect(source.randomVerses(10)).toHaveLength(5);
    expect(source.randomVerse({ books: [] , minWords: 99 })).toBeNull();
  });
});

describe('DatabaseManagerCatalog', () => {
  function db(visible = true) {
    return {
      getModuleMetadataRepo: () => ({ getByType: () => [{ abbreviation: 'KJV' }, { abbreviation: 'ZZZ' }] }),
      getBibleRepo: (a: string) => (a.toUpperCase() === 'KJV' && visible ? { getModuleInfo: () => ({ abbreviation: 'KJV', fullName: 'King James' }), getVerseCount: () => rows.length, getVerseRange: () => rows } : null),
    } as never;
  }

  it('lists installed Bibles that have verses, reading each once', () => {
    const catalog = new DatabaseManagerCatalog(db());
    expect(catalog.list().map((t) => [t.abbreviation, t.verseCount])).toEqual([['KJV', 5]]);
    expect(catalog.has('kjv')).toBe(true);
    expect(catalog.has('ZZZ')).toBe(false);
    expect(catalog.get('KJV')).toBe(catalog.get('kjv'));
  });

  it('honours site visibility and keeps the host repositories open on closeAll', () => {
    const hidden = new DatabaseManagerCatalog(db(), { isVisible: () => false });
    expect(hidden.list()).toEqual([]);
    expect(hidden.get('KJV')).toBeNull();
    const catalog = new DatabaseManagerCatalog(db());
    catalog.closeAll();
    expect(catalog.has('KJV')).toBe(true);
  });
});
