import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { DictionaryRepository } from '../Data/Repositories/DictionaryRepository';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';
import { TEST_MODULES_DIR, testDataAvailable } from './helpers/testData';

// ============================================================================
// Test SQLite Provider (read-only, for module databases)
// ============================================================================

// ============================================================================
// Test Configuration
// ============================================================================

const MODULES_DIR = path.join(TEST_MODULES_DIR, 'modules');
const EASTON_DB_PATH = path.join(MODULES_DIR, 'dictionary_easton.db');
const DB_EXISTS = testDataAvailable('DictionaryRepository (Easton)', EASTON_DB_PATH);

// ============================================================================
// Tests
// ============================================================================

describe.skipIf(!DB_EXISTS)('DictionaryRepository (Easton)', () => {
  let provider: TestSqliteProvider;
  let repo: DictionaryRepository;

  beforeAll(() => {
    provider = new TestSqliteProvider(EASTON_DB_PATH);
    repo = new DictionaryRepository(provider);
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

    it('should have moduleType set to dictionary', () => {
      const info = repo.getModuleInfo();

      expect(info).toBeDefined();
      expect(info!.moduleType).toBe('dictionary');
    });

    it('should have a dictionary type', () => {
      const info = repo.getModuleInfo();

      expect(info).toBeDefined();
      expect(info!.dictionaryType).toBeDefined();
    });

    it('should provide a display name with type description', () => {
      const info = repo.getModuleInfo();

      expect(info).toBeDefined();
      const displayName = info!.getDisplayName();
      expect(displayName).toBeDefined();
      expect(displayName.length).toBeGreaterThan(0);
      // Display name includes the type in parentheses
      expect(displayName).toContain('(');
    });

    it('should provide a type description', () => {
      const info = repo.getModuleInfo();

      expect(info).toBeDefined();
      const typeDesc = info!.getTypeDescription();
      expect(typeDesc).toBeDefined();
      expect(typeDesc.length).toBeGreaterThan(0);
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
      expect(entry!.entryKey).toBeDefined();
      expect(entry!.definition).toBeDefined();
      expect(entry!.definition.length).toBeGreaterThan(0);
    });

    it('should return undefined for non-existent entry ID', () => {
      const entry = repo.getEntry(999999999);

      expect(entry).toBeUndefined();
    });

    it('should have an entry key set', () => {
      const entry = repo.getEntry(1);

      expect(entry).toBeDefined();
      expect(entry!.entryKey).toBeDefined();
      expect(entry!.entryKey.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // getEntryByKey
  // ==========================================================================

  describe('getEntryByKey', () => {
    it('should find "Moses" by exact key', () => {
      const entry = repo.getEntryByKey('Moses');

      expect(entry).toBeDefined();
      expect(entry!.entryKey.toLowerCase()).toBe('moses');
      expect(entry!.definition).toBeDefined();
      expect(entry!.definition.length).toBeGreaterThan(0);
    });

    it('should find "Jerusalem" by exact key', () => {
      const entry = repo.getEntryByKey('Jerusalem');

      expect(entry).toBeDefined();
      expect(entry!.entryKey.toLowerCase()).toBe('jerusalem');
      expect(entry!.definition.length).toBeGreaterThan(0);
    });

    it('should find entries case-insensitively', () => {
      const entry = repo.getEntryByKey('moses');

      expect(entry).toBeDefined();
      expect(entry!.entryKey.toLowerCase()).toBe('moses');
    });

    it('should find entries with different casing', () => {
      const entry = repo.getEntryByKey('MOSES');

      expect(entry).toBeDefined();
      expect(entry!.entryKey.toLowerCase()).toBe('moses');
    });

    it('should return undefined for non-existent key', () => {
      const entry = repo.getEntryByKey('XyzzyPlugh99NonExistent');

      expect(entry).toBeUndefined();
    });

    it('should find "Abraham"', () => {
      const entry = repo.getEntryByKey('Abraham');

      expect(entry).toBeDefined();
      expect(entry!.definition.length).toBeGreaterThan(0);
    });

    it('should find "David"', () => {
      const entry = repo.getEntryByKey('David');

      expect(entry).toBeDefined();
      expect(entry!.definition.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // getAllEntries (pagination)
  // ==========================================================================

  describe('getAllEntries', () => {
    it('should return entries with default pagination', () => {
      const entries = repo.getAllEntries();

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should respect limit option', () => {
      const entries = repo.getAllEntries({ limit: 10 });

      expect(entries).toBeDefined();
      expect(entries.length).toBeLessThanOrEqual(10);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should respect offset option', () => {
      const firstPage = repo.getAllEntries({ limit: 5, offset: 0 });
      const secondPage = repo.getAllEntries({ limit: 5, offset: 5 });

      expect(firstPage.length).toBe(5);
      expect(secondPage.length).toBe(5);

      // Pages should not overlap
      const firstKeys = firstPage.map(e => e.entryKey);
      const secondKeys = secondPage.map(e => e.entryKey);
      for (const key of secondKeys) {
        expect(firstKeys).not.toContain(key);
      }
    });

    it('should return entries sorted by entry_key', () => {
      const entries = repo.getAllEntries({ limit: 20 });

      expect(entries.length).toBeGreaterThan(1);
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].entryKey.localeCompare(entries[i - 1].entryKey)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ==========================================================================
  // searchEntries (FTS)
  // ==========================================================================

  describe('searchEntries', () => {
    it('should find entries containing "covenant"', () => {
      const entries = repo.searchEntries('covenant');

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);

      // Entries should have definitions
      for (const entry of entries) {
        expect(entry.definition.length).toBeGreaterThan(0);
      }
    });

    it('should find entries containing "temple"', () => {
      const entries = repo.searchEntries('temple');

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should find entries containing "baptism"', () => {
      const entries = repo.searchEntries('baptism');

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should respect limit option', () => {
      const entries = repo.searchEntries('temple', { limit: 3 });

      expect(entries).toBeDefined();
      expect(entries.length).toBeLessThanOrEqual(3);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should return empty array for nonsense query', () => {
      const entries = repo.searchEntries('xyzzyplugh99');

      expect(entries).toBeDefined();
      expect(entries.length).toBe(0);
    });
  });

  // ==========================================================================
  // searchByTitle
  // ==========================================================================

  describe('searchByTitle', () => {
    it('should find entries matching "Abr" (prefix of Abraham)', () => {
      const entries = repo.searchByTitle('Abr');

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);

      // Should find Abraham among the results
      const keys = entries.map(e => e.entryKey.toLowerCase());
      const hasAbraham = keys.some(k => k.includes('abr'));
      expect(hasAbraham).toBe(true);
    });

    it('should find entries matching "Mos" (prefix of Moses)', () => {
      const entries = repo.searchByTitle('Mos');

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);

      const keys = entries.map(e => e.entryKey.toLowerCase());
      const hasMoses = keys.some(k => k.includes('mos'));
      expect(hasMoses).toBe(true);
    });

    it('should prioritize exact matches over partial matches', () => {
      const entries = repo.searchByTitle('Abraham');

      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);

      // First result should be Abraham (exact or starts-with match)
      expect(entries[0].entryKey.toLowerCase()).toContain('abraham');
    });

    it('should respect limit option', () => {
      const entries = repo.searchByTitle('A', { limit: 5 });

      expect(entries).toBeDefined();
      expect(entries.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array for non-matching prefix', () => {
      const entries = repo.searchByTitle('Xyzzy99');

      expect(entries).toBeDefined();
      expect(entries.length).toBe(0);
    });
  });

  // ==========================================================================
  // getOccurrences
  //
  // v2 makes `word_occurrence` part of the dictionary contract, so every module
  // has the table - SWORD sources supply no occurrence data, so it ships empty
  // and is populated by Strong's-mapping tooling. These tests previously
  // asserted that the call THREW because Easton lacked the table; under v2 the
  // correct behaviour is an empty result, not an error.
  // ==========================================================================

  describe('getOccurrences', () => {
    it('returns an empty list when the module ships no occurrence data', () => {
      expect(repo.getOccurrences('Moses')).toEqual([]);
    });

    it('returns an empty list for a key that does not exist', () => {
      expect(repo.getOccurrences('XyzzyNonExistent99')).toEqual([]);
    });
  });

  // ==========================================================================
  // Entry Content Verification
  // ==========================================================================

  describe('entry content verification', () => {
    it('should have non-empty definition for Moses', () => {
      const entry = repo.getEntryByKey('Moses');

      expect(entry).toBeDefined();
      expect(entry!.definition.length).toBeGreaterThan(10);
    });

    it('should support getDefinitionExcerpt', () => {
      const entry = repo.getEntryByKey('Moses');

      expect(entry).toBeDefined();
      const excerpt = entry!.getDefinitionExcerpt(50);
      expect(excerpt).toBeDefined();
      expect(excerpt.length).toBeLessThanOrEqual(54); // 50 + "..."
    });

    it('should have entryKey and definition on all paginated entries', () => {
      const entries = repo.getAllEntries({ limit: 10 });

      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.entryKey).toBeDefined();
        expect(entry.entryKey.length).toBeGreaterThan(0);
        expect(entry.definition).toBeDefined();
      }
    });

    it('should correctly report isStrongsEntry for regular dictionary entries', () => {
      const entry = repo.getEntryByKey('Moses');

      expect(entry).toBeDefined();
      // Easton entries are not Strong's numbers
      expect(entry!.isStrongsEntry()).toBe(false);
    });

    it('should correctly report getStrongsLanguage as null for regular entries', () => {
      const entry = repo.getEntryByKey('Moses');

      expect(entry).toBeDefined();
      expect(entry!.getStrongsLanguage()).toBeNull();
    });
  });
});
