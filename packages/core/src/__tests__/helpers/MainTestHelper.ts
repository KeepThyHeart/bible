import * as path from 'path';
import { loadSchemaSql } from '../../Data/Schema';
import { ISql } from '../../Data/Core/ISql';
import { BibleBookRepository } from '../../Data/Repositories/BibleBookRepository';
import { Book } from '../../Data/Core/Types';
import { TestSqliteProvider } from './TestSqliteProvider';
import { randomUUID } from 'node:crypto';

/**
 * Test helper for main database testing
 * Creates an in-memory main database with test Bible book data
 */
export class MainTestHelper {
  private static provider: TestSqliteProvider | null = null;
  private static repository: BibleBookRepository | null = null;

  static initialize(): void {
    // Create in-memory database
    this.provider = new TestSqliteProvider(':memory:');

    // Create bible_book table
    this.provider.execute(`
      CREATE TABLE bible_book (
        book_id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_number INTEGER NOT NULL UNIQUE,
        book_name TEXT NOT NULL,
        book_abbreviation TEXT,
        testament TEXT NOT NULL CHECK (testament IN ('OT', 'NT')),
        book_group TEXT,
        chapter_count INTEGER NOT NULL,
        verse_count INTEGER NOT NULL,
        metadata TEXT,
        CHECK (book_number > 0 AND book_number <= 66)
      )
    `);

    // Create chapter_info table
    this.provider.execute(`
      CREATE TABLE chapter_info (
        chapter_info_id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        chapter INTEGER NOT NULL,
        verse_count INTEGER NOT NULL,
        first_absolute_id INTEGER NOT NULL,
        last_absolute_id INTEGER NOT NULL,
        metadata TEXT,
        FOREIGN KEY (book_id) REFERENCES bible_book(book_id) ON DELETE CASCADE,
        UNIQUE (book_id, chapter)
      )
    `);

    // Add test Bible books (representative set)
    const books = [
      // OT - Law
      { bookNumber: Book.Genesis, name: 'Genesis', abbr: 'Gen', testament: 'OT', group: 'Law', chapters: 50, verses: 1533 },
      { bookNumber: Book.Exodus, name: 'Exodus', abbr: 'Exod', testament: 'OT', group: 'Law', chapters: 40, verses: 1213 },

      // OT - History
      { bookNumber: Book.Ruth, name: 'Ruth', abbr: 'Ruth', testament: 'OT', group: 'History', chapters: 4, verses: 85 },

      // OT - Wisdom
      { bookNumber: Book.Psalms, name: 'Psalms', abbr: 'Ps', testament: 'OT', group: 'Wisdom', chapters: 150, verses: 2461 },

      // OT - Major Prophets
      { bookNumber: Book.Isaiah, name: 'Isaiah', abbr: 'Isa', testament: 'OT', group: 'Major Prophets', chapters: 66, verses: 1292 },

      // NT - Gospels
      { bookNumber: Book.Matthew, name: 'Matthew', abbr: 'Matt', testament: 'NT', group: 'Gospels', chapters: 28, verses: 1071 },
      { bookNumber: Book.John, name: 'John', abbr: 'John', testament: 'NT', group: 'Gospels', chapters: 21, verses: 879 },

      // NT - History
      { bookNumber: Book.Acts, name: 'Acts', abbr: 'Acts', testament: 'NT', group: 'History', chapters: 28, verses: 1007 },

      // NT - Paul's Letters
      { bookNumber: Book.Romans, name: 'Romans', abbr: 'Rom', testament: 'NT', group: 'Pauline Epistles', chapters: 16, verses: 433 },
      { bookNumber: Book.FirstCorinthians, name: '1 Corinthians', abbr: '1Cor', testament: 'NT', group: 'Pauline Epistles', chapters: 16, verses: 437 },
      { bookNumber: Book.Ephesians, name: 'Ephesians', abbr: 'Eph', testament: 'NT', group: 'Pauline Epistles', chapters: 6, verses: 155 },
      { bookNumber: Book.Philemon, name: 'Philemon', abbr: 'Phlm', testament: 'NT', group: 'Pauline Epistles', chapters: 1, verses: 25 },

      // NT - General Epistles
      { bookNumber: Book.Hebrews, name: 'Hebrews', abbr: 'Heb', testament: 'NT', group: 'General Epistles', chapters: 13, verses: 303 },
      { bookNumber: Book.Jude, name: 'Jude', abbr: 'Jude', testament: 'NT', group: 'General Epistles', chapters: 1, verses: 25 },

      // NT - Prophecy
      { bookNumber: Book.Revelation, name: 'Revelation', abbr: 'Rev', testament: 'NT', group: 'Prophecy', chapters: 22, verses: 404 },
    ];

    for (const book of books) {
      this.provider.execute(
        `INSERT INTO bible_book (
          book_number, book_name, book_abbreviation, testament, book_group,
          chapter_count, verse_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [book.bookNumber, book.name, book.abbr, book.testament, book.group, book.chapters, book.verses]
      );
    }

    // Add chapter info for a few books for testing
    // Genesis chapter 1 (31 verses)
    this.provider.execute(
      `INSERT INTO chapter_info (book_id, chapter, verse_count, first_absolute_id, last_absolute_id)
       VALUES (?, 1, 31, ?, ?)`,
      [1, 1001001, 1001031] // book_id 1 = Genesis
    );

    // Psalms chapter 23 (6 verses)
    this.provider.execute(
      `INSERT INTO chapter_info (book_id, chapter, verse_count, first_absolute_id, last_absolute_id)
       VALUES (?, 23, 6, ?, ?)`,
      [4, 19023001, 19023006] // book_id 4 = Psalms
    );

    // Psalms chapter 119 (176 verses - longest chapter)
    this.provider.execute(
      `INSERT INTO chapter_info (book_id, chapter, verse_count, first_absolute_id, last_absolute_id)
       VALUES (?, 119, 176, ?, ?)`,
      [4, 19119001, 19119176]
    );

    // John chapter 3 (36 verses)
    this.provider.execute(
      `INSERT INTO chapter_info (book_id, chapter, verse_count, first_absolute_id, last_absolute_id)
       VALUES (?, 3, 36, ?, ?)`,
      [7, 43003001, 43003036] // book_id 7 = John
    );

    // Create repository
    this.repository = new BibleBookRepository(this.provider);
  }

  static getRepository(): BibleBookRepository {
    if (!this.repository) {
      throw new Error('MainTestHelper not initialized. Call initialize() first.');
    }
    return this.repository;
  }

  static getProvider(): ISql {
    if (!this.provider) {
      throw new Error('MainTestHelper not initialized. Call initialize() first.');
    }
    return this.provider;
  }

  static cleanup(): void {
    if (this.provider) {
      this.provider.close();
      this.provider = null;
      this.repository = null;
    }
  }

  /**
   * Initialize with the full main.db schema from `sql/schemas/initial/`.
   * Use this when testing ModuleMetadata, ModuleCatalog, ModuleUpdate,
   * DownloadQueue, BibleSearch, or SavedSearch repositories.
   */
  static initializeWithFullSchema(): void {
    this.provider = new TestSqliteProvider(':memory:');

    const stripPragmas = (sql: string) =>
      sql.split('\n').map(line => line.match(/^\s*PRAGMA\s/i) ? `-- ${line}` : line).join('\n');

    // The initial schema is the current release schema: it already contains the
    // module-manager tables (module_repository, module_download_queue,
    // module_update) and the search tables (FTS5, saved_search, search_history).
    const schemaPath = path.resolve(__dirname, '../../../sql/schemas/initial/MainDatabase.sql');
    this.provider.exec(stripPragmas(loadSchemaSql(schemaPath)));

    // Create repository for backward compat
    this.repository = new BibleBookRepository(this.provider);
  }

  /**
   * Clear all main database data tables (for test isolation).
   * Preserves schema but removes all rows. Deletes in FK-safe order.
   */
  static clearData(): void {
    const provider = this.getProvider() as TestSqliteProvider;
    const tables = [
      'search_history',
      'saved_search',
      'bible_search_verse_positions',
      'bible_search_index_metadata',
      'module_update',
      'module_download_queue',
      'module_repository',
      'module_metadata',
      'chapter_info',
      'bible_book',
    ];

    for (const table of tables) {
      try {
        provider.execute(`DELETE FROM ${table}`);
      } catch (_e) {
        // Table may not exist
      }
    }

    // Clear FTS5 virtual table separately
    try {
      provider.execute(`DELETE FROM bible_search_index`);
    } catch (_e) {
      // FTS5 may not be available
    }
  }

  /**
   * Insert a sample module_metadata row for FK references.
   * Returns the module_id.
   */
  static insertSampleModule(overrides?: Partial<{
    moduleUuid: string;
    moduleType: string;
    moduleName: string;
    abbreviation: string;
    databasePath: string;
    languageCode: string;
  }>): number {
    const provider = this.getProvider();
    const result = provider.execute(
      `INSERT INTO module_metadata (module_uuid, module_type, module_name, abbreviation, database_path, language_code, is_indexed)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [
        // module_uuid is NOT NULL and UNIQUE, so a fixed literal would make a
        // second call in the same test collide. Generated per insert; pass an
        // override when a test needs to look the module up by UUID.
        overrides?.moduleUuid ?? randomUUID(),
        overrides?.moduleType ?? 'bible',
        overrides?.moduleName ?? 'King James Version',
        overrides?.abbreviation ?? 'KJV',
        overrides?.databasePath ?? 'modules/bible_kjv.db',
        overrides?.languageCode ?? 'en',
      ]
    );
    // `SqlResult.lastInsertRowId` is optional, because not every statement
    // produces one. An INSERT always does, so a missing id means the insert
    // did not happen - better to say so than to hand back a plausible number.
    if (result.lastInsertRowId === undefined) {
      throw new Error('Module insert returned no row id');
    }
    return result.lastInsertRowId;
  }
}
