import { describe, expect, it } from 'vitest';
import { parseBooks, parseChapters, selectChapters, SelectionError } from './selection';

const avail = new Map<number, number[]>([[19, [1, 2, 3, 4, 5]], [43, [1, 2, 3]], [63, [1]]]);

describe('--books / --chapters parsing', () => {
  it('reads USFM codes, numbers and English names', () => {
    expect(parseBooks('JHN,19,2 John')).toEqual([43, 19, 63]);
    expect(parseBooks('jhn,JHN')).toEqual([43]);
  });
  it('reads chapters, ranges and whole books', () => {
    expect(parseChapters('JHN.3,PSA.2-4,2JN')).toEqual([
      { book: 43, chapters: [3] },
      { book: 19, chapters: [2, 3, 4] },
      { book: 63, chapters: 'all' },
    ]);
  });
  it('rejects nonsense', () => {
    expect(() => parseBooks('XXX')).toThrow(SelectionError);
    expect(() => parseBooks('67')).toThrow(SelectionError);
    expect(() => parseChapters('JHN.x')).toThrow(SelectionError);
    expect(() => parseChapters('JHN.5-3')).toThrow(SelectionError);
    expect(() => parseChapters('JHN.0')).toThrow(SelectionError);
  });
});

describe('selectChapters', () => {
  it('everything by default, in canonical order', () => {
    expect(selectChapters(avail, {}).map(c => `${c.book}.${c.chapter}`)).toEqual(['19.1', '19.2', '19.3', '19.4', '19.5', '43.1', '43.2', '43.3', '63.1']);
  });
  it('a book list gives all chapters of those books', () => {
    expect(selectChapters(avail, { books: 'JHN' }).map(c => c.chapter)).toEqual([1, 2, 3]);
  });
  it('chapters are sorted and de-duplicated', () => {
    expect(selectChapters(avail, { chapters: 'JHN.3,PSA.2,PSA.2-3,JHN.3' }).map(c => `${c.book}.${c.chapter}`)).toEqual(['19.2', '19.3', '43.3']);
  });
  it('a chapter or book the module lacks is an error, not a silent skip', () => {
    expect(() => selectChapters(avail, { chapters: 'PSA.23' })).toThrow(/no Psalms chapter 23/);
    expect(() => selectChapters(avail, { books: 'GEN' })).toThrow(/no Genesis/);
  });
  it('rejects both options together', () => {
    expect(() => selectChapters(avail, { books: 'JHN', chapters: 'JHN.3' })).toThrow(SelectionError);
  });
});
