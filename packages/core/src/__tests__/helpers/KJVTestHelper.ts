/**
 * KJV Test Helper
 *
 * Provides access to the real KJV Bible database for testing.
 * This ensures tests use actual SQLite FTS5 behavior, indexing, and real verse data.
 */

import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { ISql } from '../../Data/Core/ISql';
import { BibleRepository } from '../../Data/Repositories/BibleRepository';
import { BibleBookRepository } from '../../Data/Repositories/BibleBookRepository';
import { IBibleRepository } from '../../Data/Repositories/IBibleRepository';
import { IBibleBookRepository } from '../../Data/Repositories/IBibleBookRepository';
import { VerseId, VerseIdHelper, Book } from '../../Data/Core/Types';
import { TestSqliteProvider } from './TestSqliteProvider';

/**
 * Paths to test databases (relative to core package)
 */
const KJV_DB_PATH = path.resolve(__dirname, '../../../../desktop/data/modules/bible_kjv.db');
const MAIN_DB_PATH = path.resolve(__dirname, '../../../../desktop/data/main.db');

/**
 * Test helper class for KJV database access
 */
export class KJVTestHelper {
  private static kjvProvider: TestSqliteProvider | null = null;
  private static mainProvider: TestSqliteProvider | null = null;
  private static kjvRepository: IBibleRepository | null = null;
  private static bibleBookRepository: IBibleBookRepository | null = null;

  /**
   * Verify that the KJV module database exists
   * Throws clear error if not found
   */
  static verifyKJVAvailable(): void {
    if (!fs.existsSync(KJV_DB_PATH)) {
      throw new Error(
        `KJV module not found at: ${KJV_DB_PATH}\n` +
        `Please ensure the bible_kjv.db database exists in the desktop package data directory.\n` +
        `Run module import/build scripts if needed.`
      );
    }

    if (!fs.existsSync(MAIN_DB_PATH)) {
      throw new Error(
        `Main database not found at: ${MAIN_DB_PATH}\n` +
        `Please ensure the main.db database exists in the desktop package data directory.`
      );
    }
  }

  /**
   * Probe the KJV fixture for interlinear word data.
   *
   * Usable at module scope (before initialize()) because it opens and closes
   * its own connection. Suites that assert on interlinear content use this to
   * skip themselves when the shipped KJV module carries no interlinear_word
   * rows - that data is optional and not present in every build of the module.
   */
  static hasInterlinearData(): boolean {
    if (!fs.existsSync(KJV_DB_PATH)) {
      return false;
    }

    let db: Database.Database | undefined;
    try {
      db = new Database(KJV_DB_PATH, { readonly: true, fileMustExist: true });
      const table = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='interlinear_word'`)
        .get();
      if (!table) {
        return false;
      }
      return db.prepare('SELECT 1 FROM interlinear_word LIMIT 1').get() !== undefined;
    } catch {
      return false;
    } finally {
      db?.close();
    }
  }

  /**
   * Initialize database connections
   * Call this in beforeAll() hooks
   */
  static initialize(): void {
    this.verifyKJVAvailable();

    // Open database connections in read-only mode
    this.kjvProvider = new TestSqliteProvider(KJV_DB_PATH, { readonly: true });
    this.mainProvider = new TestSqliteProvider(MAIN_DB_PATH, { readonly: true });

    // Create repository instances
    this.kjvRepository = new BibleRepository(this.kjvProvider);
    this.bibleBookRepository = new BibleBookRepository(this.mainProvider);
  }

  /**
   * Close database connections
   * Call this in afterAll() hooks
   */
  static cleanup(): void {
    if (this.kjvProvider) {
      this.kjvProvider.close();
      this.kjvProvider = null;
    }

    if (this.mainProvider) {
      this.mainProvider.close();
      this.mainProvider = null;
    }

    this.kjvRepository = null;
    this.bibleBookRepository = null;
  }

  /**
   * Get the KJV Bible repository
   */
  static getKJVRepository(): IBibleRepository {
    if (!this.kjvRepository) {
      throw new Error('KJVTestHelper not initialized. Call initialize() first.');
    }
    return this.kjvRepository;
  }

  /**
   * Get the Bible Book repository (from main.db)
   */
  static getBibleBookRepository(): IBibleBookRepository {
    if (!this.bibleBookRepository) {
      throw new Error('KJVTestHelper not initialized. Call initialize() first.');
    }
    return this.bibleBookRepository;
  }

  /**
   * Get the KJV SQL provider (for creating additional repositories)
   */
  static getKJVProvider(): ISql {
    if (!this.kjvProvider) {
      throw new Error('KJVTestHelper not initialized. Call initialize() first.');
    }
    return this.kjvProvider;
  }

  /**
   * Get the Main SQL provider (for creating additional repositories)
   */
  static getMainProvider(): ISql {
    if (!this.mainProvider) {
      throw new Error('KJVTestHelper not initialized. Call initialize() first.');
    }
    return this.mainProvider;
  }

  // ========================================================================
  // Convenience Methods for Common Test Verses
  // ========================================================================

  /**
   * Get John 3:16 - "For God so loved the world..."
   * Most famous verse, good for basic tests
   */
  static getJohn3_16() {
    const repo = this.getKJVRepository();
    const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
    return repo.getVerse(verseId);
  }

  /**
   * Get Romans 8:28-30
   * Good for testing verse ranges
   */
  static getRomans8_28to30() {
    const repo = this.getKJVRepository();
    const start = VerseIdHelper.calculate(Book.Romans, 8, 28);
    const end = VerseIdHelper.calculate(Book.Romans, 8, 30);
    return repo.getVerseRange(start, end);
  }

  /**
   * Get Proverbs 6:6-11
   * Contains "ant" and "sluggard" for proximity search tests
   */
  static getProverbs6_6to11() {
    const repo = this.getKJVRepository();
    const start = VerseIdHelper.calculate(Book.Proverbs, 6, 6);
    const end = VerseIdHelper.calculate(Book.Proverbs, 6, 11);
    return repo.getVerseRange(start, end);
  }

  /**
   * Get Psalm 23 (entire chapter)
   * Good for testing chapter retrieval
   */
  static getPsalm23() {
    const repo = this.getKJVRepository();
    return repo.getChapter(Book.Psalms, 23);
  }

  /**
   * Get 1 Corinthians 13 (entire chapter)
   * Contains "charity" and phrase "greatest of these" for search tests
   */
  static get1Corinthians13() {
    const repo = this.getKJVRepository();
    return repo.getChapter(Book.FirstCorinthians, 13);
  }

  /**
   * Get Genesis 1:1 - First verse of the Bible
   */
  static getGenesis1_1() {
    const repo = this.getKJVRepository();
    const verseId = VerseIdHelper.calculate(Book.Genesis, 1, 1);
    return repo.getVerse(verseId);
  }

  /**
   * Get Revelation 22:21 - Last verse of the Bible
   */
  static getRevelation22_21() {
    const repo = this.getKJVRepository();
    const verseId = VerseIdHelper.calculate(Book.Revelation, 22, 21);
    return repo.getVerse(verseId);
  }

  // ========================================================================
  // Search Testing Helpers
  // ========================================================================

  /**
   * Search for a term and return verse IDs
   * Useful for verifying search results
   */
  static searchTerm(term: string, limit: number = 100): VerseId[] {
    const repo = this.getKJVRepository();
    const verses = repo.searchVerses(term, { limit });
    return verses.map(v => v.verseId);
  }

  /**
   * Count how many verses contain a term
   */
  static countVersesWithTerm(term: string): number {
    const repo = this.getKJVRepository();
    const verses = repo.searchVerses(term, { limit: 10000 });
    return verses.length;
  }

  /**
   * Get actual verse text for verification
   */
  static getVerseText(verseId: VerseId): string | undefined {
    const repo = this.getKJVRepository();
    const verse = repo.getVerse(verseId);
    return verse?.textPlain || verse?.text;
  }

  /**
   * Get book name from book number
   */
  static getBookName(bookNumber: number): string | undefined {
    const repo = this.getBibleBookRepository();
    const book = repo.getByBookNumber(bookNumber);
    return book?.bookName;
  }
}
