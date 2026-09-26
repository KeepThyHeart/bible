import { describe, it, expect } from 'vitest';
import { normalizeInput, parseReferenceInput, splitReferenceInput, suggestBooks } from './referenceInput';

const ok = (text: string, locale = 'en', opts = {}) => {
  const r = parseReferenceInput(text, locale, opts);
  if (!r.ok) throw new Error(`expected "${text}" to parse`);
  return r.value;
};

describe('normalizeInput', () => {
  it('maps Unicode digits, full-width colon and dashes, collapses whitespace', () => {
    expect(normalizeInput('John ٣：١٦')).toBe('John 3:16');
    expect(normalizeInput('John ३:१६')).toBe('John 3:16');
    expect(normalizeInput('John １２：３')).toBe('John 12:3');
    expect(normalizeInput('  John   3:16')).toBe('John 3:16');
    expect(normalizeInput('John 3:16–18')).toBe('John 3:16-18');
    expect(normalizeInput('John 3:16−18')).toBe('John 3:16-18');
  });
});

describe('splitReferenceInput', () => {
  it('splits book text from numbers with or without a space', () => {
    expect(splitReferenceInput('John 3:16')).toEqual({ bookPart: 'John', numPart: '3:16' });
    expect(splitReferenceInput('1John3:16')).toEqual({ bookPart: '1John', numPart: '3:16' });
    expect(splitReferenceInput('约翰福音3:16')).toEqual({ bookPart: '约翰福音', numPart: '3:16' });
    expect(splitReferenceInput('1 John')).toEqual({ bookPart: '1 John' });
    expect(splitReferenceInput('')).toBeNull();
    expect(splitReferenceInput('3')).toBeNull();
  });
});

describe('parseReferenceInput', () => {
  it('parses a verse', () => {
    expect(ok('John 3:16')).toEqual({ verseId: 43003016, ref: 'John 3:16' });
  });
  it('parses a same-chapter range', () => {
    expect(ok('John 3:16-18')).toEqual({ verseId: 43003016, endVerseId: 43003018, ref: 'John 3:16-18' });
  });
  it('parses a cross-chapter range', () => {
    expect(ok('John 3:16-4:2')).toEqual({ verseId: 43003016, endVerseId: 43004002, ref: 'John 3:16-4:2' });
  });
  it('treats a lone range end equal to the start as a single verse', () => {
    expect(ok('John 3:16-16')).toEqual({ verseId: 43003016, ref: 'John 3:16' });
  });
  it('parses a whole chapter', () => {
    expect(ok('John 3')).toEqual({ verseId: 43003001, ref: 'John 3', wholeChapter: true });
  });
  it('reads single-chapter books as verses of chapter 1', () => {
    expect(ok('Jude 5').verseId).toBe(65001005);
    expect(ok('Jude 5').wholeChapter).toBeUndefined();
    expect(ok('Jude 5-7')).toMatchObject({ verseId: 65001005, endVerseId: 65001007 });
    expect(ok('Jude 1:5').verseId).toBe(65001005);
  });
  it('accepts aliases, numbered books and fuzzy spellings', () => {
    expect(ok('Joh 3:16').verseId).toBe(43003016);
    expect(ok('1 Cor 13:4').verseId).toBe(46013004);
    expect(ok('1John3:16').verseId).toBe(62003016);
    const fuzzy = parseReferenceInput('Jhon 3:16');
    expect(fuzzy).toMatchObject({ ok: true, fuzzy: true, value: { verseId: 43003016 } });
  });
  it('rejects invalid input', () => {
    for (const bad of ['John 22:1', 'John 3:18-16', 'John 3-5', 'Foo 1:1', '', 'John', 'John 3:', 'John 0:1', 'John 3:0', 'John 3:1-4:0']) {
      expect(parseReferenceInput(bad).ok, bad).toBe(false);
    }
  });
  it('honours noRanges and noWholeChapter', () => {
    expect(parseReferenceInput('John 3:16-18', 'en', { noRanges: true }).ok).toBe(false);
    expect(parseReferenceInput('John 3:16', 'en', { noRanges: true }).ok).toBe(true);
    expect(parseReferenceInput('John 3', 'en', { noWholeChapter: true }).ok).toBe(false);
  });
  it('formats in the locale (es) and accepts English input under it', () => {
    expect(ok('Juan 3:16', 'es').ref).toBe('Juan 3:16');
    expect(ok('John 3:16', 'es').ref).toBe('Juan 3:16');
    expect(ok('Génesis 1:1', 'es').verseId).toBe(1001001);
  });
  it('parses Chinese book names with and without a space', () => {
    expect(ok('约翰福音 3:16', 'zh-Hans').verseId).toBe(43003016);
    expect(ok('约翰福音3:16', 'zh-Hans').verseId).toBe(43003016);
  });
  it('parses Arabic-Indic digits', () => {
    expect(ok('John ٣:١٦').verseId).toBe(43003016);
  });
  it('falls back to English for a locale without a book table', () => {
    expect(ok('John 3:16', 'fr').ref).toBe('John 3:16');
  });
});

describe('suggestBooks', () => {
  const names = (t: string, locale = 'en', max = 8) => suggestBooks(t, locale, max).map((s) => s.name);
  it('ranks display-name prefixes, then aliases, then inner words', () => {
    expect(names('Jo')).toEqual(['Joshua', 'Job', 'Joel', 'Jonah', 'John', '1 John', '2 John', '3 John']);
  });
  it('honours max', () => {
    expect(names('Jo', 'en', 3)).toEqual(['Joshua', 'Job', 'Joel']);
  });
  it('matches numbered books by number prefix', () => {
    expect(names('1 jo')).toEqual(['1 John']);
  });
  it('gives none for empty input, numbers or no match', () => {
    expect(names('')).toEqual([]);
    expect(names('John 3')).toEqual([]);
    expect(names('zzz')).toEqual([]);
  });
  it('folds case and diacritics in the locale', () => {
    expect(names('genes', 'es')).toEqual(['Génesis']);
  });
  it('returns localized names', () => {
    expect(names('jua', 'es')).toContain('Juan');
  });
});
