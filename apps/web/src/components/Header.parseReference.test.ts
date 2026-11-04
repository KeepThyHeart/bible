/**
 * Reference parsing for verse ranges.
 *
 * Typing "John 3:16-18" used to fall through the parser entirely — the tail
 * pattern was `^(\d+)(?::(\d+))?$`, with no branch for a range — so the header
 * treated it as free text and ran a full-text search for the reference itself.
 */
import { describe, it, expect } from 'vitest';
import { parseReference } from './Header';

describe('parseReference — verse ranges', () => {
  it('parses a range on a full book name', () => {
    expect(parseReference('John 3:16-18')).toMatchObject({
      book: 43, chapter: 3, verse: 16, endVerse: 18,
    });
  });

  it('parses a range on an abbreviation', () => {
    expect(parseReference('Rom 8:28-30')).toMatchObject({
      book: 45, chapter: 8, verse: 28, endVerse: 30,
    });
  });

  it('accepts en dashes and spaces around the separator', () => {
    expect(parseReference('John 3:16 – 18')).toMatchObject({ verse: 16, endVerse: 18 });
    expect(parseReference('John 3:16 - 18')).toMatchObject({ verse: 16, endVerse: 18 });
  });

  it('still parses a single verse, with no range', () => {
    const ref = parseReference('John 3:16');
    expect(ref).toMatchObject({ book: 43, chapter: 3, verse: 16 });
    expect(ref?.endVerse).toBeUndefined();
  });

  it('still parses a bare chapter', () => {
    const ref = parseReference('John 3');
    expect(ref).toMatchObject({ book: 43, chapter: 3 });
    expect(ref?.verse).toBeUndefined();
    expect(ref?.endVerse).toBeUndefined();
  });

  it('parses a range through a fuzzy book-name match', () => {
    // "jonh" is the typo case the fuzzy matcher exists for.
    expect(parseReference('jonh 3:16-18')).toMatchObject({
      book: 43, chapter: 3, verse: 16, endVerse: 18, fuzzyMatch: true,
    });
  });

  it('returns null for input that is not a reference', () => {
    expect(parseReference('love your enemies')).toBeNull();
  });
});

// W-023 / W-032: fuzzy matching, chapter range, single-chapter books.
describe('parseReference — W-023 / W-032 validation', () => {
  it('does not fuzzy-match common words onto books', () => {
    for (const q of ['love 1', 'hope 3', 'life 1', 'paul 2', 'seal 7', 'law 10', 'joy 1', 'lord 1', 'word 1']) {
      expect(parseReference(q), q).toBeNull();
    }
  });

  it('still fuzzy-matches a real typo and keeps abbreviations', () => {
    expect(parseReference('jonh 3:16')).toMatchObject({ book: 43, chapter: 3, verse: 16, fuzzyMatch: true });
    expect(parseReference('Ps 23')).toMatchObject({ book: 19, chapter: 23 });
    expect(parseReference('Jn 3')).toMatchObject({ book: 43, chapter: 3 });
    expect(parseReference('1 Jn 2')).toMatchObject({ book: 62, chapter: 2 });
    expect(parseReference('Gen 1')).toMatchObject({ book: 1, chapter: 1 });
    expect(parseReference('Song 2')).toMatchObject({ book: 22, chapter: 2 });
    expect(parseReference('SoS 2')).toMatchObject({ book: 22, chapter: 2 });
    expect(parseReference('1 John 4')).toMatchObject({ book: 62, chapter: 4 });
  });

  it('returns null for a chapter or book that does not exist', () => {
    expect(parseReference('John 99')).toBeNull();
    expect(parseReference('John 0')).toBeNull();
    expect(parseReference('Matthew 0')).toBeNull();
    expect(parseReference('99 1')).toBeNull();
    expect(parseReference('67 1')).toBeNull();
    expect(parseReference('John 22')).toBeNull();
    expect(parseReference('John 21')).toMatchObject({ book: 43, chapter: 21 });
  });

  it('keeps clamping a too-large verse downstream (no verse check here)', () => {
    expect(parseReference('Gen 1:99')).toMatchObject({ book: 1, chapter: 1, verse: 99 });
  });

  it('maps "Book N" in a single-chapter book to chapter 1 verse N', () => {
    expect(parseReference('Obadiah 3')).toMatchObject({ book: 31, chapter: 1, verse: 3 });
    expect(parseReference('Jude 3')).toMatchObject({ book: 65, chapter: 1, verse: 3 });
    expect(parseReference('Philemon 5')).toMatchObject({ book: 57, chapter: 1, verse: 5 });
    expect(parseReference('Jude 5-7')).toMatchObject({ book: 65, chapter: 1, verse: 5, endVerse: 7 });
    expect(parseReference('Jude 1:5')).toMatchObject({ book: 65, chapter: 1, verse: 5 });
    expect(parseReference('Jude')).toMatchObject({ book: 65, chapter: 1 });
  });
});
