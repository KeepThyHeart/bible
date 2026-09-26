import { describe, it, expect } from 'vitest';
import { BOOK_COUNT, MAX_CHAPTERS, OT_BOOKS, NT_BOOKS, isSingleChapterBook } from './BookNames';

describe('MAX_CHAPTERS', () => {
  it('covers exactly books 1-66', () => {
    expect(Object.keys(MAX_CHAPTERS).map(Number)).toEqual(Array.from({ length: BOOK_COUNT }, (_, i) => i + 1));
  });

  it('adds up to the 1,189 chapters of the standard Protestant canon', () => {
    expect(Object.values(MAX_CHAPTERS).reduce((a, b) => a + b, 0)).toBe(1189);
  });

  it('matches known anchors', () => {
    expect(MAX_CHAPTERS[1]).toBe(50); // Genesis
    expect(MAX_CHAPTERS[19]).toBe(150); // Psalms
    expect(MAX_CHAPTERS[43]).toBe(21); // John
    expect(MAX_CHAPTERS[66]).toBe(22); // Revelation
  });

  it('agrees with isSingleChapterBook for every book', () => {
    for (let book = 1; book <= BOOK_COUNT; book++) {
      expect(MAX_CHAPTERS[book] === 1).toBe(isSingleChapterBook(book));
    }
  });
});

describe('OT_BOOKS / NT_BOOKS', () => {
  it('split the 66 books at Malachi / Matthew', () => {
    expect(OT_BOOKS).toHaveLength(39);
    expect(NT_BOOKS).toHaveLength(27);
    expect(OT_BOOKS[0]).toBe(1);
    expect(OT_BOOKS[38]).toBe(39);
    expect(NT_BOOKS[0]).toBe(40);
    expect(NT_BOOKS[26]).toBe(66);
    expect([...OT_BOOKS, ...NT_BOOKS]).toEqual(Array.from({ length: BOOK_COUNT }, (_, i) => i + 1));
  });
});
