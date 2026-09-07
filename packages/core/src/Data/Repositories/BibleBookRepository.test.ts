import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BibleBookRepository } from './BibleBookRepository';
import { MainTestHelper } from '../../__tests__/helpers/MainTestHelper';
import { Book } from '../Core/Types';

describe('BibleBookRepository', () => {
  let repository: BibleBookRepository;

  beforeAll(() => {
    MainTestHelper.initialize();
    repository = MainTestHelper.getRepository();
  });

  afterAll(() => {
    MainTestHelper.cleanup();
  });

  // ==========================================================================
  // Get By ID Tests
  // ==========================================================================

  describe('getById', () => {
    it('should get book by ID', () => {
      const book = repository.getById(1); // Genesis should have ID 1

      expect(book).toBeDefined();
      expect(book?.bookId).toBe(1);
      expect(book?.bookName).toBe('Genesis');
    });

    it('should return undefined for non-existent ID', () => {
      const book = repository.getById(999);

      expect(book).toBeUndefined();
    });
  });

  // ==========================================================================
  // Get By Book Number Tests
  // ==========================================================================

  describe('getByBookNumber', () => {
    it('should get Genesis (book 1)', () => {
      const book = repository.getByBookNumber(Book.Genesis);

      expect(book).toBeDefined();
      expect(book?.bookNumber).toBe(Book.Genesis);
      expect(book?.bookName).toBe('Genesis');
      expect(book?.bookAbbreviation).toBe('Gen');
      expect(book?.testament).toBe('OT');
      expect(book?.bookGroup).toBe('Law');
    });

    it('should get John (book 43)', () => {
      const book = repository.getByBookNumber(Book.John);

      expect(book).toBeDefined();
      expect(book?.bookNumber).toBe(Book.John);
      expect(book?.bookName).toBe('John');
      expect(book?.testament).toBe('NT');
      expect(book?.bookGroup).toBe('Gospels');
    });

    it('should get Revelation (book 66)', () => {
      const book = repository.getByBookNumber(Book.Revelation);

      expect(book).toBeDefined();
      expect(book?.bookNumber).toBe(Book.Revelation);
      expect(book?.bookName).toBe('Revelation');
      expect(book?.testament).toBe('NT');
    });

    it('should return undefined for non-existent book number', () => {
      const book = repository.getByBookNumber(99);

      expect(book).toBeUndefined();
    });
  });

  // ==========================================================================
  // Get By Name Tests
  // ==========================================================================

  describe('getByName', () => {
    it('should get book by full name', () => {
      const book = repository.getByName('Genesis');

      expect(book).toBeDefined();
      expect(book?.bookName).toBe('Genesis');
      expect(book?.bookNumber).toBe(Book.Genesis);
    });

    it('should get book by abbreviation', () => {
      const book = repository.getByName('Gen');

      expect(book).toBeDefined();
      expect(book?.bookName).toBe('Genesis');
      expect(book?.bookAbbreviation).toBe('Gen');
    });

    it('should get numbered book by full name', () => {
      const book = repository.getByName('1 Corinthians');

      expect(book).toBeDefined();
      expect(book?.bookNumber).toBe(Book.FirstCorinthians);
    });

    it('should get numbered book by abbreviation', () => {
      const book = repository.getByName('1Cor');

      expect(book).toBeDefined();
      expect(book?.bookNumber).toBe(Book.FirstCorinthians);
    });

    it('should return undefined for non-existent name', () => {
      const book = repository.getByName('NotABook');

      expect(book).toBeUndefined();
    });
  });

  // ==========================================================================
  // Get All Tests
  // ==========================================================================

  describe('getAll', () => {
    it('should get all books in order', () => {
      const books = repository.getAll();

      expect(books.length).toBeGreaterThan(0);

      // Should be in book number order by default
      for (let i = 1; i < books.length; i++) {
        expect(books[i].bookNumber).toBeGreaterThan(books[i - 1].bookNumber);
      }
    });

    it('should respect limit option', () => {
      const books = repository.getAll({ limit: 5 });

      expect(books.length).toBe(5);
    });

    it('should respect offset option', () => {
      const allBooks = repository.getAll();
      // Note: SQLite requires LIMIT when using OFFSET
      const offsetBooks = repository.getAll({ offset: 2, limit: 100 });

      expect(offsetBooks[0].bookNumber).toBe(allBooks[2].bookNumber);
    });

    it('should order by book name', () => {
      const books = repository.getAll({ orderBy: 'book_name' });

      // Check that books are alphabetically ordered
      for (let i = 1; i < books.length; i++) {
        expect(books[i].bookName.localeCompare(books[i - 1].bookName)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should order descending', () => {
      const books = repository.getAll({ orderDirection: 'DESC' });

      // Should be in reverse book number order
      for (let i = 1; i < books.length; i++) {
        expect(books[i].bookNumber).toBeLessThan(books[i - 1].bookNumber);
      }
    });
  });

  // ==========================================================================
  // Get By Testament Tests
  // ==========================================================================

  describe('getByTestament', () => {
    it('should get Old Testament books', () => {
      const books = repository.getByTestament('OT');

      expect(books.length).toBeGreaterThan(0);

      // All should be OT
      books.forEach(book => {
        expect(book.testament).toBe('OT');
      });

      // Should include Genesis and Psalms
      const bookNumbers = books.map(b => b.bookNumber);
      expect(bookNumbers).toContain(Book.Genesis);
      expect(bookNumbers).toContain(Book.Psalms);
    });

    it('should get New Testament books', () => {
      const books = repository.getByTestament('NT');

      expect(books.length).toBeGreaterThan(0);

      // All should be NT
      books.forEach(book => {
        expect(book.testament).toBe('NT');
      });

      // Should include Matthew, John, and Revelation
      const bookNumbers = books.map(b => b.bookNumber);
      expect(bookNumbers).toContain(Book.Matthew);
      expect(bookNumbers).toContain(Book.John);
      expect(bookNumbers).toContain(Book.Revelation);
    });

    it('should return books in correct order', () => {
      const books = repository.getByTestament('NT');

      // Should be in book number order
      for (let i = 1; i < books.length; i++) {
        expect(books[i].bookNumber).toBeGreaterThan(books[i - 1].bookNumber);
      }
    });
  });

  // ==========================================================================
  // Get By Book Group Tests
  // ==========================================================================

  describe('getByBookGroup', () => {
    it('should get Law books', () => {
      const books = repository.getByBookGroup('Law');

      expect(books.length).toBeGreaterThan(0);

      // All should be Law
      books.forEach(book => {
        expect(book.bookGroup).toBe('Law');
      });

      // Should include Genesis and Exodus
      const bookNumbers = books.map(b => b.bookNumber);
      expect(bookNumbers).toContain(Book.Genesis);
      expect(bookNumbers).toContain(Book.Exodus);
    });

    it('should get Gospel books', () => {
      const books = repository.getByBookGroup('Gospels');

      expect(books.length).toBeGreaterThan(0);

      // All should be Gospels
      books.forEach(book => {
        expect(book.bookGroup).toBe('Gospels');
      });

      // Should include Matthew and John
      const bookNumbers = books.map(b => b.bookNumber);
      expect(bookNumbers).toContain(Book.Matthew);
      expect(bookNumbers).toContain(Book.John);
    });

    it('should get Pauline Epistles', () => {
      const books = repository.getByBookGroup('Pauline Epistles');

      expect(books.length).toBeGreaterThan(0);

      // All should be Pauline Epistles
      books.forEach(book => {
        expect(book.bookGroup).toBe('Pauline Epistles');
      });

      // Should include Romans, 1 Corinthians, Ephesians
      const bookNumbers = books.map(b => b.bookNumber);
      expect(bookNumbers).toContain(Book.Romans);
      expect(bookNumbers).toContain(Book.FirstCorinthians);
      expect(bookNumbers).toContain(Book.Ephesians);
    });

    it('should return empty array for non-existent group', () => {
      const books = repository.getByBookGroup('NotAGroup');

      expect(books).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Search Tests
  // ==========================================================================

  describe('search', () => {
    it('should search by partial name', () => {
      const books = repository.search('Gen');

      expect(books.length).toBeGreaterThan(0);

      // Should find Genesis
      const genesis = books.find(b => b.bookName === 'Genesis');
      expect(genesis).toBeDefined();
    });

    it('should search by partial abbreviation', () => {
      const books = repository.search('Rom');

      expect(books.length).toBeGreaterThan(0);

      // Should find Romans
      const romans = books.find(b => b.bookName === 'Romans');
      expect(romans).toBeDefined();
    });

    it('should be case insensitive', () => {
      const books = repository.search('john');

      expect(books.length).toBeGreaterThan(0);

      // Should find John
      const john = books.find(b => b.bookName === 'John');
      expect(john).toBeDefined();
    });

    it('should return empty array for no matches', () => {
      const books = repository.search('xyz123notfound');

      expect(books).toHaveLength(0);
    });

    it('should find numbered books', () => {
      const books = repository.search('Cor');

      expect(books.length).toBeGreaterThan(0);

      // Should find 1 Corinthians (and possibly 2 Corinthians if in dataset)
      const firstCor = books.find(b => b.bookNumber === Book.FirstCorinthians);
      expect(firstCor).toBeDefined();
    });
  });

  // ==========================================================================
  // Get Total Verse Count Tests
  // ==========================================================================

  describe('getTotalVerseCount', () => {
    it('should return total verse count across all books', () => {
      const total = repository.getTotalVerseCount();

      expect(total).toBeGreaterThan(0);

      // Calculate expected total from test data
      const allBooks = repository.getAll();
      const expectedTotal = allBooks.reduce((sum, book) => sum + book.verseCount, 0);

      expect(total).toBe(expectedTotal);
    });

    it('should be consistent', () => {
      const count1 = repository.getTotalVerseCount();
      const count2 = repository.getTotalVerseCount();

      expect(count1).toBe(count2);
    });
  });

  // ==========================================================================
  // CRUD Tests
  // ==========================================================================

  describe('CRUD Operations', () => {
    it('should update an existing book', () => {
      // Get an existing book (Genesis)
      const book = repository.getById(1);
      expect(book).toBeDefined();

      // Update it
      const originalName = book!.bookName;
      book!.bookName = 'Updated Name';
      book!.chapterCount = 999;
      repository.update(book!);

      // Verify update
      const updated = repository.getById(1);
      expect(updated?.bookName).toBe('Updated Name');
      expect(updated?.chapterCount).toBe(999);

      // Restore original
      book!.bookName = originalName;
      book!.chapterCount = 50;
      repository.update(book!);
    });

    it('should throw error when updating book without ID', () => {
      const book = {
        bookNumber: 1,
        bookName: 'No ID Book',
        testament: 'OT',
        chapterCount: 1,
        verseCount: 10,
      } as any;

      expect(() => repository.update(book)).toThrow('Cannot update Bible book without ID');
    });

    it('should return false when deleting non-existent book', () => {
      const deleted = repository.delete(99999);

      expect(deleted).toBe(false);
    });
  });

  // ==========================================================================
  // Chapter Info Tests
  // ==========================================================================

  describe('Chapter Info Operations', () => {
    it('should get chapter info for specific chapter', () => {
      // Genesis is book_id 1, chapter 1
      const chapterInfo = repository.getChapterInfo(1, 1);

      expect(chapterInfo).toBeDefined();
      expect(chapterInfo?.chapter).toBe(1);
      expect(chapterInfo?.verseCount).toBe(31);
      expect(chapterInfo?.firstAbsoluteId).toBe(1001001);
      expect(chapterInfo?.lastAbsoluteId).toBe(1001031);
    });

    it('should return undefined for non-existent chapter', () => {
      const chapterInfo = repository.getChapterInfo(1, 999);

      expect(chapterInfo).toBeUndefined();
    });

    it('should get all chapter info for a book', () => {
      // Psalms is book_id 4, has chapters 23 and 119 in test data
      const chapterInfos = repository.getBookChapterInfo(4);

      expect(chapterInfos.length).toBeGreaterThan(0);

      // Should be in chapter order
      for (let i = 1; i < chapterInfos.length; i++) {
        expect(chapterInfos[i].chapter).toBeGreaterThan(chapterInfos[i - 1].chapter);
      }

      // Should include chapter 23 and 119
      const chapters = chapterInfos.map(c => c.chapter);
      expect(chapters).toContain(23);
      expect(chapters).toContain(119);
    });

    it('should get chapter info by book number', () => {
      // Get chapter info for Psalms using book number
      const chapterInfos = repository.getChapterInfoByBookNumber(Book.Psalms);

      expect(chapterInfos.length).toBeGreaterThan(0);

      // Should include Psalm 23 and 119
      const chapters = chapterInfos.map(c => c.chapter);
      expect(chapters).toContain(23);
      expect(chapters).toContain(119);

      // Psalm 119 is the longest chapter (176 verses)
      const psalm119 = chapterInfos.find(c => c.chapter === 119);
      expect(psalm119?.verseCount).toBe(176);
    });

    it('should return empty array for book with no chapter info', () => {
      const chapterInfos = repository.getBookChapterInfo(999);

      expect(chapterInfos).toHaveLength(0);
    });

    it('should return empty array for non-existent book number', () => {
      const chapterInfos = repository.getChapterInfoByBookNumber(99);

      expect(chapterInfos).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should handle complete book retrieval workflow', () => {
      // Search for a book
      const searchResults = repository.search('Eph');
      expect(searchResults.length).toBeGreaterThan(0);

      // Get the book by name
      const book = repository.getByName('Ephesians');
      expect(book).toBeDefined();

      // Get it by book number
      const byNumber = repository.getByBookNumber(book!.bookNumber);
      expect(byNumber?.bookName).toBe(book?.bookName);

      // Verify testament and group
      expect(book?.testament).toBe('NT');
      expect(book?.bookGroup).toBe('Pauline Epistles');
    });

    it('should handle testament and group filtering', () => {
      // Get all OT books
      const otBooks = repository.getByTestament('OT');

      // Get all Law books
      const lawBooks = repository.getByBookGroup('Law');

      // Law books should be subset of OT
      lawBooks.forEach(lawBook => {
        expect(lawBook.testament).toBe('OT');
      });

      // Genesis should be in both
      const genesis = otBooks.find(b => b.bookNumber === Book.Genesis);
      const genesisInLaw = lawBooks.find(b => b.bookNumber === Book.Genesis);

      expect(genesis).toBeDefined();
      expect(genesisInLaw).toBeDefined();
    });

    it('should handle verse count aggregation', () => {
      // Get total verse count
      const totalVerses = repository.getTotalVerseCount();

      // Get all books and sum manually
      const allBooks = repository.getAll();
      const manualSum = allBooks.reduce((sum, book) => sum + book.verseCount, 0);

      expect(totalVerses).toBe(manualSum);
      expect(totalVerses).toBeGreaterThan(0);
    });

    it('should verify book properties', () => {
      const books = [
        { num: Book.Genesis, name: 'Genesis', testament: 'OT', hasChapters: true },
        { num: Book.Psalms, name: 'Psalms', testament: 'OT', hasChapters: true },
        { num: Book.Matthew, name: 'Matthew', testament: 'NT', hasChapters: true },
        { num: Book.John, name: 'John', testament: 'NT', hasChapters: true },
        { num: Book.Philemon, name: 'Philemon', testament: 'NT', hasChapters: false }, // Single chapter
        { num: Book.Jude, name: 'Jude', testament: 'NT', hasChapters: false }, // Single chapter
        { num: Book.Revelation, name: 'Revelation', testament: 'NT', hasChapters: true },
      ];

      books.forEach(test => {
        const book = repository.getByBookNumber(test.num);

        expect(book).toBeDefined();
        expect(book?.bookName).toBe(test.name);
        expect(book?.testament).toBe(test.testament);

        if (test.hasChapters) {
          expect(book?.chapterCount).toBeGreaterThan(1);
        } else {
          expect(book?.chapterCount).toBe(1);
        }

        expect(book?.verseCount).toBeGreaterThan(0);
      });
    });
  });
});
