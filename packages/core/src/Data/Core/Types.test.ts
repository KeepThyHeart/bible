import { describe, it, expect } from 'vitest';
import {
  Book, VerseIdHelper,
  MODULE_TYPES, DICTIONARY_TYPES, NOTE_TYPES, ITEM_TYPES, PLAN_TYPES,
  SEARCH_TYPES, LINK_TYPES, SOURCE_TYPES, ENTRY_LEVELS, RELATIONSHIP_TYPES,
  isModuleType, isDictionaryType, isNoteType, isItemType, isPlanType,
  isSearchType, isLinkType, isSourceType, isEntryLevel, isRelationshipType,
  assertNoteType, assertLinkType, assertRelationshipType,
  InvalidEnumValueError, resolveRangeEnd
} from './Types';

describe('Book Enum', () => {
  it('should have correct values for key books', () => {
    expect(Book.Genesis).toBe(1);
    expect(Book.Exodus).toBe(2);
    expect(Book.Psalms).toBe(19);
    expect(Book.Matthew).toBe(40);
    expect(Book.John).toBe(43);
    expect(Book.Romans).toBe(45);
    expect(Book.Revelation).toBe(66);
  });

  it('should have all 66 books', () => {
    const bookNumbers = Object.values(Book).filter(v => typeof v === 'number') as number[];
    expect(bookNumbers.length).toBe(66);
    expect(Math.max(...bookNumbers)).toBe(66);
    expect(Math.min(...bookNumbers)).toBe(1);
  });

  it('should support both Samuel books correctly', () => {
    expect(Book.FirstSamuel).toBe(9);
    expect(Book.SecondSamuel).toBe(10);
  });

  it('should support both Kings books correctly', () => {
    expect(Book.FirstKings).toBe(11);
    expect(Book.SecondKings).toBe(12);
  });
});

describe('VerseIdHelper.calculate', () => {
  it('should calculate verse ID using book number', () => {
    // John 3:16 = 43003016
    const verseId = VerseIdHelper.calculate(43, 3, 16);
    expect(verseId).toBe(43003016);
  });

  it('should calculate verse ID using Book enum', () => {
    // John 3:16 = 43003016
    const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
    expect(verseId).toBe(43003016);
  });

  it('should calculate Genesis 1:1', () => {
    const verseId = VerseIdHelper.calculate(Book.Genesis, 1, 1);
    expect(verseId).toBe(1001001);
  });

  it('should calculate Revelation 22:21 (last verse in Bible)', () => {
    const verseId = VerseIdHelper.calculate(Book.Revelation, 22, 21);
    expect(verseId).toBe(66022021);
  });

  it('should handle Psalm 119:176 (longest chapter)', () => {
    const verseId = VerseIdHelper.calculate(Book.Psalms, 119, 176);
    expect(verseId).toBe(19119176);
  });

  it('should handle Romans 8:28', () => {
    const verseId = VerseIdHelper.calculate(Book.Romans, 8, 28);
    expect(verseId).toBe(45008028);
  });
});

describe('VerseIdHelper.parse', () => {
  it('should parse John 3:16 correctly', () => {
    const parsed = VerseIdHelper.parse(43003016);
    expect(parsed).toEqual({
      bookNumber: 43,
      chapter: 3,
      verse: 16
    });
  });

  it('should parse Genesis 1:1 correctly', () => {
    const parsed = VerseIdHelper.parse(1001001);
    expect(parsed).toEqual({
      bookNumber: 1,
      chapter: 1,
      verse: 1
    });
  });

  it('should parse Revelation 22:21 correctly', () => {
    const parsed = VerseIdHelper.parse(66022021);
    expect(parsed).toEqual({
      bookNumber: 66,
      chapter: 22,
      verse: 21
    });
  });

  it('should parse Psalm 119:176 correctly', () => {
    const parsed = VerseIdHelper.parse(19119176);
    expect(parsed).toEqual({
      bookNumber: 19,
      chapter: 119,
      verse: 176
    });
  });

  it('should round-trip correctly', () => {
    const original = VerseIdHelper.calculate(Book.Romans, 8, 28);
    const parsed = VerseIdHelper.parse(original);
    const recalculated = VerseIdHelper.calculate(parsed.bookNumber, parsed.chapter, parsed.verse);
    expect(recalculated).toBe(original);
  });
});

describe('VerseIdHelper.format', () => {
  it('should format John 3:16 as string', () => {
    const formatted = VerseIdHelper.format(43003016);
    expect(formatted).toBe('43:3:16');
  });

  it('should format Genesis 1:1 as string', () => {
    const formatted = VerseIdHelper.format(1001001);
    expect(formatted).toBe('1:1:1');
  });

  it('should format Revelation 22:21 as string', () => {
    const formatted = VerseIdHelper.format(66022021);
    expect(formatted).toBe('66:22:21');
  });
});

describe('VerseIdHelper.isValid', () => {
  it('should return true for valid verse IDs', () => {
    expect(VerseIdHelper.isValid(1001001)).toBe(true);      // Genesis 1:1
    expect(VerseIdHelper.isValid(43003016)).toBe(true);     // John 3:16
    expect(VerseIdHelper.isValid(66022021)).toBe(true);     // Revelation 22:21
    expect(VerseIdHelper.isValid(19119176)).toBe(true);     // Psalm 119:176
  });

  it('should return false for invalid book numbers', () => {
    expect(VerseIdHelper.isValid(1001)).toBe(false);        // Book 0
    expect(VerseIdHelper.isValid(67001001)).toBe(false);    // Book 67 (doesn't exist)
    expect(VerseIdHelper.isValid(100001001)).toBe(false);   // Book 100
  });

  it('should return false for invalid chapters', () => {
    expect(VerseIdHelper.isValid(43000001)).toBe(false);    // Chapter 0
  });

  it('should return false for invalid verses', () => {
    expect(VerseIdHelper.isValid(43003000)).toBe(false);    // Verse 0
  });

  it('should validate edge cases', () => {
    expect(VerseIdHelper.isValid(1001001)).toBe(true);      // First verse
    expect(VerseIdHelper.isValid(66999999)).toBe(true);     // Last book, max chapter/verse
  });
});

describe('VerseIdHelper.getChapterRange', () => {
  it('should get range for John 3 using book number', () => {
    const range = VerseIdHelper.getChapterRange(43, 3);
    expect(range).toEqual({
      startVerseId: 43003001,
      endVerseId: 43003999
    });
  });

  it('should get range for John 3 using Book enum', () => {
    const range = VerseIdHelper.getChapterRange(Book.John, 3);
    expect(range).toEqual({
      startVerseId: 43003001,
      endVerseId: 43003999
    });
  });

  it('should get range for Genesis 1', () => {
    const range = VerseIdHelper.getChapterRange(Book.Genesis, 1);
    expect(range).toEqual({
      startVerseId: 1001001,
      endVerseId: 1001999
    });
  });

  it('should get range for Revelation 22', () => {
    const range = VerseIdHelper.getChapterRange(Book.Revelation, 22);
    expect(range).toEqual({
      startVerseId: 66022001,
      endVerseId: 66022999
    });
  });

  it('should get range for Psalm 119 (longest chapter)', () => {
    const range = VerseIdHelper.getChapterRange(Book.Psalms, 119);
    expect(range).toEqual({
      startVerseId: 19119001,
      endVerseId: 19119999
    });
  });
});

describe('VerseIdHelper.getBookName', () => {
  it('should return book name for Book enum value', () => {
    expect(VerseIdHelper.getBookName(Book.Genesis)).toBe('Genesis');
    expect(VerseIdHelper.getBookName(Book.John)).toBe('John');
    expect(VerseIdHelper.getBookName(Book.Revelation)).toBe('Revelation');
  });

  it('should return book name for compound names', () => {
    expect(VerseIdHelper.getBookName(Book.FirstSamuel)).toBe('FirstSamuel');
    expect(VerseIdHelper.getBookName(Book.SecondKings)).toBe('SecondKings');
    expect(VerseIdHelper.getBookName(Book.SongOfSolomon)).toBe('SongOfSolomon');
  });

  it('should return book names for all testaments', () => {
    expect(VerseIdHelper.getBookName(Book.Psalms)).toBe('Psalms');      // OT
    expect(VerseIdHelper.getBookName(Book.Matthew)).toBe('Matthew');    // NT
    expect(VerseIdHelper.getBookName(Book.Romans)).toBe('Romans');      // NT Epistles
  });
});

describe('VerseIdHelper.getBookEnum', () => {
  it('should return Book enum for valid book numbers', () => {
    expect(VerseIdHelper.getBookEnum(1)).toBe(Book.Genesis);
    expect(VerseIdHelper.getBookEnum(43)).toBe(Book.John);
    expect(VerseIdHelper.getBookEnum(66)).toBe(Book.Revelation);
  });

  it('should return Book enum for all valid numbers 1-66', () => {
    for (let i = 1; i <= 66; i++) {
      const bookEnum = VerseIdHelper.getBookEnum(i);
      expect(bookEnum).toBe(i);
      expect(bookEnum).toBeDefined();
    }
  });

  it('should return undefined for invalid book numbers', () => {
    expect(VerseIdHelper.getBookEnum(0)).toBeUndefined();
    expect(VerseIdHelper.getBookEnum(67)).toBeUndefined();
    expect(VerseIdHelper.getBookEnum(100)).toBeUndefined();
    expect(VerseIdHelper.getBookEnum(-1)).toBeUndefined();
  });
});

describe('Integration Tests', () => {
  it('should work seamlessly between Book enum and numbers', () => {
    // Calculate using enum
    const idFromEnum = VerseIdHelper.calculate(Book.John, 3, 16);

    // Calculate using number
    const idFromNumber = VerseIdHelper.calculate(43, 3, 16);

    // Should be identical
    expect(idFromEnum).toBe(idFromNumber);
    expect(idFromEnum).toBe(43003016);
  });

  it('should convert between book number and enum', () => {
    const bookNumber = 43;
    const bookEnum = VerseIdHelper.getBookEnum(bookNumber);
    expect(bookEnum).toBe(Book.John);

    const bookName = VerseIdHelper.getBookName(bookEnum!);
    expect(bookName).toBe('John');
  });

  it('should handle complete workflow: enum -> ID -> parse -> enum', () => {
    // Start with Book enum
    const originalBook = Book.Romans;

    // Calculate verse ID
    const verseId = VerseIdHelper.calculate(originalBook, 8, 28);
    expect(verseId).toBe(45008028);

    // Parse it back
    const parsed = VerseIdHelper.parse(verseId);
    expect(parsed.bookNumber).toBe(45);
    expect(parsed.chapter).toBe(8);
    expect(parsed.verse).toBe(28);

    // Convert back to enum
    const recoveredBook = VerseIdHelper.getBookEnum(parsed.bookNumber);
    expect(recoveredBook).toBe(originalBook);
    expect(recoveredBook).toBe(Book.Romans);
  });
});

// ============================================================================
// Open enums - single source of truth
// ============================================================================

describe('open enum validators', () => {
  it('recognises tag_graph as a module type', () => {
    expect(isModuleType('tag_graph')).toBe(true);
    expect(MODULE_TYPES).toContain('tag_graph');
  });

  it('rejects app-private cache databases as module types', () => {
    // semantic_*.db and enrichments_*.db are deliberately outside the module
    // contract - they must never validate as modules.
    expect(isModuleType('semantic')).toBe(false);
    expect(isModuleType('enrichments')).toBe(false);
  });

  it('accepts every documented value of each closed union', () => {
    expect(MODULE_TYPES.every(v => isModuleType(v))).toBe(true);
    expect(DICTIONARY_TYPES.every(v => isDictionaryType(v))).toBe(true);
    expect(NOTE_TYPES.every(v => isNoteType(v))).toBe(true);
    expect(ITEM_TYPES.every(v => isItemType(v))).toBe(true);
    expect(PLAN_TYPES.every(v => isPlanType(v))).toBe(true);
    expect(SEARCH_TYPES.every(v => isSearchType(v))).toBe(true);
    expect(LINK_TYPES.every(v => isLinkType(v))).toBe(true);
    expect(SOURCE_TYPES.every(v => isSourceType(v))).toBe(true);
    expect(ENTRY_LEVELS.every(v => isEntryLevel(v))).toBe(true);
  });

  it('throws a descriptive InvalidEnumValueError on assert', () => {
    expect(() => assertNoteType('scribble')).toThrow(InvalidEnumValueError);
    expect(() => assertNoteType('scribble')).toThrow(/note_type/);
    try {
      assertLinkType('sideways');
      expect.unreachable('assertLinkType should have thrown');
    } catch (error) {
      const err = error as InvalidEnumValueError;
      expect(err.enumName).toBe('link_type');
      expect(err.value).toBe('sideways');
      expect(err.allowed).toContain('cross_reference');
    }
  });

  it('rejects non-string values', () => {
    expect(isModuleType(undefined)).toBe(false);
    expect(isModuleType(null)).toBe(false);
    expect(isModuleType(7)).toBe(false);
  });

  it('treats relationship_type as an open set of well-formed tokens', () => {
    expect(RELATIONSHIP_TYPES.every(v => isRelationshipType(v))).toBe(true);
    // Extensible: a publisher may introduce a new relationship without a schema change.
    expect(isRelationshipType('fulfils_type_of')).toBe(true);
    // Still shape-checked.
    expect(isRelationshipType('Parallel')).toBe(false);
    expect(isRelationshipType('two words')).toBe(false);
    expect(isRelationshipType('')).toBe(false);
    expect(() => assertRelationshipType('NotSnakeCase')).toThrow(/relationship_type/);
  });

  it("includes v2's cross_reference link type and the new source types", () => {
    expect(isLinkType('cross_reference')).toBe(true);
    expect(isSourceType('verse')).toBe(true);
    expect(isSourceType('cross_reference_group')).toBe(true);
    expect(isSourceType('entity_facet')).toBe(true);
  });
});

describe('range convention helper', () => {
  it('treats a null/undefined end as a single verse', () => {
    expect(resolveRangeEnd(43003016, null)).toBe(43003016);
    expect(resolveRangeEnd(43003016, undefined)).toBe(43003016);
  });

  it('passes a concrete end through unchanged', () => {
    expect(resolveRangeEnd(43003016, 43003018)).toBe(43003018);
  });
});
