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
