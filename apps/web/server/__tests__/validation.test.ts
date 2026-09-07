import { describe, it, expect } from 'vitest';
import {
  validateBookNumber,
  validateChapter,
  validateVerse,
  validateVerseId,
  validateModuleName,
  validateStrongsNumber,
  validateSearchQuery,
  MAX_SEARCH_QUERY_LENGTH,
} from '../utils/validation';

describe('validateBookNumber', () => {
  it('returns the number for valid book numbers 1-66', () => {
    expect(validateBookNumber('1')).toBe(1);
    expect(validateBookNumber('33')).toBe(33);
    expect(validateBookNumber('66')).toBe(66);
  });

  it('rejects 0 and negative numbers', () => {
    expect(validateBookNumber('0')).toBeNull();
    expect(validateBookNumber('-1')).toBeNull();
  });

  it('rejects numbers above 66', () => {
    expect(validateBookNumber('67')).toBeNull();
    expect(validateBookNumber('100')).toBeNull();
  });

  it('rejects non-integer values', () => {
    expect(validateBookNumber('1.5')).toBeNull();
    expect(validateBookNumber('3.14')).toBeNull();
  });

  it('rejects non-numeric strings', () => {
    expect(validateBookNumber('abc')).toBeNull();
    expect(validateBookNumber('')).toBeNull();
    expect(validateBookNumber('one')).toBeNull();
  });
});

describe('validateChapter', () => {
  it('returns the number for valid chapters 1-999', () => {
    expect(validateChapter('1')).toBe(1);
    expect(validateChapter('150')).toBe(150);
    expect(validateChapter('999')).toBe(999);
  });

  it('rejects 0 and negative numbers', () => {
    expect(validateChapter('0')).toBeNull();
    expect(validateChapter('-5')).toBeNull();
  });

  it('rejects numbers above 999', () => {
    expect(validateChapter('1000')).toBeNull();
  });

  it('rejects non-integer values', () => {
    expect(validateChapter('2.5')).toBeNull();
  });

  it('rejects non-numeric strings', () => {
    expect(validateChapter('abc')).toBeNull();
    expect(validateChapter('')).toBeNull();
  });
});

describe('validateVerse', () => {
  it('returns the number for valid verses 0-200', () => {
    expect(validateVerse('0')).toBe(0);
    expect(validateVerse('1')).toBe(1);
    expect(validateVerse('176')).toBe(176);
    expect(validateVerse('200')).toBe(200);
  });

  it('rejects negative numbers', () => {
    expect(validateVerse('-1')).toBeNull();
  });

  it('rejects numbers above 200', () => {
    expect(validateVerse('201')).toBeNull();
  });

  it('rejects non-integer values', () => {
    expect(validateVerse('1.5')).toBeNull();
  });

  it('rejects non-numeric strings', () => {
    expect(validateVerse('abc')).toBeNull();
  });
});

describe('validateVerseId', () => {
  it('returns the number for valid verse IDs', () => {
    expect(validateVerseId('1001001')).toBe(1001001);   // Genesis 1:1
    expect(validateVerseId('43003016')).toBe(43003016);  // John 3:16
    expect(validateVerseId('66022021')).toBe(66022021);  // Revelation 22:21
  });

  it('rejects IDs below the minimum (1001001)', () => {
    expect(validateVerseId('1001000')).toBeNull();
    expect(validateVerseId('0')).toBeNull();
    expect(validateVerseId('999999')).toBeNull();
  });

  it('rejects IDs above the maximum (66999999)', () => {
    expect(validateVerseId('67000000')).toBeNull();
    expect(validateVerseId('99999999')).toBeNull();
  });

  it('rejects non-integer values', () => {
    expect(validateVerseId('1001001.5')).toBeNull();
  });

  it('rejects non-numeric strings', () => {
    expect(validateVerseId('abc')).toBeNull();
    expect(validateVerseId('')).toBeNull();
  });
});

describe('validateModuleName', () => {
  it('accepts valid module names', () => {
    expect(validateModuleName('kjv')).toBe('kjv');
    expect(validateModuleName('bible_kjv')).toBe('bible_kjv');
    expect(validateModuleName('ESV-2016')).toBe('ESV-2016');
    expect(validateModuleName('ABC123')).toBe('ABC123');
  });

  it('rejects empty strings', () => {
    expect(validateModuleName('')).toBeNull();
  });

  it('rejects names longer than 100 characters', () => {
    expect(validateModuleName('a'.repeat(101))).toBeNull();
  });

  it('accepts names exactly 100 characters', () => {
    const name = 'a'.repeat(100);
    expect(validateModuleName(name)).toBe(name);
  });

  it('rejects path traversal attempts', () => {
    expect(validateModuleName('..')).toBeNull();
    expect(validateModuleName('a..b')).toBeNull();
  });

  it('rejects names with special characters', () => {
    expect(validateModuleName('module/name')).toBeNull();
    expect(validateModuleName('module name')).toBeNull();
    expect(validateModuleName('module.db')).toBeNull();
    expect(validateModuleName('../etc/passwd')).toBeNull();
  });
});

describe('validateStrongsNumber', () => {
  it('accepts valid Greek Strong\'s numbers', () => {
    expect(validateStrongsNumber('G2316')).toBe('G2316');
    expect(validateStrongsNumber('G1')).toBe('G1');
  });

  it('accepts valid Hebrew Strong\'s numbers', () => {
    expect(validateStrongsNumber('H1234')).toBe('H1234');
    expect(validateStrongsNumber('H1')).toBe('H1');
  });

  it('accepts valid Aramaic Strong\'s numbers', () => {
    expect(validateStrongsNumber('A1234')).toBe('A1234');
  });

  it('is case-insensitive', () => {
    expect(validateStrongsNumber('g2316')).toBe('g2316');
    expect(validateStrongsNumber('h1234')).toBe('h1234');
  });

  it('rejects empty strings', () => {
    expect(validateStrongsNumber('')).toBeNull();
  });

  it('rejects invalid prefixes', () => {
    expect(validateStrongsNumber('X1234')).toBeNull();
    expect(validateStrongsNumber('Z100')).toBeNull();
  });

  it('rejects numbers without prefix', () => {
    expect(validateStrongsNumber('1234')).toBeNull();
  });

  it('rejects prefix without number', () => {
    expect(validateStrongsNumber('G')).toBeNull();
    expect(validateStrongsNumber('H')).toBeNull();
  });

  it('rejects non-numeric suffixes', () => {
    expect(validateStrongsNumber('Gabc')).toBeNull();
    expect(validateStrongsNumber('G123a')).toBeNull();
  });
});

describe('validateSearchQuery', () => {
  it('returns the trimmed query for normal input', () => {
    expect(validateSearchQuery('love thy neighbour')).toBe('love thy neighbour');
    expect(validateSearchQuery('  faith  ')).toBe('faith');
  });

  it('rejects missing and non-string values', () => {
    expect(validateSearchQuery(undefined)).toBeNull();
    expect(validateSearchQuery(null)).toBeNull();
    expect(validateSearchQuery(42)).toBeNull();
    // Express gives an array when a param is repeated (?q=a&q=b)
    expect(validateSearchQuery(['a', 'b'])).toBeNull();
  });

  it('rejects empty and whitespace-only queries', () => {
    expect(validateSearchQuery('')).toBeNull();
    expect(validateSearchQuery('   ')).toBeNull();
  });

  it('accepts a query exactly at the length limit', () => {
    const atLimit = 'a'.repeat(MAX_SEARCH_QUERY_LENGTH);
    expect(validateSearchQuery(atLimit)).toBe(atLimit);
  });

  it('rejects an over-long query (O(n^2) attention guard)', () => {
    expect(validateSearchQuery('a'.repeat(MAX_SEARCH_QUERY_LENGTH + 1))).toBeNull();
    expect(validateSearchQuery('a'.repeat(15000))).toBeNull();
  });
});
