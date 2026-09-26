import { filterBooks, getBookFilterText, normalizeRomanPrefix, parseReference } from './bookReference';
import { NT_BOOKS, OT_BOOKS } from '@bible/core/browser';

const NAMES: Record<number, string> = { 1: 'Genesis', 19: 'Psalms', 43: 'John', 46: '1 Corinthians', 65: 'Jude', 62: '1 John', 63: '2 John' };
const bookName = (n: number) => NAMES[n] ?? '';
const lookup = { bookName, bookAliases: { gen: 1, ps: 19, jn: 43 } };

describe('parseReference', () => {
  it('parses chapter and verse', () => {
    expect(parseReference('John 3:16', lookup)).toEqual({ book: 43, chapter: 3, verse: 16, endVerse: undefined });
    expect(parseReference('  john 3 ', lookup)).toEqual({ book: 43, chapter: 3, verse: undefined, endVerse: undefined });
  });

  it('does not let books without a name (empty string) match every input', () => {
    expect(parseReference('zzz 3', lookup)).toBeNull();
    expect(parseReference('', lookup)).toBeNull();
    expect(parseReference('   ', lookup)).toBeNull();
  });

  it('prefers the longest name: "1 john 2" is 1 John, not John', () => {
    expect(parseReference('1 john 2', lookup)?.book).toBe(62);
    expect(parseReference('1john 2', lookup)?.book).toBe(62);
  });

  it('roman prefix and numbered book without a space', () => {
    expect(parseReference('ii john 1', lookup)?.book).toBe(63);
    expect(parseReference('1cor 13', lookup)).toMatchObject({ book: 46, chapter: 13 });
  });

  it('extended: ranges and single-chapter books', () => {
    expect(parseReference('John 3:16-18', lookup)).toMatchObject({ chapter: 3, verse: 16, endVerse: 18 });
    expect(parseReference('John 3:16–18', lookup)).toMatchObject({ endVerse: 18 });
    expect(parseReference('Jude 5', lookup)).toMatchObject({ book: 65, chapter: 1, verse: 5 });
    expect(parseReference('Jude 5-7', lookup)).toMatchObject({ book: 65, chapter: 1, verse: 5, endVerse: 7 });
    expect(parseReference('Jude 1:5', lookup)).toMatchObject({ chapter: 1, verse: 5 });
    expect(parseReference('John 3-5', lookup)).toEqual({ book: 43, chapter: 3, verse: undefined, endVerse: undefined });
  });

  it('basic: no ranges, "Jude 5" stays chapter 5', () => {
    const basic = { ...lookup, syntax: 'basic' as const };
    expect(parseReference('Jude 5', basic)).toEqual({ book: 65, chapter: 5, verse: undefined });
    expect(parseReference('John 3:16', basic)).toEqual({ book: 43, chapter: 3, verse: 16 });
    expect(parseReference('John 3:16-18', basic)).toBeNull();
  });

  it('bare book name means chapter 1', () => {
    expect(parseReference('psalms', lookup)).toEqual({ book: 19, chapter: 1 });
  });

  it('partial names: "psal 23" and "genes 1:1"', () => {
    expect(parseReference('psal 23', lookup)).toMatchObject({ book: 19, chapter: 23 });
    expect(parseReference('genes 1:1', lookup)).toMatchObject({ book: 1, chapter: 1, verse: 1 });
  });
});

describe('getBookFilterText / normalizeRomanPrefix', () => {
  it('strips trailing chapter:verse and ignores bare numbers', () => {
    expect(getBookFilterText('John 3:16')).toBe('John');
    expect(getBookFilterText('1 Cor 13')).toBe('1 Cor');
    expect(getBookFilterText('42')).toBe('');
    expect(getBookFilterText('grace')).toBe('grace');
    expect(getBookFilterText('   ')).toBe('');
  });

  it('maps i, ii, iii to digits only as a prefix', () => {
    expect(normalizeRomanPrefix('iii john')).toBe('3 john');
    expect(normalizeRomanPrefix('ii john')).toBe('2 john');
    expect(normalizeRomanPrefix('i cor')).toBe('1 cor');
    expect(normalizeRomanPrefix('isaiah')).toBe('isaiah');
  });
});

describe('filterBooks', () => {
  const all = [...OT_BOOKS, ...NT_BOOKS];
  it('returns everything for an empty filter', () => {
    expect(filterBooks(all, '', lookup)).toHaveLength(66);
  });
  it('matches prefix, alias and letter subsequence', () => {
    expect(filterBooks(all, 'gen', lookup)).toContain(1);
    expect(filterBooks(all, 'jn', lookup)).toContain(43);
    expect(filterBooks(all, 'gns', lookup)).toContain(1); // G-e-N-e-S-is: subsequence
  });
  it('is not confused by books without a name', () => {
    expect(filterBooks(all, 'zz', lookup)).toEqual([]);
  });
});
