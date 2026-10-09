import { describe, expect, it } from 'vitest';
import { BOOK_NAMES, SHORT_BOOK_NAMES, formatRef, parseRef, toVerseId } from './verseId.js';

/**
 * Reading a reference a person wrote. This is the seam every authored file
 * comes through, so the rule it has to keep is not "accepts a lot" but "never
 * quietly returns the wrong verse": anything ambiguous comes back null and is
 * rejected by name at import time.
 */
describe('parseRef', () => {
  it('reads the long name', () => {
    expect(parseRef('John 3:16')).toBe(toVerseId(43, 3, 16));
  });

  it('reads a numbered book', () => {
    expect(parseRef('1 Corinthians 13:4')).toBe(toVerseId(46, 13, 4));
  });

  it('reads the short name', () => {
    expect(parseRef('1 Cor 13:4')).toBe(toVerseId(46, 13, 4));
  });

  it('ignores case, full stops and stray spaces', () => {
    expect(parseRef('  ps. 23 : 1 ')).toBe(toVerseId(19, 23, 1));
  });

  it('accepts a full stop between chapter and verse', () => {
    expect(parseRef('Romans 8.28')).toBe(toVerseId(45, 8, 28));
  });

  it('reads a name written without its space', () => {
    expect(parseRef('1John 4:8')).toBe(toVerseId(62, 4, 8));
  });

  it('reads the second name a book goes by', () => {
    expect(parseRef('Psalm 119:105')).toBe(toVerseId(19, 119, 105));
    expect(parseRef('Song of Songs 2:4')).toBe(toVerseId(22, 2, 4));
  });

  it('reads a lone number as a verse in a book with one chapter', () => {
    expect(parseRef('Jude 24')).toBe(toVerseId(65, 1, 24));
    expect(parseRef('3 John 4')).toBe(toVerseId(64, 1, 4));
  });

  it('refuses a lone number anywhere else, because that names a chapter', () => {
    expect(parseRef('1 John 3')).toBeNull();
    expect(parseRef('Psalms 23')).toBeNull();
  });

  it('refuses a book it does not know', () => {
    expect(parseRef('Hezekiah 3:16')).toBeNull();
    expect(parseRef('Enoch 1:9')).toBeNull();
  });

  it('refuses text with no numbers in it', () => {
    expect(parseRef('John')).toBeNull();
    expect(parseRef('')).toBeNull();
  });

  it('refuses a verse or chapter of zero', () => {
    expect(parseRef('John 0:16')).toBeNull();
    expect(parseRef('John 3:0')).toBeNull();
  });

  it('round-trips every long and short book name', () => {
    for (let book = 1; book <= BOOK_NAMES.length; book += 1) {
      const id = toVerseId(book, 1, 1);
      expect(parseRef(`${BOOK_NAMES[book - 1]} 1:1`)).toBe(id);
      expect(parseRef(`${SHORT_BOOK_NAMES[book - 1]} 1:1`)).toBe(id);
    }
  });

  it('reads back what formatRef prints, including single-chapter books', () => {
    for (const id of [toVerseId(43, 3, 16), toVerseId(65, 1, 24), toVerseId(19, 23, 1)]) {
      expect(parseRef(formatRef(id))).toBe(id);
    }
  });
});
