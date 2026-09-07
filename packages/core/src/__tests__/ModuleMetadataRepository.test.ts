import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainTestHelper } from './helpers/MainTestHelper';
import { ModuleMetadataRepository } from '../Data/Repositories/ModuleMetadataRepository';
import { ModuleMetadata, ModuleFeature } from '../Data/Models/Main/ModuleMetadata';
import { ModuleType } from '../Data/Core/Types';
import { randomUUID } from 'node:crypto';

describe('ModuleMetadataRepository', () => {
  let repo: ModuleMetadataRepository;

  beforeAll(() => {
    MainTestHelper.initializeWithFullSchema();
    repo = new ModuleMetadataRepository(MainTestHelper.getProvider());
  });

  afterAll(() => {
    MainTestHelper.cleanup();
  });

  beforeEach(() => {
    MainTestHelper.clearData();
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  function createTestModule(overrides: Partial<{
    moduleUuid: string;
    moduleType: ModuleType;
    moduleName: string;
    abbreviation: string;
    version: string;
    languageCode: string;
    installedDate: string;
    lastUpdated: string;
    databasePath: string;
    sizeBytes: number;
    isIndexed: boolean;
    lastIndexedDate: string;
    features: ModuleFeature[];
    swordMetadata: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }> = {}): ModuleMetadata {
    return new ModuleMetadata({
      // module_uuid is NOT NULL and UNIQUE: generated per call so two modules
      // in one test do not collide. Override it to look a module up by UUID.
      moduleUuid: overrides.moduleUuid ?? randomUUID(),
      moduleType: overrides.moduleType ?? 'bible',
      moduleName: overrides.moduleName ?? 'King James Version',
      abbreviation: overrides.abbreviation ?? 'KJV',
      version: overrides.version,
      languageCode: overrides.languageCode ?? 'en',
      installedDate: overrides.installedDate ?? '2024-01-01T00:00:00.000Z',
      lastUpdated: overrides.lastUpdated,
      databasePath: overrides.databasePath ?? 'modules/bible_kjv.db',
      sizeBytes: overrides.sizeBytes,
      isIndexed: overrides.isIndexed ?? false,
      lastIndexedDate: overrides.lastIndexedDate,
      features: overrides.features ?? [],
      swordMetadata: overrides.swordMetadata,
      metadata: overrides.metadata,
    });
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  describe('create', () => {
    it('should create a module and return it with an assigned ID', () => {
      const module = createTestModule();
      const created = repo.create(module);

      expect(created.moduleId).toBeDefined();
      expect(created.moduleId).toBeGreaterThan(0);
      expect(created.moduleName).toBe('King James Version');
      expect(created.abbreviation).toBe('KJV');
      expect(created.moduleType).toBe('bible');
    });

    it('should create a module with all optional fields populated', () => {
      const module = createTestModule({
        version: '1.2.0',
        sizeBytes: 5242880,
        features: ['strongs_numbers', 'red_letter'],
        swordMetadata: { source: 'CrossWire', osisName: 'KJV' },
        metadata: { description: 'The 1769 authorized version', importDate: '2024-06-01' },
      });

      const created = repo.create(module);
      const fetched = repo.getById(created.moduleId!);

      expect(fetched).toBeDefined();
      expect(fetched!.version).toBe('1.2.0');
      expect(fetched!.sizeBytes).toBe(5242880);
      expect(fetched!.features).toEqual(['strongs_numbers', 'red_letter']);
      expect(fetched!.swordMetadata).toEqual({ source: 'CrossWire', osisName: 'KJV' });
      expect(fetched!.metadata).toEqual({ description: 'The 1769 authorized version', importDate: '2024-06-01' });
    });
  });

  describe('getById', () => {
    it('should return module by ID', () => {
      const created = repo.create(createTestModule());
      const fetched = repo.getById(created.moduleId!);

      expect(fetched).toBeDefined();
      expect(fetched!.moduleId).toBe(created.moduleId);
      expect(fetched!.moduleName).toBe('King James Version');
    });

    it('should return undefined for nonexistent ID', () => {
      const result = repo.getById(99999);
      expect(result).toBeUndefined();
    });
  });

  describe('getByAbbreviation', () => {
    it('should return module by abbreviation', () => {
      repo.create(createTestModule({ abbreviation: 'ESV' }));
      const fetched = repo.getByAbbreviation('ESV');

      expect(fetched).toBeDefined();
      expect(fetched!.abbreviation).toBe('ESV');
    });

    it('should return undefined for nonexistent abbreviation', () => {
      const result = repo.getByAbbreviation('NONEXISTENT');
      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update an existing module', () => {
      const created = repo.create(createTestModule());
      created.moduleName = 'King James Version (Updated)';
      created.version = '2.0.0';

      const updated = repo.update(created);
      expect(updated.moduleName).toBe('King James Version (Updated)');

      const fetched = repo.getById(created.moduleId!);
      expect(fetched!.moduleName).toBe('King James Version (Updated)');
      expect(fetched!.version).toBe('2.0.0');
    });

    it('should throw when updating without an ID', () => {
      const module = createTestModule();
      expect(() => repo.update(module)).toThrow('Cannot update module without ID');
    });
  });

  describe('delete', () => {
    it('should delete an existing module and return true', () => {
      const created = repo.create(createTestModule());
      const result = repo.delete(created.moduleId!);

      expect(result).toBe(true);
      expect(repo.getById(created.moduleId!)).toBeUndefined();
    });

    it('should return false when deleting a nonexistent module', () => {
      const result = repo.delete(99999);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // getAll with pagination and ordering
  // ==========================================================================

  describe('getAll', () => {
    it('should return all modules ordered by name by default', () => {
      repo.create(createTestModule({ moduleName: 'Zondervan NIV', abbreviation: 'NIV' }));
      repo.create(createTestModule({ moduleName: 'American Standard Version', abbreviation: 'ASV' }));
      repo.create(createTestModule({ moduleName: 'King James Version', abbreviation: 'KJV' }));

      const all = repo.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].moduleName).toBe('American Standard Version');
      expect(all[1].moduleName).toBe('King James Version');
      expect(all[2].moduleName).toBe('Zondervan NIV');
    });

    it('should support limit and offset for pagination', () => {
      repo.create(createTestModule({ moduleName: 'Alpha', abbreviation: 'A', databasePath: 'a.db' }));
      repo.create(createTestModule({ moduleName: 'Beta', abbreviation: 'B', databasePath: 'b.db' }));
      repo.create(createTestModule({ moduleName: 'Gamma', abbreviation: 'C', databasePath: 'c.db' }));
      repo.create(createTestModule({ moduleName: 'Delta', abbreviation: 'D', databasePath: 'd.db' }));

      const page = repo.getAll({ limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
      expect(page[0].moduleName).toBe('Beta');
      expect(page[1].moduleName).toBe('Delta');
    });

    it('should support custom ordering', () => {
      repo.create(createTestModule({ moduleName: 'First', abbreviation: 'F', databasePath: 'f.db', moduleType: 'commentary' }));
      repo.create(createTestModule({ moduleName: 'Second', abbreviation: 'S', databasePath: 's.db', moduleType: 'bible' }));

      const desc = repo.getAll({ orderBy: 'module_name', orderDirection: 'DESC' });
      expect(desc[0].moduleName).toBe('Second');
      expect(desc[1].moduleName).toBe('First');
    });

    it('should return empty array when no modules exist', () => {
      const all = repo.getAll();
      expect(all).toEqual([]);
    });
  });

  // ==========================================================================
  // Filtering methods
  // ==========================================================================

  describe('getByType', () => {
    it('should return only modules of the specified type', () => {
      repo.create(createTestModule({ moduleType: 'bible', moduleName: 'KJV Bible', abbreviation: 'KJV' }));
      repo.create(createTestModule({ moduleType: 'commentary', moduleName: 'Matthew Henry', abbreviation: 'MHC', databasePath: 'mhc.db' }));
      repo.create(createTestModule({ moduleType: 'bible', moduleName: 'ESV Bible', abbreviation: 'ESV', databasePath: 'esv.db' }));
      repo.create(createTestModule({ moduleType: 'dictionary', moduleName: 'Strongs Dict', abbreviation: 'STR', databasePath: 'str.db' }));

      const bibles = repo.getByType('bible');
      expect(bibles).toHaveLength(2);
      expect(bibles.every(m => m.moduleType === 'bible')).toBe(true);

      const commentaries = repo.getByType('commentary');
      expect(commentaries).toHaveLength(1);
      expect(commentaries[0].moduleName).toBe('Matthew Henry');
    });

    it('should return empty array when no modules match the type', () => {
      repo.create(createTestModule({ moduleType: 'bible' }));
      const result = repo.getByType('devotional');
      expect(result).toEqual([]);
    });
  });

  describe('getByLanguage', () => {
    it('should return modules filtered by language code', () => {
      repo.create(createTestModule({ languageCode: 'en', moduleName: 'KJV', abbreviation: 'KJV' }));
      repo.create(createTestModule({ languageCode: 'es', moduleName: 'Reina Valera', abbreviation: 'RVR', databasePath: 'rvr.db' }));
      repo.create(createTestModule({ languageCode: 'en', moduleName: 'ESV', abbreviation: 'ESV', databasePath: 'esv.db' }));

      const english = repo.getByLanguage('en');
      expect(english).toHaveLength(2);
      expect(english.every(m => m.languageCode === 'en')).toBe(true);

      const spanish = repo.getByLanguage('es');
      expect(spanish).toHaveLength(1);
      expect(spanish[0].moduleName).toBe('Reina Valera');
    });

    it('should return empty array for nonexistent language', () => {
      repo.create(createTestModule({ languageCode: 'en' }));
      const result = repo.getByLanguage('zh');
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // Indexing
  // ==========================================================================

  describe('getUnindexedModules', () => {
    it('should return only modules where isIndexed is false', () => {
      repo.create(createTestModule({ isIndexed: false, moduleName: 'Unindexed', abbreviation: 'U', databasePath: 'u.db' }));
      repo.create(createTestModule({ isIndexed: true, moduleName: 'Indexed', abbreviation: 'I', databasePath: 'i.db' }));
      repo.create(createTestModule({ isIndexed: false, moduleName: 'Also Unindexed', abbreviation: 'AU', databasePath: 'au.db' }));

      const unindexed = repo.getUnindexedModules();
      expect(unindexed).toHaveLength(2);
      expect(unindexed.every(m => m.isIndexed === false)).toBe(true);
    });

    it('should return empty array when all modules are indexed', () => {
      repo.create(createTestModule({ isIndexed: true }));
      const result = repo.getUnindexedModules();
      expect(result).toEqual([]);
    });
  });

  describe('markAsIndexed', () => {
    it('should set isIndexed to true and populate lastIndexedDate', () => {
      const created = repo.create(createTestModule({ isIndexed: false }));
      expect(created.isIndexed).toBe(false);

      repo.markAsIndexed(created.moduleId!);

      const fetched = repo.getById(created.moduleId!);
      expect(fetched!.isIndexed).toBe(true);
      expect(fetched!.lastIndexedDate).toBeDefined();
      // Verify the date is a valid ISO string (recent)
      const indexedDate = new Date(fetched!.lastIndexedDate!);
      expect(indexedDate.getTime()).toBeGreaterThan(Date.now() - 5000);
    });
  });

  // ==========================================================================
  // Search
  // ==========================================================================

  describe('search', () => {
    it('should find modules matching name', () => {
      repo.create(createTestModule({ moduleName: 'King James Version', abbreviation: 'KJV' }));
      repo.create(createTestModule({ moduleName: 'New King James Version', abbreviation: 'NKJV', databasePath: 'nkjv.db' }));
      repo.create(createTestModule({ moduleName: 'English Standard Version', abbreviation: 'ESV', databasePath: 'esv.db' }));

      const results = repo.search('King');
      expect(results).toHaveLength(2);
      expect(results.every(m => m.moduleName.includes('King'))).toBe(true);
    });

    it('should find modules matching abbreviation', () => {
      repo.create(createTestModule({ moduleName: 'King James Version', abbreviation: 'KJV' }));
      repo.create(createTestModule({ moduleName: 'New King James Version', abbreviation: 'NKJV', databasePath: 'nkjv.db' }));

      const results = repo.search('KJV');
      expect(results).toHaveLength(2); // Both KJV and NKJV match
    });

    it('should return empty array when no modules match', () => {
      repo.create(createTestModule());
      const results = repo.search('zzz_no_match');
      expect(results).toEqual([]);
    });

    it('should be case-insensitive (SQLite LIKE default behavior)', () => {
      repo.create(createTestModule({ moduleName: 'King James Version', abbreviation: 'KJV' }));

      const results = repo.search('king');
      expect(results).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Feature-based queries
  // ==========================================================================

  describe('getByFeature', () => {
    it('should return modules that have a specific feature', () => {
      repo.create(createTestModule({
        moduleName: 'KJV with Strongs',
        abbreviation: 'KJVS',
        features: ['strongs_numbers', 'red_letter'],
      }));
      repo.create(createTestModule({
        moduleName: 'ESV Plain',
        abbreviation: 'ESV',
        databasePath: 'esv.db',
        features: ['section_headings'],
      }));
      repo.create(createTestModule({
        moduleName: 'NASB with Strongs',
        abbreviation: 'NASB',
        databasePath: 'nasb.db',
        features: ['strongs_numbers', 'morphology'],
      }));

      const strongs = repo.getByFeature('strongs_numbers');
      expect(strongs).toHaveLength(2);
      expect(strongs.every(m => m.features.includes('strongs_numbers'))).toBe(true);
    });

    it('should return empty array when no modules have the feature', () => {
      repo.create(createTestModule({ features: ['red_letter'] }));
      const result = repo.getByFeature('interlinear');
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // JSON and boolean round-trips
  // ==========================================================================

  describe('features array round-trip', () => {
    it('should persist and retrieve features array correctly', () => {
      const allFeatures: ModuleFeature[] = [
        'strongs_numbers', 'morphology', 'footnotes', 'cross_references',
        'red_letter', 'section_headings', 'interlinear', 'word_occurrences',
      ];

      const created = repo.create(createTestModule({ features: allFeatures }));
      const fetched = repo.getById(created.moduleId!);

      expect(fetched!.features).toEqual(allFeatures);
      expect(fetched!.features).toHaveLength(8);
    });

    it('should handle empty features array', () => {
      const created = repo.create(createTestModule({ features: [] }));
      const fetched = repo.getById(created.moduleId!);
      expect(fetched!.features).toEqual([]);
    });
  });

  describe('metadata JSON round-trip', () => {
    it('should persist and retrieve complex metadata objects', () => {
      const meta = {
        description: 'A classic translation',
        importSource: 'SWORD',
        customTags: ['legacy', 'formal-equivalence'],
        nested: { level: 2, data: 'test' },
      };

      const created = repo.create(createTestModule({ metadata: meta }));
      const fetched = repo.getById(created.moduleId!);

      expect(fetched!.metadata).toEqual(meta);
    });

    it('should handle undefined metadata gracefully', () => {
      const created = repo.create(createTestModule({ metadata: undefined }));
      const fetched = repo.getById(created.moduleId!);
      // When no metadata is stored, repository returns undefined
      expect(fetched!.metadata).toBeUndefined();
    });
  });

  describe('swordMetadata JSON round-trip', () => {
    it('should persist and retrieve SWORD metadata', () => {
      const swordMeta = {
        osisName: 'KJV',
        source: 'CrossWire',
        lcsh: 'Bible. English. Authorized.',
        textSource: 'CCEL',
      };

      const created = repo.create(createTestModule({ swordMetadata: swordMeta }));
      const fetched = repo.getById(created.moduleId!);

      expect(fetched!.swordMetadata).toEqual(swordMeta);
    });
  });

  describe('boolean field (isIndexed) round-trip', () => {
    it('should store and retrieve isIndexed=true correctly', () => {
      const created = repo.create(createTestModule({ isIndexed: true }));
      const fetched = repo.getById(created.moduleId!);
      expect(fetched!.isIndexed).toBe(true);
    });

    it('should store and retrieve isIndexed=false correctly', () => {
      const created = repo.create(createTestModule({ isIndexed: false }));
      const fetched = repo.getById(created.moduleId!);
      expect(fetched!.isIndexed).toBe(false);
    });

    it('should default isIndexed to false when not specified', () => {
      const module = new ModuleMetadata({
        moduleUuid: randomUUID(),
        moduleType: 'bible',
        moduleName: 'Test',
        databasePath: 'test.db',
      });
      const created = repo.create(module);
      const fetched = repo.getById(created.moduleId!);
      expect(fetched!.isIndexed).toBe(false);
    });
  });
});
