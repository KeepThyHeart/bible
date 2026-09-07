import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { CommentaryRepository } from '../Data/Repositories/CommentaryRepository';
import { CommentaryEntryLevel } from '../Data/Models/Commentary/CommentaryEntry';
import { VerseIdHelper, Book } from '../Data/Core/Types';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';
import { TEST_MODULES_DIR, testDataAvailable } from './helpers/testData';

// ============================================================================
// Test SQLite Provider (read-only, for module databases)
// ============================================================================

// ============================================================================
// Test Configuration
// ============================================================================

const MODULES_DIR = path.join(TEST_MODULES_DIR, 'modules');
const BARNES_DB_PATH = path.join(MODULES_DIR, 'commentary_barnes.db');
const DB_EXISTS = testDataAvailable('CommentaryRepository (Barnes)', BARNES_DB_PATH);

// ============================================================================
// Tests
// ============================================================================

describe.skipIf(!DB_EXISTS)('CommentaryRepository (Barnes)', () => {
  let provider: TestSqliteProvider;
  let repo: CommentaryRepository;

  beforeAll(() => {
    provider = new TestSqliteProvider(BARNES_DB_PATH);
    repo = new CommentaryRepository(provider);
  });

  afterAll(() => {
    provider.close();
  });

  // ==========================================================================
  // Module Info
  // ==========================================================================

  describe('getModuleInfo', () => {
    it('should return module info', () => {
      const info = repo.getModuleInfo();

      expect(info).toBeDefined();
      expect(info!.abbreviation).toBeDefined();
      expect(info!.abbreviation.length).toBeGreaterThan(0);
    });

    it('should have a full name', () => {
      const info = repo.getModuleInfo();

      expect(info).toBeDefined();
      expect(info!.fullName).toBeDefined();
      expect(info!.fullName.length).toBeGreaterThan(0);
    });

    it('should have moduleType set to commentary', () => {
      const info = repo.getModuleInfo();

      expect(info).toBeDefined();
      expect(info!.moduleType).toBe('commentary');
    });

    it('should have a language code', () => {
      const info = repo.getModuleInfo();

      expect(info).toBeDefined();
      expect(info!.languageCode).toBe('en');
    });

    it('should provide a display name', () => {
      const info = repo.getModuleInfo();

      expect(info).toBeDefined();
      const displayName = info!.getDisplayName();
      expect(displayName).toBeDefined();
      expect(displayName.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // getEntry
  // ==========================================================================

  describe('getEntry', () => {
    it('should return an entry by ID', () => {
      const entry = repo.getEntry(1);

      expect(entry).toBeDefined();
      expect(entry!.entryId).toBe(1);
      expect(entry!.content).toBeDefined();
      expect(entry!.content.length).toBeGreaterThan(0);
    });

    it('should return undefined for non-existent entry ID', () => {
      const entry = repo.getEntry(999999999);

      expect(entry).toBeUndefined();
    });

    it('should have an entry level set', () => {
      const entry = repo.getEntry(1);

      expect(entry).toBeDefined();
      const validLevels: CommentaryEntryLevel[] = ['book', 'chapter', 'passage', 'verse'];
      expect(validLevels).toContain(entry!.entryLevel);
    });
  });

  // ==========================================================================
  // getEntriesForVerse
  // ==========================================================================

  describe('getEntriesForVerse', () => {
    it('should return entries for John 3:16', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const entries = repo.getEntriesForVerse(verseId);

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);

      // At least one entry should have content
      const hasContent = entries.some(e => e.content.length > 0);
      expect(hasContent).toBe(true);
    });

    it('should return entries for Matthew 5:1 (Sermon on the Mount)', () => {
      const verseId = VerseIdHelper.calculate(Book.Matthew, 5, 1);
      const entries = repo.getEntriesForVerse(verseId);

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should return entries for Romans 8:28', () => {
      const verseId = VerseIdHelper.calculate(Book.Romans, 8, 28);
      const entries = repo.getEntriesForVerse(verseId);

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should return entries for Revelation 1:1', () => {
      const verseId = VerseIdHelper.calculate(Book.Revelation, 1, 1);
      const entries = repo.getEntriesForVerse(verseId);

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should have verse_id_start set on returned entries', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const entries = repo.getEntriesForVerse(verseId);

      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.verseIdStart).toBeDefined();
      }
    });

    it('should return empty array for non-existent verse', () => {
      // Use an invalid verse ID that wouldn't exist
      const entries = repo.getEntriesForVerse(99999999);

      expect(entries).toBeDefined();
      expect(entries.length).toBe(0);
    });
  });

  // ==========================================================================
  // getEntriesByLevel
  // ==========================================================================

  describe('getEntriesByLevel', () => {
    it('should return verse-level entries', () => {
      const entries = repo.getEntriesByLevel('verse');

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);

      // All entries should be verse-level
      for (const entry of entries) {
        expect(entry.entryLevel).toBe('verse');
      }
    });

    it('should return chapter-level entries if they exist', () => {
      const entries = repo.getEntriesByLevel('chapter');

      expect(entries).toBeDefined();
      // Barnes may or may not have chapter-level entries; just verify array and level
      for (const entry of entries) {
        expect(entry.entryLevel).toBe('chapter');
      }
    });

    it('should return entries sorted by verse_id_start', () => {
      const entries = repo.getEntriesByLevel('verse');

      expect(entries.length).toBeGreaterThan(1);
      for (let i = 1; i < Math.min(entries.length, 100); i++) {
        const prevStart = entries[i - 1].verseIdStart ?? 0;
        const currStart = entries[i].verseIdStart ?? 0;
        expect(currStart).toBeGreaterThanOrEqual(prevStart);
      }
    });

    it('should return book-level entries if they exist', () => {
      const entries = repo.getEntriesByLevel('book');

      // Just verify we get an array with correct levels
      expect(entries).toBeDefined();
      for (const entry of entries) {
        expect(entry.entryLevel).toBe('book');
      }
    });
  });

  // ==========================================================================
  // getEntriesForRange
  // ==========================================================================

  describe('getEntriesForRange', () => {
    it('should return entries for Romans 8:28-30', () => {
      const start = VerseIdHelper.calculate(Book.Romans, 8, 28);
      const end = VerseIdHelper.calculate(Book.Romans, 8, 30);
      const entries = repo.getEntriesForRange(start, end);

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should return entries for John 3:16-18', () => {
      const start = VerseIdHelper.calculate(Book.John, 3, 16);
      const end = VerseIdHelper.calculate(Book.John, 3, 18);
      const entries = repo.getEntriesForRange(start, end);

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should return entries sorted by verse_id_start', () => {
      const start = VerseIdHelper.calculate(Book.Matthew, 5, 1);
      const end = VerseIdHelper.calculate(Book.Matthew, 5, 10);
      const entries = repo.getEntriesForRange(start, end);

      expect(entries.length).toBeGreaterThan(0);
      for (let i = 1; i < entries.length; i++) {
        const prevStart = entries[i - 1].verseIdStart ?? 0;
        const currStart = entries[i].verseIdStart ?? 0;
        expect(currStart).toBeGreaterThanOrEqual(prevStart);
      }
    });

    it('should return entries that overlap with the range', () => {
      const start = VerseIdHelper.calculate(Book.Romans, 8, 28);
      const end = VerseIdHelper.calculate(Book.Romans, 8, 30);
      const entries = repo.getEntriesForRange(start, end);

      for (const entry of entries) {
        const entryStart = entry.verseIdStart ?? 0;
        const entryEnd = entry.verseIdEnd ?? entryStart;
        // Entry should overlap with [start, end]
        expect(entryEnd).toBeGreaterThanOrEqual(start);
        expect(entryStart).toBeLessThanOrEqual(end);
      }
    });

    it('should return empty array for non-existent range', () => {
      const entries = repo.getEntriesForRange(99000001, 99000010);

      expect(entries).toBeDefined();
      expect(entries.length).toBe(0);
    });
  });

  // ==========================================================================
  // searchEntries
  // ==========================================================================

  describe('searchEntries', () => {
    it('should find entries containing "faith"', () => {
      const entries = repo.searchEntries('faith');

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);

      // Entries should have content
      for (const entry of entries) {
        expect(entry.content.length).toBeGreaterThan(0);
      }
    });

    it('should find entries containing "love"', () => {
      const entries = repo.searchEntries('love');

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should find entries containing "salvation"', () => {
      const entries = repo.searchEntries('salvation');

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should respect the limit option', () => {
      const entries = repo.searchEntries('faith', { limit: 5 });

      expect(entries).toBeDefined();
      expect(entries.length).toBeLessThanOrEqual(5);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should return empty array for nonsense query', () => {
      const entries = repo.searchEntries('xyzzyplugh99');

      expect(entries).toBeDefined();
      expect(entries.length).toBe(0);
    });
  });

  // ==========================================================================
  // Navigation: getNextVerseWithContent / getPreviousVerseWithContent
  // ==========================================================================

  describe('getNextVerseWithContent', () => {
    it('should return a verse ID after John 3:15', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 15);
      const nextVerse = repo.getNextVerseWithContent(verseId);

      expect(nextVerse).toBeDefined();
      expect(nextVerse!).toBeGreaterThan(verseId);
    });

    it('should return a verse ID after Matthew 1:1', () => {
      const verseId = VerseIdHelper.calculate(Book.Matthew, 1, 1);
      const nextVerse = repo.getNextVerseWithContent(verseId);

      expect(nextVerse).toBeDefined();
      expect(nextVerse!).toBeGreaterThan(verseId);
    });

    it('should return undefined from beyond last verse', () => {
      // Use a very high verse ID beyond Revelation
      const nextVerse = repo.getNextVerseWithContent(99999999);

      expect(nextVerse).toBeUndefined();
    });
  });

  describe('getPreviousVerseWithContent', () => {
    it('should return a verse ID before John 3:17', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 17);
      const prevVerse = repo.getPreviousVerseWithContent(verseId);

      expect(prevVerse).toBeDefined();
      expect(prevVerse!).toBeLessThan(verseId);
    });

    it('should return a verse ID before Revelation 22:21', () => {
      const verseId = VerseIdHelper.calculate(Book.Revelation, 22, 21);
      const prevVerse = repo.getPreviousVerseWithContent(verseId);

      expect(prevVerse).toBeDefined();
      expect(prevVerse!).toBeLessThan(verseId);
    });

    it('should return undefined from before first verse', () => {
      const prevVerse = repo.getPreviousVerseWithContent(0);

      expect(prevVerse).toBeUndefined();
    });
  });

  // ==========================================================================
  // getAllEntrySummaries
  // ==========================================================================

  describe('getAllEntrySummaries', () => {
    it('should return a non-empty array of summaries', () => {
      const summaries = repo.getAllEntrySummaries();

      expect(summaries).toBeDefined();
      expect(summaries.length).toBeGreaterThan(0);
    });

    it('should have verseIdStart on each summary', () => {
      const summaries = repo.getAllEntrySummaries();

      expect(summaries.length).toBeGreaterThan(0);
      for (const summary of summaries.slice(0, 20)) {
        expect(summary.verseIdStart).toBeDefined();
        expect(typeof summary.verseIdStart).toBe('number');
      }
    });

    it('should have entryLevel on each summary', () => {
      const summaries = repo.getAllEntrySummaries();

      const validLevels: CommentaryEntryLevel[] = ['book', 'chapter', 'passage', 'verse'];
      for (const summary of summaries.slice(0, 20)) {
        expect(validLevels).toContain(summary.entryLevel);
      }
    });

    it('should be sorted by verseIdStart', () => {
      const summaries = repo.getAllEntrySummaries();

      expect(summaries.length).toBeGreaterThan(1);
      for (let i = 1; i < Math.min(summaries.length, 100); i++) {
        expect(summaries[i].verseIdStart).toBeGreaterThanOrEqual(summaries[i - 1].verseIdStart);
      }
    });
  });

  // ==========================================================================
  // Entry Content Verification
  // ==========================================================================

  describe('entry content verification', () => {
    it('should have non-empty content for John 3:16 entry', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const entries = repo.getEntriesForVerse(verseId);

      expect(entries.length).toBeGreaterThan(0);
      const entry = entries[0];
      expect(entry.content).toBeDefined();
      expect(entry.content.length).toBeGreaterThan(10); // should be substantial commentary
    });

    it('should support getExcerpt on entries', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const entries = repo.getEntriesForVerse(verseId);

      expect(entries.length).toBeGreaterThan(0);
      const excerpt = entries[0].getExcerpt(50);
      expect(excerpt).toBeDefined();
      expect(excerpt.length).toBeLessThanOrEqual(54); // 50 + "..."
    });

    it('should correctly identify entry level with helper methods', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const entries = repo.getEntriesForVerse(verseId);

      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        // Exactly one of the level checks should be true
        const levels = [
          entry.isBookLevel(),
          entry.isChapterLevel(),
          entry.isVerseLevel(),
          entry.entryLevel === 'passage',
        ];
        const trueCount = levels.filter(Boolean).length;
        expect(trueCount).toBe(1);
      }
    });
  });
});
