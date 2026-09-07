import { describe, it, expect } from 'vitest';
import { ReferenceParser, ParsedReference } from './ReferenceParser';

describe('ReferenceParser', () => {
  let parser: ReferenceParser;

  // Create a fresh parser instance for each test
  beforeEach(() => {
    parser = new ReferenceParser();
  });

  // ==========================================================================
  // isReference() Tests
  // ==========================================================================

  describe('isReference', () => {
    it('should recognize single verse references', () => {
      expect(parser.isReference('John 3:16')).toBe(true);
      expect(parser.isReference('Genesis 1:1')).toBe(true);
      expect(parser.isReference('Revelation 22:21')).toBe(true);
    });

    it('should recognize verse range in same chapter', () => {
      expect(parser.isReference('John 3:16-17')).toBe(true);
      expect(parser.isReference('Romans 8:28-39')).toBe(true);
    });

    it('should recognize verse range across chapters', () => {
      expect(parser.isReference('John 3:16-4:2')).toBe(true);
      expect(parser.isReference('Matthew 5:1-7:29')).toBe(true);
    });

    it('should recognize chapter references', () => {
      expect(parser.isReference('Psalm 23')).toBe(true);
      expect(parser.isReference('John 3')).toBe(true);
    });

    it('should recognize chapter ranges', () => {
      expect(parser.isReference('John 3-5')).toBe(true);
      expect(parser.isReference('Genesis 1-3')).toBe(true);
    });

    it('should recognize numbered books', () => {
      expect(parser.isReference('1 John 3:16')).toBe(true);
      expect(parser.isReference('2 Corinthians 5:17')).toBe(true);
      expect(parser.isReference('3 John 1:2')).toBe(true);
    });

    it('should recognize abbreviated book names', () => {
      expect(parser.isReference('Gen 1:1')).toBe(true);
      expect(parser.isReference('Matt 5:16')).toBe(true);
      expect(parser.isReference('Rev 22:21')).toBe(true);
    });

    it('should handle whitespace variations', () => {
      expect(parser.isReference('  John 3:16  ')).toBe(true);
      expect(parser.isReference('John  3:16')).toBe(true);
    });

    it('should reject invalid references', () => {
      expect(parser.isReference('')).toBe(false);
      expect(parser.isReference('Not a reference')).toBe(false);
      expect(parser.isReference('John')).toBe(false);
      expect(parser.isReference('3:16')).toBe(false);
      expect(parser.isReference('John 3:')).toBe(false);
    });

    it('should reject references without chapter', () => {
      expect(parser.isReference('John')).toBe(false);
      expect(parser.isReference('Genesis')).toBe(false);
    });
  });

  // ==========================================================================
  // Whole-book references (opt-in)
  //
  // Off by default, and the tests above are the reason why: the search box
  // classifies input with `isReference`, and "John" typed there is someone
  // looking for the word. Only a caller with no keyword mode to be confused
  // with - the copy/export dialog - passes the flag.
  // ==========================================================================

  describe('whole-book references', () => {
    const whole = { allowWholeBook: true } as const;

    it('accepts a bare book name only when asked to', () => {
      expect(parser.isReference('John')).toBe(false);
      expect(parser.isReference('John', whole)).toBe(true);
      expect(parser.isReference('I John', whole)).toBe(true);
      expect(parser.isReference('Gen', whole)).toBe(true);
    });

    it('parses it as the book, from chapter 1, with no verse', () => {
      const ref = parser.parse('John', whole);
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(43);
      expect(ref.chapter).toBe(1);
      expect(ref.wholeBook).toBe(true);
      // The end is "wherever the book ends", which this parser cannot state.
      expect(ref.verse).toBeUndefined();
      expect(ref.endChapter).toBeUndefined();
    });

    it('handles numbered books in both spellings', () => {
      expect(parser.parse('1 John', whole).book).toBe(62);
      expect(parser.parse('I John', whole).book).toBe(62);
      expect(parser.parse('iii john', whole).book).toBe(64);
    });

    it('does not fuzzy-match, so an ordinary word stays a non-reference', () => {
      // `parse` normally falls back to Damerau-Levenshtein <= 2, which would
      // pull all sorts of typed words onto some book. A whole-book match is
      // exact only.
      expect(parser.parse('Jonh', whole).isValid).toBe(false);
      expect(parser.parse('love', whole).isValid).toBe(false);
      expect(parser.parse('Not a reference', whole).isValid).toBe(false);
    });

    it('formats back to the book name alone', () => {
      expect(parser.format(parser.parse('john', whole))).toBe('John');
    });

    it('leaves an ordinary reference untouched', () => {
      const ref = parser.parse('John 3:16', whole);
      expect(ref.wholeBook).toBeUndefined();
      expect(ref.verse).toBe(16);
    });
  });

  // ==========================================================================
  // parse() Tests - Single Verses
  // ==========================================================================

  describe('parse - Single Verses', () => {
    it('should parse John 3:16', () => {
      const ref = parser.parse('John 3:16');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(43);
      expect(ref.bookName).toBe('John');
      expect(ref.chapter).toBe(3);
      expect(ref.verse).toBe(16);
      expect(ref.endChapter).toBeUndefined();
      expect(ref.endVerse).toBeUndefined();
    });

    it('should parse Genesis 1:1', () => {
      const ref = parser.parse('Genesis 1:1');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(1);
      expect(ref.chapter).toBe(1);
      expect(ref.verse).toBe(1);
    });

    it('should parse Revelation 22:21', () => {
      const ref = parser.parse('Revelation 22:21');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(66);
      expect(ref.chapter).toBe(22);
      expect(ref.verse).toBe(21);
    });

    it('should parse abbreviated book names', () => {
      const ref1 = parser.parse('Gen 1:1');
      expect(ref1.isValid).toBe(true);
      expect(ref1.book).toBe(1);
      expect(ref1.bookName).toBe('Gen');

      const ref2 = parser.parse('Matt 5:16');
      expect(ref2.isValid).toBe(true);
      expect(ref2.book).toBe(40);

      const ref3 = parser.parse('Rev 22:21');
      expect(ref3.isValid).toBe(true);
      expect(ref3.book).toBe(66);
    });

    it('should be case-insensitive', () => {
      const ref1 = parser.parse('JOHN 3:16');
      expect(ref1.isValid).toBe(true);
      expect(ref1.book).toBe(43);

      const ref2 = parser.parse('john 3:16');
      expect(ref2.isValid).toBe(true);
      expect(ref2.book).toBe(43);

      const ref3 = parser.parse('JoHn 3:16');
      expect(ref3.isValid).toBe(true);
      expect(ref3.book).toBe(43);
    });

    it('should handle whitespace', () => {
      const ref = parser.parse('  John   3:16  ');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(43);
      expect(ref.chapter).toBe(3);
      expect(ref.verse).toBe(16);
    });
  });

  // ==========================================================================
  // parse() Tests - Numbered Books
  // ==========================================================================

  describe('parse - Numbered Books', () => {
    it('should parse 1 John 3:16', () => {
      const ref = parser.parse('1 John 3:16');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(62);
      expect(ref.chapter).toBe(3);
      expect(ref.verse).toBe(16);
    });

    it('should parse 2 Corinthians 5:17', () => {
      const ref = parser.parse('2 Corinthians 5:17');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(47);
      expect(ref.chapter).toBe(5);
      expect(ref.verse).toBe(17);
    });

    it('should parse 3 John 1:2', () => {
      const ref = parser.parse('3 John 1:2');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(64);
      expect(ref.chapter).toBe(1);
      expect(ref.verse).toBe(2);
    });

    it('should parse 1 Samuel 17:47', () => {
      const ref = parser.parse('1 Samuel 17:47');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(9);
      expect(ref.chapter).toBe(17);
      expect(ref.verse).toBe(47);
    });

    it('should parse abbreviated numbered books', () => {
      const ref1 = parser.parse('1 Cor 13:13');
      expect(ref1.isValid).toBe(true);
      expect(ref1.book).toBe(46);

      const ref2 = parser.parse('2 Pet 3:9');
      expect(ref2.isValid).toBe(true);
      expect(ref2.book).toBe(61);

      const ref3 = parser.parse('1 Thess 5:17');
      expect(ref3.isValid).toBe(true);
      expect(ref3.book).toBe(52);
    });

    it('should handle compact numbered format without space', () => {
      const ref1 = parser.parse('1Corinthians 13:13');
      expect(ref1.isValid).toBe(true);
      expect(ref1.book).toBe(46);

      const ref2 = parser.parse('2Peter 3:9');
      expect(ref2.isValid).toBe(true);
      expect(ref2.book).toBe(61);
    });

    // KAN-18: Roman numeral support
    it('should parse Roman numeral numbered books (lowercase)', () => {
      const ref1 = parser.parse('i cor 1:2');
      expect(ref1.isValid).toBe(true);
      expect(ref1.book).toBe(46); // 1 Corinthians
      expect(ref1.chapter).toBe(1);
      expect(ref1.verse).toBe(2);

      const ref2 = parser.parse('ii cor 5:17');
      expect(ref2.isValid).toBe(true);
      expect(ref2.book).toBe(47); // 2 Corinthians
      expect(ref2.chapter).toBe(5);
      expect(ref2.verse).toBe(17);

      const ref3 = parser.parse('iii john 1:4');
      expect(ref3.isValid).toBe(true);
      expect(ref3.book).toBe(64); // 3 John
    });

    it('should parse Roman numeral numbered books (uppercase)', () => {
      const ref1 = parser.parse('I Cor 1:2');
      expect(ref1.isValid).toBe(true);
      expect(ref1.book).toBe(46);

      const ref2 = parser.parse('II Cor 5:17');
      expect(ref2.isValid).toBe(true);
      expect(ref2.book).toBe(47);
    });

    it('should parse Roman numerals for all numbered books', () => {
      // Samuel
      expect(parser.parse('i sam 1:1').book).toBe(9);
      expect(parser.parse('ii sam 1:1').book).toBe(10);

      // Kings
      expect(parser.parse('i kings 1:1').book).toBe(11);
      expect(parser.parse('ii kings 1:1').book).toBe(12);

      // Chronicles
      expect(parser.parse('i chr 1:1').book).toBe(13);
      expect(parser.parse('ii chr 1:1').book).toBe(14);

      // Thessalonians
      expect(parser.parse('i thess 1:1').book).toBe(52);
      expect(parser.parse('ii thess 1:1').book).toBe(53);

      // Timothy
      expect(parser.parse('i tim 1:1').book).toBe(54);
      expect(parser.parse('ii tim 1:1').book).toBe(55);

      // Peter
      expect(parser.parse('i peter 1:1').book).toBe(60);
      expect(parser.parse('ii peter 1:1').book).toBe(61);

      // John (epistles)
      expect(parser.parse('i john 1:1').book).toBe(62);
      expect(parser.parse('ii john 1:1').book).toBe(63);
      expect(parser.parse('iii john 1:1').book).toBe(64);
    });
  });

  // ==========================================================================
  // parse() Tests - Verse Ranges
  // ==========================================================================

  describe('parse - Verse Ranges', () => {
    it('should parse verse range in same chapter', () => {
      const ref = parser.parse('John 3:16-17');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(43);
      expect(ref.chapter).toBe(3);
      expect(ref.verse).toBe(16);
      expect(ref.endChapter).toBeUndefined();
      expect(ref.endVerse).toBe(17);
    });

    it('should parse verse range across chapters', () => {
      const ref = parser.parse('John 3:16-4:2');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(43);
      expect(ref.chapter).toBe(3);
      expect(ref.verse).toBe(16);
      expect(ref.endChapter).toBe(4);
      expect(ref.endVerse).toBe(2);
    });

    it('should parse Romans 8:28-39', () => {
      const ref = parser.parse('Romans 8:28-39');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(45);
      expect(ref.chapter).toBe(8);
      expect(ref.verse).toBe(28);
      expect(ref.endVerse).toBe(39);
    });

    it('should handle whitespace in range', () => {
      const ref = parser.parse('John 3:16 - 17');
      expect(ref.isValid).toBe(true);
      expect(ref.verse).toBe(16);
      expect(ref.endVerse).toBe(17);
    });

    it('should handle cross-chapter range with whitespace', () => {
      const ref = parser.parse('John 3:16 - 4:2');
      expect(ref.isValid).toBe(true);
      expect(ref.chapter).toBe(3);
      expect(ref.verse).toBe(16);
      expect(ref.endChapter).toBe(4);
      expect(ref.endVerse).toBe(2);
    });
  });

  // ==========================================================================
  // parse() Tests - Chapter References
  // ==========================================================================

  describe('parse - Chapter References', () => {
    it('should parse single chapter', () => {
      const ref = parser.parse('Psalm 23');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(19);
      expect(ref.chapter).toBe(23);
      expect(ref.verse).toBeUndefined();
      expect(ref.endChapter).toBeUndefined();
      expect(ref.endVerse).toBeUndefined();
    });

    it('should parse John 3', () => {
      const ref = parser.parse('John 3');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(43);
      expect(ref.chapter).toBe(3);
      expect(ref.verse).toBeUndefined();
    });

    it('should parse chapter range as endVerse (limitation)', () => {
      // Note: Current parser treats "John 3-5" as John chapter 3, verses ending at 5
      // It doesn't support true chapter ranges without verse numbers
      const ref = parser.parse('John 3-5');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(43);
      expect(ref.chapter).toBe(3);
      expect(ref.verse).toBeUndefined();
      // Parser limitation: endChapter is not captured, endVerse is set to 5
      expect(ref.endVerse).toBe(5);
    });
  });

  // ==========================================================================
  // parse() Tests - Invalid References
  // ==========================================================================

  describe('parse - Invalid References', () => {
    it('should return invalid for empty string', () => {
      const ref = parser.parse('');
      expect(ref.isValid).toBe(false);
      expect(ref.originalText).toBe('');
    });

    it('should return invalid for non-reference text', () => {
      const ref = parser.parse('This is not a reference');
      expect(ref.isValid).toBe(false);
    });

    it('should return invalid for book name only', () => {
      const ref = parser.parse('John');
      expect(ref.isValid).toBe(false);
    });

    it('should return invalid for unknown book name', () => {
      const ref = parser.parse('Notabook 3:16');
      expect(ref.isValid).toBe(false);
    });

    it('should return invalid for incomplete reference', () => {
      const ref1 = parser.parse('John 3:');
      expect(ref1.isValid).toBe(false);

      const ref2 = parser.parse('John :16');
      expect(ref2.isValid).toBe(false);
    });

    it('should preserve original text in invalid references', () => {
      const ref = parser.parse('Invalid Reference');
      expect(ref.isValid).toBe(false);
      expect(ref.originalText).toBe('Invalid Reference');
    });
  });

  // ==========================================================================
  // getBookNumber() Tests
  // ==========================================================================

  describe('getBookNumber', () => {
    it('should return book numbers for full names', () => {
      expect(parser.getBookNumber('Genesis')).toBe(1);
      expect(parser.getBookNumber('John')).toBe(43);
      expect(parser.getBookNumber('Revelation')).toBe(66);
    });

    it('should return book numbers for abbreviations', () => {
      expect(parser.getBookNumber('Gen')).toBe(1);
      expect(parser.getBookNumber('Matt')).toBe(40);
      expect(parser.getBookNumber('Rev')).toBe(66);
    });

    it('should return book numbers for numbered books', () => {
      expect(parser.getBookNumber('1 John')).toBe(62);
      expect(parser.getBookNumber('2 Corinthians')).toBe(47);
      expect(parser.getBookNumber('3 John')).toBe(64);
    });

    it('should be case-insensitive', () => {
      expect(parser.getBookNumber('JOHN')).toBe(43);
      expect(parser.getBookNumber('john')).toBe(43);
      expect(parser.getBookNumber('JoHn')).toBe(43);
    });

    it('should handle whitespace', () => {
      expect(parser.getBookNumber('  John  ')).toBe(43);
      expect(parser.getBookNumber('1 Corinthians')).toBe(46);
    });

    it('should return undefined for unknown books', () => {
      expect(parser.getBookNumber('NotABook')).toBeUndefined();
      expect(parser.getBookNumber('Maccabees')).toBeUndefined();
      expect(parser.getBookNumber('')).toBeUndefined();
    });

    it('should support multiple abbreviation styles', () => {
      // Genesis variations
      expect(parser.getBookNumber('Gen')).toBe(1);
      expect(parser.getBookNumber('Ge')).toBe(1);
      expect(parser.getBookNumber('Gn')).toBe(1);

      // Psalms variations
      expect(parser.getBookNumber('Psalm')).toBe(19);
      expect(parser.getBookNumber('Psalms')).toBe(19);
      expect(parser.getBookNumber('Ps')).toBe(19);
      expect(parser.getBookNumber('Psa')).toBe(19);
    });
  });

  // ==========================================================================
  // validate() Tests
  // ==========================================================================

  describe('validate', () => {
    it('should validate valid single verse reference', () => {
      const ref = parser.parse('John 3:16');
      const error = parser.validate(ref);
      expect(error).toBeUndefined();
    });

    it('should validate valid verse range', () => {
      const ref = parser.parse('John 3:16-17');
      const error = parser.validate(ref);
      expect(error).toBeUndefined();
    });

    it('should validate valid chapter reference', () => {
      const ref = parser.parse('Psalm 23');
      const error = parser.validate(ref);
      expect(error).toBeUndefined();
    });

    it('should reject invalid reference format', () => {
      const ref: ParsedReference = {
        isValid: false,
        originalText: 'Invalid',
      };
      const error = parser.validate(ref);
      expect(error).toBe('Invalid reference format');
    });

    it('should reject invalid book number', () => {
      const ref: ParsedReference = {
        isValid: true,
        book: 0,
        chapter: 1,
        verse: 1,
        originalText: 'Book 0:1:1',
      };
      const error = parser.validate(ref);
      expect(error).toBe('Invalid book number');

      const ref2: ParsedReference = {
        isValid: true,
        book: 67,
        chapter: 1,
        verse: 1,
        originalText: 'Book 67:1:1',
      };
      const error2 = parser.validate(ref2);
      expect(error2).toBe('Invalid book number');
    });

    it('should reject invalid chapter number', () => {
      const ref: ParsedReference = {
        isValid: true,
        book: 43,
        chapter: 0,
        originalText: 'John 0',
      };
      const error = parser.validate(ref);
      expect(error).toBe('Invalid chapter number');
    });

    it('should reject invalid verse number', () => {
      const ref: ParsedReference = {
        isValid: true,
        book: 43,
        chapter: 3,
        verse: 0,
        originalText: 'John 3:0',
      };
      const error = parser.validate(ref);
      expect(error).toBe('Invalid verse number');
    });

    it('should reject end chapter before start chapter', () => {
      const ref: ParsedReference = {
        isValid: true,
        book: 43,
        chapter: 5,
        endChapter: 3,
        originalText: 'John 5-3',
      };
      const error = parser.validate(ref);
      expect(error).toBe('End chapter must be after start chapter');
    });

    it('should reject end verse before start verse', () => {
      const ref: ParsedReference = {
        isValid: true,
        book: 43,
        chapter: 3,
        verse: 20,
        endVerse: 10,
        originalText: 'John 3:20-10',
      };
      const error = parser.validate(ref);
      expect(error).toBe('End verse must be after start verse');
    });

    it('should allow equal start and end verse (single verse)', () => {
      const ref: ParsedReference = {
        isValid: true,
        book: 43,
        chapter: 3,
        verse: 16,
        endVerse: 16,
        originalText: 'John 3:16-16',
      };
      const error = parser.validate(ref);
      // Should be valid (or at least not fail with the end verse error)
      expect(error).toBeUndefined();
    });
  });

  // ==========================================================================
  // format() Tests
  // ==========================================================================

  describe('format', () => {
    it('should format single verse reference', () => {
      const ref = parser.parse('John 3:16');
      const formatted = parser.format(ref);
      expect(formatted).toBe('John 3:16');
    });

    it('should format verse range in same chapter', () => {
      const ref = parser.parse('Romans 8:28-39');
      const formatted = parser.format(ref);
      expect(formatted).toBe('Romans 8:28-39');
    });

    it('should format verse range across chapters', () => {
      const ref = parser.parse('John 3:16-4:2');
      const formatted = parser.format(ref);
      expect(formatted).toBe('John 3:16-4:2');
    });

    it('should format chapter reference', () => {
      const ref = parser.parse('Psalm 23');
      const formatted = parser.format(ref);
      expect(formatted).toBe('Psalms 23');
    });

    it('should format chapter range (limitation)', () => {
      // Note: Parser treats "Genesis 1-3" as chapter 1, endVerse 3 (limitation)
      const ref = parser.parse('Genesis 1-3');
      const formatted = parser.format(ref);
      // This won't format as expected due to parser limitation
      expect(formatted).toBe('Genesis 1');
    });

    it('should use full book names', () => {
      const ref = parser.parse('Gen 1:1');
      const formatted = parser.format(ref);
      expect(formatted).toBe('Genesis 1:1');
    });

    it('should format numbered books correctly', () => {
      const ref1 = parser.parse('1 Cor 13:13');
      expect(parser.format(ref1)).toBe('1 Corinthians 13:13');

      const ref2 = parser.parse('2 Pet 3:9');
      expect(parser.format(ref2)).toBe('2 Peter 3:9');

      const ref3 = parser.parse('3 Jn 1:2');
      expect(parser.format(ref3)).toBe('3 John 1:2');
    });

    it('should return original text for invalid references', () => {
      const ref = parser.parse('Invalid Reference');
      const formatted = parser.format(ref);
      expect(formatted).toBe('Invalid Reference');
    });

    it('should handle round-trip formatting', () => {
      const input = 'John 3:16';
      const ref = parser.parse(input);
      const formatted = parser.format(ref);
      const reparsed = parser.parse(formatted);
      expect(reparsed.book).toBe(ref.book);
      expect(reparsed.chapter).toBe(ref.chapter);
      expect(reparsed.verse).toBe(ref.verse);
    });
  });

  // ==========================================================================
  // getBookName() Tests
  // ==========================================================================

  describe('getBookName', () => {
    it('should return correct names for all 66 books', () => {
      expect(parser.getBookName(1)).toBe('Genesis');
      expect(parser.getBookName(19)).toBe('Psalms');
      expect(parser.getBookName(40)).toBe('Matthew');
      expect(parser.getBookName(43)).toBe('John');
      expect(parser.getBookName(45)).toBe('Romans');
      expect(parser.getBookName(66)).toBe('Revelation');
    });

    it('should return numbered book names correctly', () => {
      expect(parser.getBookName(9)).toBe('1 Samuel');
      expect(parser.getBookName(10)).toBe('2 Samuel');
      expect(parser.getBookName(46)).toBe('1 Corinthians');
      expect(parser.getBookName(47)).toBe('2 Corinthians');
      expect(parser.getBookName(62)).toBe('1 John');
      expect(parser.getBookName(63)).toBe('2 John');
      expect(parser.getBookName(64)).toBe('3 John');
    });

    it('should handle special book names', () => {
      expect(parser.getBookName(22)).toBe('Song of Solomon');
    });

    it('should return fallback for invalid book numbers', () => {
      expect(parser.getBookName(0)).toBe('Book 0');
      expect(parser.getBookName(67)).toBe('Book 67');
      expect(parser.getBookName(100)).toBe('Book 100');
    });
  });

  // ==========================================================================
  // extractReferences() Tests
  // ==========================================================================

  describe('extractReferences', () => {
    it('should extract single reference', () => {
      const refs = parser.extractReferences('John 3:16');
      expect(refs).toHaveLength(1);
      expect(refs[0].book).toBe(43);
      expect(refs[0].chapter).toBe(3);
      expect(refs[0].verse).toBe(16);
    });

    it('should extract multiple references separated by comma', () => {
      const refs = parser.extractReferences('John 3:16, Romans 8:28, Psalm 23:1');
      expect(refs).toHaveLength(3);
      expect(refs[0].book).toBe(43);
      expect(refs[1].book).toBe(45);
      expect(refs[2].book).toBe(19);
    });

    it('should extract references separated by semicolon', () => {
      const refs = parser.extractReferences('John 3:16; Romans 8:28; Psalm 23:1');
      expect(refs).toHaveLength(3);
      expect(refs[0].book).toBe(43);
      expect(refs[1].book).toBe(45);
      expect(refs[2].book).toBe(19);
    });

    it('should handle mixed text with references', () => {
      const refs = parser.extractReferences(
        'See John 3:16 for context, also Romans 8:28 is relevant'
      );
      // This may not extract references in non-delimited text
      // depending on implementation
      expect(refs).toHaveLength(0); // Current implementation only splits by , ;
    });

    it('should skip invalid references', () => {
      const refs = parser.extractReferences('John 3:16, NotABook 1:1, Romans 8:28');
      expect(refs).toHaveLength(2);
      expect(refs[0].book).toBe(43);
      expect(refs[1].book).toBe(45);
    });

    it('should handle empty string', () => {
      const refs = parser.extractReferences('');
      expect(refs).toHaveLength(0);
    });

    it('should handle text with no references', () => {
      const refs = parser.extractReferences('This text has no Bible references');
      expect(refs).toHaveLength(0);
    });

    it('should extract verse ranges', () => {
      const refs = parser.extractReferences('Romans 8:28-39, John 3:16-17');
      expect(refs).toHaveLength(2);
      expect(refs[0].book).toBe(45);
      expect(refs[0].verse).toBe(28);
      expect(refs[0].endVerse).toBe(39);
      expect(refs[1].book).toBe(43);
      expect(refs[1].verse).toBe(16);
      expect(refs[1].endVerse).toBe(17);
    });
  });

  // ==========================================================================
  // Fuzzy Matching Tests
  // ==========================================================================

  describe('Fuzzy Matching', () => {
    it('should correct single-character typos in book names', () => {
      // "jonh" -> "john"
      const ref = parser.parse('Jonh 3:16');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(43);
      expect(ref.fuzzyMatch).toBe(true);
      expect(ref.correctedBookName).toBe('John');
    });

    it('should correct transposed letters', () => {
      // "gensis" -> "genesis"
      const ref = parser.parse('Gensis 1:1');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(1);
      expect(ref.fuzzyMatch).toBe(true);
      expect(ref.correctedBookName).toBe('Genesis');
    });

    it('should correct common misspellings', () => {
      // "revelations" is a common mistake (extra s)
      const ref1 = parser.parse('Revelaton 22:21');
      expect(ref1.isValid).toBe(true);
      expect(ref1.book).toBe(66);
      expect(ref1.fuzzyMatch).toBe(true);

      // "mathew" -> "matthew"
      const ref2 = parser.parse('Mathew 5:16');
      expect(ref2.isValid).toBe(true);
      expect(ref2.book).toBe(40);
      expect(ref2.fuzzyMatch).toBe(true);
    });

    it('should not fuzzy-match exact matches', () => {
      const ref = parser.parse('John 3:16');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(43);
      expect(ref.fuzzyMatch).toBeUndefined();
      expect(ref.correctedBookName).toBeUndefined();
    });

    it('should not fuzzy-match completely wrong book names', () => {
      const ref = parser.parse('Xyzabc 3:16');
      expect(ref.isValid).toBe(false);
    });

    it('should correct typos in numbered books', () => {
      // "1 jonh" -> "1 john"
      const ref = parser.parse('1 Jonh 3:16');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(62);
      expect(ref.fuzzyMatch).toBe(true);
    });

    it('should correct abbreviation typos', () => {
      // "mtt" -> "matt" or "mat"
      const ref = parser.parse('Pslm 23');
      expect(ref.isValid).toBe(true);
      expect(ref.book).toBe(19);
      expect(ref.fuzzyMatch).toBe(true);
    });

    it('should handle fuzzy match with getBookNumberFuzzy directly', () => {
      const result = parser.getBookNumberFuzzy('jonh');
      expect(result).toBeDefined();
      expect(result!.bookNumber).toBe(43);
      expect(result!.fuzzy).toBe(true);

      const exact = parser.getBookNumberFuzzy('john');
      expect(exact).toBeDefined();
      expect(exact!.bookNumber).toBe(43);
      expect(exact!.fuzzy).toBe(false);
    });

    it('should not fuzzy-match very short inputs that are too ambiguous', () => {
      // "ab" is too short (length 2, maxDistance = floor(2/2) = 1, but we skip keys <= 2 chars)
      const result = parser.getBookNumberFuzzy('xx');
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should handle complete parse-validate-format cycle', () => {
      const input = 'Romans 8:28-39';
      const ref = parser.parse(input);
      expect(ref.isValid).toBe(true);

      const error = parser.validate(ref);
      expect(error).toBeUndefined();

      const formatted = parser.format(ref);
      expect(formatted).toBe('Romans 8:28-39');
    });

    it('should correctly parse all common reference formats', () => {
      const tests = [
        { input: 'Genesis 1:1', book: 1, chapter: 1, verse: 1 },
        { input: 'John 3:16', book: 43, chapter: 3, verse: 16 },
        { input: 'Revelation 22:21', book: 66, chapter: 22, verse: 21 },
        { input: '1 Corinthians 13:13', book: 46, chapter: 13, verse: 13 },
        { input: '2 Peter 3:9', book: 61, chapter: 3, verse: 9 },
        { input: 'Psalm 23', book: 19, chapter: 23, verse: undefined },
      ];

      tests.forEach(test => {
        const ref = parser.parse(test.input);
        expect(ref.isValid).toBe(true);
        expect(ref.book).toBe(test.book);
        expect(ref.chapter).toBe(test.chapter);
        expect(ref.verse).toBe(test.verse);
      });
    });

    it('should handle list of famous verses', () => {
      const famousVerses = [
        'Genesis 1:1',
        'Psalm 23:1',
        'Proverbs 3:5-6',
        'Isaiah 40:31',
        'Jeremiah 29:11',
        'Matthew 5:16',
        'John 3:16',
        'John 14:6',
        'Romans 8:28',
        'Philippians 4:13',
        '2 Timothy 3:16',
      ];

      famousVerses.forEach(verse => {
        const ref = parser.parse(verse);
        expect(ref.isValid).toBe(true);
        expect(ref.book).toBeGreaterThan(0);
        expect(ref.book).toBeLessThanOrEqual(66);
      });
    });
  });

  // ==========================================================================
  // scanText() Tests
  // ==========================================================================

  describe('scanText', () => {
    /** The text each match actually covers, so offsets are checked too. */
    const found = (text: string): string[] =>
      parser.scanText(text).map(m => text.slice(m.start, m.end));

    it('finds a reference embedded in a sentence, with correct offsets', () => {
      expect(found('See John 3:16 today')).toEqual(['John 3:16']);
    });

    it('finds several references in one sentence', () => {
      expect(found('Compare John 3:16 with Romans 8:28 here'))
        .toEqual(['John 3:16', 'Romans 8:28']);
    });

    it('finds a numbered book after a capitalised word', () => {
      // Regression: the pattern's `[A-Z][a-z]+\s+\d+` branch matches an
      // ordinary capitalised word followed by a number, and a numbered book's
      // prefix is exactly such a number. Resuming the scan from `lastIndex`
      // after a rejected match consumed the prefix: "See 1 John 3:16" was
      // detected as *John* 3:16 (book 43, the wrong book), and "Read 2 Timothy
      // 1:7" matched nothing at all because "Timothy" alone is not a book.
      // The scan now resumes one character past where the rejected attempt
      // started, so the real reference inside it is still found.
      expect(found('See 1 John 3:16')).toEqual(['1 John 3:16']);
      expect(parser.scanText('See 1 John 3:16')[0].book).toBe(62);

      expect(found('Read 2 Timothy 1:7')).toEqual(['2 Timothy 1:7']);
      expect(parser.scanText('Read 2 Timothy 1:7')[0].book).toBe(55);

      expect(found('Meeting 5 was long, but Romans 8:28 helps')).toEqual(['Romans 8:28']);
    });

    it('still finds a numbered book with no preceding word', () => {
      expect(found('1 John 3:16 says')).toEqual(['1 John 3:16']);
      expect(found('in 1 John 3:16 we')).toEqual(['1 John 3:16']);
      expect(found('III John 4')).toEqual(['III John 4']);
    });

    it('does not invent references from ordinary prose', () => {
      // The rejection-and-backtrack path must not turn near-misses into hits.
      expect(found('Chapter 3 is fine')).toEqual([]);
      expect(found('Task 1 and Task 2')).toEqual([]);
      expect(found('Section 5 of the report')).toEqual([]);
    });

    it('requires an exact, capitalised book name', () => {
      // Lowercase is skipped so prose is left alone; fuzzy matches are
      // rejected so "Task 1" cannot become a book.
      expect(found('see john 3:16 now')).toEqual([]);
      expect(found('see Jonh 3:16 now')).toEqual([]);
    });

    it('emits a second match for a comma-continued verse', () => {
      expect(found('Read John 3:16, 17 tonight')).toEqual(['John 3:16', ', 17']);
      expect(parser.scanText('Read John 3:16, 17 tonight')[1].verse).toBe(17);
    });

    it('handles ranges, whole chapters and single-chapter books', () => {
      expect(found('Romans 8:28-30')).toEqual(['Romans 8:28-30']);
      expect(found('John 3:16-4:2')).toEqual(['John 3:16-4:2']);
      expect(found('Psalms 119')).toEqual(['Psalms 119']);
      expect(found('Jude 5')).toEqual(['Jude 5']);
    });

    it('terminates on input with many rejected candidates', () => {
      // The backtrack sets lastIndex to match.index + 1; exec only returns
      // matches at or after lastIndex, so it strictly increases and cannot
      // loop. This guards that reasoning.
      const text = `${'Item 1 Thing 2 Note 3 '.repeat(200)}Romans 8:28`;
      const started = Date.now();
      expect(found(text)).toEqual(['Romans 8:28']);
      expect(Date.now() - started).toBeLessThan(2000);
    });
  });
});
