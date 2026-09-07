import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerseNavigationService } from './VerseNavigationService';
import { IBibleBookRepository } from '../Data/Repositories/IBibleBookRepository';
import { BibleBook } from '../Data/Models/Main/BibleBook';
import { VerseIdHelper } from '../Data/Core/Types';

// Mock BibleBookRepository
const createMockBibleBook = (
  bookNumber: number,
  bookName: string,
  bookAbbreviation: string,
  chapterCount: number,
  testament: 'OT' | 'NT'
): BibleBook => new BibleBook({
  // Was an object literal carrying `id` and `testamentId`, neither of which is
  // on `BibleBook`, and omitting the required `verseCount`. Constructing the
  // real class means the service is exercised against a real book record.
  bookId: bookNumber,
  bookNumber,
  bookName,
  bookAbbreviation,
  testament,
  chapterCount,
  verseCount: chapterCount * 25,
});

describe('VerseNavigationService', () => {
  let service: VerseNavigationService;
  let mockBibleBookRepo: IBibleBookRepository;

  // Sample books for testing
  const genesis = createMockBibleBook(1, 'Genesis', 'Gen', 50, 'OT');
  const exodus = createMockBibleBook(2, 'Exodus', 'Ex', 40, 'OT');
  const psalms = createMockBibleBook(19, 'Psalms', 'Ps', 150, 'OT');
  const malachi = createMockBibleBook(39, 'Malachi', 'Mal', 4, 'OT');
  const matthew = createMockBibleBook(40, 'Matthew', 'Mt', 28, 'NT');
  const john = createMockBibleBook(43, 'John', 'Jn', 21, 'NT');
  const romans = createMockBibleBook(45, 'Romans', 'Rom', 16, 'NT');
  const revelation = createMockBibleBook(66, 'Revelation', 'Rev', 22, 'NT');

  beforeEach(() => {
    mockBibleBookRepo = {
      getByBookNumber: vi.fn((bookNumber: number) => {
        const books = [genesis, exodus, psalms, malachi, matthew, john, romans, revelation];
        return books.find(b => b.bookNumber === bookNumber);
      }),
      getByName: vi.fn((name: string) => {
        const nameMap: Record<string, BibleBook> = {
          'Genesis': genesis,
          'Gen': genesis,
          'Exodus': exodus,
          'Ex': exodus,
          'Psalms': psalms,
          'Ps': psalms,
          'Malachi': malachi,
          'Mal': malachi,
          'Matthew': matthew,
          'Mt': matthew,
          'John': john,
          'Jn': john,
          'Romans': romans,
          'Rom': romans,
          'Revelation': revelation,
          'Rev': revelation
        };
        return nameMap[name];
      }),
      getAll: vi.fn(() => [genesis, exodus, psalms, malachi, matthew, john, romans, revelation]),
      getByTestament: vi.fn((testament: 'OT' | 'NT') => {
        if (testament === 'OT') {
          return [genesis, exodus, psalms, malachi];
        } else {
          return [matthew, john, romans, revelation];
        }
      }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      // The rest of `IBibleBookRepository`. The service does not call these,
      // but leaving them off meant the object was not the interface it claimed
      // to be - so a method the service started calling would have failed at
      // run time rather than at the type-check.
      getById: vi.fn((id: number) => [genesis, exodus, psalms, malachi, matthew, john, romans, revelation]
        .find(b => b.bookId === id)),
      getByBookGroup: vi.fn(() => []),
      getTotalVerseCount: vi.fn(() => 31102),
      search: vi.fn(() => []),
      getChapterInfo: vi.fn(() => undefined),
      getBookChapterInfo: vi.fn(() => []),
      getChapterInfoByBookNumber: vi.fn(() => []),
    };

    service = new VerseNavigationService(mockBibleBookRepo);
  });

  describe('parseReference', () => {
    it('should parse full reference "John 3:16"', () => {
      const ref = service.parseReference('John 3:16');

      expect(ref).toBeDefined();
      expect(ref?.bookNumber).toBe(43);
      expect(ref?.bookName).toBe('John');
      expect(ref?.chapter).toBe(3);
      expect(ref?.verseStart).toBe(16);
      expect(ref?.verseEnd).toBeUndefined();
      expect(ref?.verseId).toBe(43003016);
    });

    it('should parse abbreviated reference "Jn 3:16"', () => {
      const ref = service.parseReference('Jn 3:16');

      expect(ref).toBeDefined();
      expect(ref?.bookNumber).toBe(43);
      expect(ref?.bookName).toBe('John');
      expect(ref?.chapter).toBe(3);
      expect(ref?.verseStart).toBe(16);
    });

    it('should parse verse range "Romans 8:28-30"', () => {
      const ref = service.parseReference('Romans 8:28-30');

      expect(ref).toBeDefined();
      expect(ref?.bookNumber).toBe(45);
      expect(ref?.bookName).toBe('Romans');
      expect(ref?.chapter).toBe(8);
      expect(ref?.verseStart).toBe(28);
      expect(ref?.verseEnd).toBe(30);
      expect(ref?.verseId).toBe(45008028); // Start verse ID
    });

    it('should parse chapter reference "Genesis 1"', () => {
      const ref = service.parseReference('Genesis 1');

      expect(ref).toBeDefined();
      expect(ref?.bookNumber).toBe(1);
      expect(ref?.bookName).toBe('Genesis');
      expect(ref?.chapter).toBe(1);
      expect(ref?.verseStart).toBe(1); // Defaults to verse 1
      expect(ref?.verseEnd).toBeUndefined();
    });

    it('should parse abbreviated chapter reference "Gen 1"', () => {
      const ref = service.parseReference('Gen 1');

      expect(ref).toBeDefined();
      expect(ref?.bookNumber).toBe(1);
      expect(ref?.chapter).toBe(1);
    });

    it('should parse Psalm 119:1', () => {
      const ref = service.parseReference('Psalms 119:1');

      expect(ref).toBeDefined();
      expect(ref?.bookNumber).toBe(19);
      expect(ref?.chapter).toBe(119);
      expect(ref?.verseStart).toBe(1);
    });

    it('should return undefined for invalid reference', () => {
      expect(service.parseReference('InvalidBook 1:1')).toBeUndefined();
      expect(service.parseReference('')).toBeUndefined();
      expect(service.parseReference('   ')).toBeUndefined();
      expect(service.parseReference('John')).toBeUndefined(); // Missing chapter
    });

    it('should return undefined for invalid chapter', () => {
      const ref = service.parseReference('John 999:1'); // John only has 21 chapters
      expect(ref).toBeUndefined();
    });

    it('should handle extra whitespace', () => {
      const ref = service.parseReference('  John  3:16  ');

      expect(ref).toBeDefined();
      expect(ref?.bookNumber).toBe(43);
      expect(ref?.chapter).toBe(3);
      expect(ref?.verseStart).toBe(16);
    });
  });

  describe('getNextChapter', () => {
    it('should navigate to next chapter in same book', () => {
      const result = service.getNextChapter(43, 3); // John 3 -> John 4

      expect(result.canNavigate).toBe(true);
      expect(result.targetBookNumber).toBe(43);
      expect(result.targetChapter).toBe(4);
      expect(result.targetVerseId).toBe(43004001); // John 4:1
    });

    it('should navigate to first chapter of next book at end of book', () => {
      const result = service.getNextChapter(39, 4); // Malachi 4 (last OT) -> Matthew 1 (first NT)

      expect(result.canNavigate).toBe(true);
      expect(result.targetBookNumber).toBe(40);
      expect(result.targetChapter).toBe(1);
      expect(result.targetVerseId).toBe(40001001); // Matthew 1:1
    });

    it('should return false at last chapter of last book', () => {
      const result = service.getNextChapter(66, 22); // Revelation 22 (last chapter)

      expect(result.canNavigate).toBe(false);
      expect(result.message).toBe('Already at last chapter of last book');
    });

    it('should return false for invalid book number', () => {
      const result = service.getNextChapter(999, 1);

      expect(result.canNavigate).toBe(false);
      expect(result.message).toBe('Invalid book number');
    });

    it('should handle navigation within Genesis', () => {
      const result = service.getNextChapter(1, 1); // Genesis 1 -> Genesis 2

      expect(result.canNavigate).toBe(true);
      expect(result.targetBookNumber).toBe(1);
      expect(result.targetChapter).toBe(2);
      expect(result.targetVerseId).toBe(1002001); // Genesis 2:1
    });
  });

  describe('getPreviousChapter', () => {
    it('should navigate to previous chapter in same book', () => {
      const result = service.getPreviousChapter(43, 3); // John 3 -> John 2

      expect(result.canNavigate).toBe(true);
      expect(result.targetBookNumber).toBe(43);
      expect(result.targetChapter).toBe(2);
      expect(result.targetVerseId).toBe(43002001); // John 2:1
    });

    it('should navigate to last chapter of previous book at start of book', () => {
      const result = service.getPreviousChapter(40, 1); // Matthew 1 -> Malachi 4 (last chapter)

      expect(result.canNavigate).toBe(true);
      expect(result.targetBookNumber).toBe(39);
      expect(result.targetChapter).toBe(4);
      expect(result.targetVerseId).toBe(39004001); // Malachi 4:1
    });

    it('should return false at first chapter of first book', () => {
      const result = service.getPreviousChapter(1, 1); // Genesis 1

      expect(result.canNavigate).toBe(false);
      expect(result.message).toBe('Already at first chapter of first book');
    });

    it('should return false for invalid book number', () => {
      const result = service.getPreviousChapter(999, 1);

      expect(result.canNavigate).toBe(false);
      expect(result.message).toBe('Invalid book number');
    });

    it('should handle navigation within John', () => {
      const result = service.getPreviousChapter(43, 21); // John 21 -> John 20

      expect(result.canNavigate).toBe(true);
      expect(result.targetBookNumber).toBe(43);
      expect(result.targetChapter).toBe(20);
      expect(result.targetVerseId).toBe(43020001); // John 20:1
    });
  });

  describe('getChapterInfo', () => {
    it('should return chapter information', () => {
      const info = service.getChapterInfo(43, 3);

      expect(info).toBeDefined();
      expect(info?.bookNumber).toBe(43);
      expect(info?.bookName).toBe('John');
      expect(info?.chapter).toBe(3);
      expect(info?.startVerseId).toBe(43003001);
      expect(info?.endVerseId).toBe(43003999);
    });

    it('should return undefined for invalid book', () => {
      const info = service.getChapterInfo(999, 1);
      expect(info).toBeUndefined();
    });

    it('should return undefined for invalid chapter (too low)', () => {
      const info = service.getChapterInfo(43, 0);
      expect(info).toBeUndefined();
    });

    it('should return undefined for invalid chapter (too high)', () => {
      const info = service.getChapterInfo(43, 999);
      expect(info).toBeUndefined();
    });

    it('should get info for Genesis 1', () => {
      const info = service.getChapterInfo(1, 1);

      expect(info).toBeDefined();
      expect(info?.bookNumber).toBe(1);
      expect(info?.bookName).toBe('Genesis');
      expect(info?.chapter).toBe(1);
    });
  });

  describe('getAllBooks', () => {
    it('should return all books', () => {
      const books = service.getAllBooks();

      expect(books).toHaveLength(8); // Our mock has 8 books
      expect(books[0].bookName).toBe('Genesis');
      expect(books[books.length - 1].bookName).toBe('Revelation');
    });
  });

  describe('getBooksByTestament', () => {
    it('should return Old Testament books', () => {
      const books = service.getBooksByTestament('OT');

      expect(books).toHaveLength(4);
      expect(books.every(b => b.testament === 'OT')).toBe(true);
      expect(books[0].bookName).toBe('Genesis');
    });

    it('should return New Testament books', () => {
      const books = service.getBooksByTestament('NT');

      expect(books).toHaveLength(4);
      expect(books.every(b => b.testament === 'NT')).toBe(true);
      expect(books[0].bookName).toBe('Matthew');
    });
  });

  describe('formatReference', () => {
    it('should format verse reference using abbreviation', () => {
      const verseId = VerseIdHelper.calculate(43, 3, 16);
      const formatted = service.formatReference(verseId);

      expect(formatted).toBe('Jn 3:16');
    });

    it('should format Genesis 1:1', () => {
      const verseId = VerseIdHelper.calculate(1, 1, 1);
      const formatted = service.formatReference(verseId);

      expect(formatted).toBe('Gen 1:1');
    });

    it('should format Revelation 22:21', () => {
      const verseId = VerseIdHelper.calculate(66, 22, 21);
      const formatted = service.formatReference(verseId);

      expect(formatted).toBe('Rev 22:21');
    });

    it('should handle unknown book gracefully', () => {
      const verseId = VerseIdHelper.calculate(99, 1, 1);
      const formatted = service.formatReference(verseId);

      expect(formatted).toBe('Book 99:1:1');
    });
  });

  describe('formatRangeReference', () => {
    it('should format verse range in same chapter', () => {
      const startId = VerseIdHelper.calculate(45, 8, 28);
      const endId = VerseIdHelper.calculate(45, 8, 30);
      const formatted = service.formatRangeReference(startId, endId);

      expect(formatted).toBe('Rom 8:28-30');
    });

    it('should format verse range across chapters', () => {
      const startId = VerseIdHelper.calculate(43, 3, 16);
      const endId = VerseIdHelper.calculate(43, 4, 5);
      const formatted = service.formatRangeReference(startId, endId);

      expect(formatted).toBe('Jn 3:16 - 4:5');
    });

    it('should format range in Genesis', () => {
      const startId = VerseIdHelper.calculate(1, 1, 1);
      const endId = VerseIdHelper.calculate(1, 1, 31);
      const formatted = service.formatRangeReference(startId, endId);

      expect(formatted).toBe('Gen 1:1-31');
    });

    it('should handle unknown book gracefully', () => {
      const startId = VerseIdHelper.calculate(99, 1, 1);
      const endId = VerseIdHelper.calculate(99, 1, 10);
      const formatted = service.formatRangeReference(startId, endId);

      expect(formatted).toBe('Book 99:1:1-10');
    });
  });

  describe('isValidReference', () => {
    it('should validate correct references', () => {
      expect(service.isValidReference(43, 3, 16)).toBe(true);  // John 3:16
      expect(service.isValidReference(1, 1, 1)).toBe(true);    // Genesis 1:1
      expect(service.isValidReference(66, 22, 21)).toBe(true); // Revelation 22:21
    });

    it('should reject invalid book number', () => {
      expect(service.isValidReference(0, 1, 1)).toBe(false);
      expect(service.isValidReference(999, 1, 1)).toBe(false);
    });

    it('should reject invalid chapter (too low)', () => {
      expect(service.isValidReference(43, 0, 1)).toBe(false);
    });

    it('should reject invalid chapter (too high)', () => {
      expect(service.isValidReference(43, 999, 1)).toBe(false); // John only has 21 chapters
    });

    it('should reject invalid verse (too low)', () => {
      expect(service.isValidReference(43, 3, 0)).toBe(false);
    });

    it('should validate verse numbers greater than 1', () => {
      expect(service.isValidReference(43, 3, 16)).toBe(true);
      expect(service.isValidReference(19, 119, 176)).toBe(true); // Psalm 119:176
    });
  });

  describe('getVerseId', () => {
    it('should return verse ID for valid reference', () => {
      const verseId = service.getVerseId(43, 3, 16);

      expect(verseId).toBe(43003016);
    });

    it('should return verse ID for Genesis 1:1', () => {
      const verseId = service.getVerseId(1, 1, 1);

      expect(verseId).toBe(1001001);
    });

    it('should return undefined for invalid book', () => {
      const verseId = service.getVerseId(999, 1, 1);

      expect(verseId).toBeUndefined();
    });

    it('should return undefined for invalid chapter', () => {
      const verseId = service.getVerseId(43, 999, 1);

      expect(verseId).toBeUndefined();
    });

    it('should return undefined for invalid verse', () => {
      const verseId = service.getVerseId(43, 3, 0);

      expect(verseId).toBeUndefined();
    });
  });

  describe('Integration Tests', () => {
    it('should parse and validate reference', () => {
      const ref = service.parseReference('John 3:16');

      expect(ref).toBeDefined();

      const isValid = service.isValidReference(
        ref!.bookNumber,
        ref!.chapter,
        ref!.verseStart!
      );

      expect(isValid).toBe(true);
    });

    it('should parse, format, and navigate', () => {
      // Parse reference
      const ref = service.parseReference('John 3:16');
      expect(ref?.verseId).toBe(43003016);

      // Format it
      const formatted = service.formatReference(ref!.verseId);
      expect(formatted).toBe('Jn 3:16');

      // Navigate to next chapter
      const next = service.getNextChapter(ref!.bookNumber, ref!.chapter);
      expect(next.canNavigate).toBe(true);
      expect(next.targetChapter).toBe(4);
    });

    it('should handle complete navigation workflow', () => {
      // Start at John 1
      let current = { bookNumber: 43, chapter: 1 };

      // Navigate forward 3 chapters
      for (let i = 0; i < 3; i++) {
        const next = service.getNextChapter(current.bookNumber, current.chapter);
        expect(next.canNavigate).toBe(true);
        current = {
          bookNumber: next.targetBookNumber!,
          chapter: next.targetChapter!
        };
      }

      expect(current.chapter).toBe(4); // Should be at John 4

      // Navigate back 2 chapters
      for (let i = 0; i < 2; i++) {
        const prev = service.getPreviousChapter(current.bookNumber, current.chapter);
        expect(prev.canNavigate).toBe(true);
        current = {
          bookNumber: prev.targetBookNumber!,
          chapter: prev.targetChapter!
        };
      }

      expect(current.chapter).toBe(2); // Should be at John 2
    });
  });
});
