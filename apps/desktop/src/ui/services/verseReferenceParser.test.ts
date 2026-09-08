import { describe, it, expect } from 'vitest';
import { parseReference } from './verseReferenceParser';

describe('verseReferenceParser - Roman numerals (KAN-18)', () => {
  it('should parse "i cor 1:2" as 1 Corinthians', () => {
    const ref = parseReference('i cor 1:2');
    expect(ref).not.toBeNull();
    expect(ref!.book).toBe(46);
    expect(ref!.bookName).toBe('1 Corinthians');
    expect(ref!.startChapter).toBe(1);
    expect(ref!.startVerse).toBe(2);
  });

  it('should parse "ii cor 5:17" as 2 Corinthians', () => {
    const ref = parseReference('ii cor 5:17');
    expect(ref).not.toBeNull();
    expect(ref!.book).toBe(47);
    expect(ref!.bookName).toBe('2 Corinthians');
  });

  it('should parse uppercase Roman numerals', () => {
    const ref = parseReference('I Cor 1:2');
    expect(ref).not.toBeNull();
    expect(ref!.book).toBe(46);
  });

  it('should parse "iii john 1:4" as 3 John', () => {
    const ref = parseReference('iii john 1:4');
    expect(ref).not.toBeNull();
    expect(ref!.book).toBe(64);
    expect(ref!.bookName).toBe('3 John');
  });
});
