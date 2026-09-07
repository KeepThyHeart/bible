import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainTestHelper } from './helpers/MainTestHelper';
import { ModuleUpdateRepository } from '../Data/Repositories/ModuleUpdateRepository';
import { ModuleUpdate } from '../Data/Models/Main/ModuleUpdate';

describe('ModuleUpdateRepository', () => {
  let repo: ModuleUpdateRepository;
  let moduleId: number;

  beforeAll(() => {
    MainTestHelper.initializeWithFullSchema();
    repo = new ModuleUpdateRepository(MainTestHelper.getProvider());
  });

  afterAll(() => {
    MainTestHelper.cleanup();
  });

  beforeEach(() => {
    MainTestHelper.clearData();
    // Insert a sample module for FK constraint
    moduleId = MainTestHelper.insertSampleModule();
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  function createTestUpdate(overrides: Partial<{
    moduleId: number;
    currentVersion: string;
    availableVersion: string;
    releaseDate: string;
    changelog: string;
    downloadUrl: string;
    downloadSizeBytes: number;
    isCritical: boolean;
    userIgnored: boolean;
    notifiedDate: string;
    metadata: Record<string, unknown>;
  }> = {}): ModuleUpdate {
    return new ModuleUpdate({
      moduleId: overrides.moduleId ?? moduleId,
      currentVersion: overrides.currentVersion ?? '1.0.0',
      availableVersion: overrides.availableVersion ?? '1.1.0',
      releaseDate: overrides.releaseDate,
      changelog: overrides.changelog,
      downloadUrl: overrides.downloadUrl ?? 'https://example.com/update.zip',
      downloadSizeBytes: overrides.downloadSizeBytes,
      isCritical: overrides.isCritical,
      userIgnored: overrides.userIgnored,
      notifiedDate: overrides.notifiedDate,
      metadata: overrides.metadata,
    });
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  describe('create', () => {
    it('should create an update and return it with updateId set', () => {
      const update = createTestUpdate({ changelog: 'Bug fixes' });
      const created = repo.create(update);

      expect(created.updateId).toBeDefined();
      expect(created.updateId).toBeGreaterThan(0);
      expect(created.moduleId).toBe(moduleId);
      expect(created.currentVersion).toBe('1.0.0');
      expect(created.availableVersion).toBe('1.1.0');
      expect(created.changelog).toBe('Bug fixes');
      expect(created.downloadUrl).toBe('https://example.com/update.zip');
    });

    it('should persist all optional fields', () => {
      const update = createTestUpdate({
        releaseDate: '2025-06-15T10:00:00Z',
        changelog: 'Major update with new features',
        downloadSizeBytes: 5242880,
        isCritical: true,
        metadata: { sourceRepo: 'github', checksum: 'abc123' },
      });
      const created = repo.create(update);
      const fetched = repo.getById(created.updateId!);

      expect(fetched).toBeDefined();
      expect(fetched!.releaseDate).toBe('2025-06-15T10:00:00Z');
      expect(fetched!.changelog).toBe('Major update with new features');
      expect(fetched!.downloadSizeBytes).toBe(5242880);
      expect(fetched!.isCritical).toBe(true);
      expect(fetched!.userIgnored).toBe(false);
      expect(fetched!.metadata).toEqual({ sourceRepo: 'github', checksum: 'abc123' });
    });
  });

  describe('getById', () => {
    it('should return undefined for non-existent ID', () => {
      const result = repo.getById(9999);
      expect(result).toBeUndefined();
    });

    it('should return the correct update by ID', () => {
      const created = repo.create(createTestUpdate({ availableVersion: '2.0.0' }));
      const fetched = repo.getById(created.updateId!);

      expect(fetched).toBeDefined();
      expect(fetched!.updateId).toBe(created.updateId);
      expect(fetched!.availableVersion).toBe('2.0.0');
    });
  });

  describe('getAll', () => {
    it('should return empty array when no updates exist', () => {
      const results = repo.getAll();
      expect(results).toEqual([]);
    });

    it('should return all updates ordered by release_date DESC by default', () => {
      repo.create(createTestUpdate({ releaseDate: '2025-01-01', availableVersion: '1.1.0' }));
      repo.create(createTestUpdate({ releaseDate: '2025-06-01', availableVersion: '1.2.0' }));
      repo.create(createTestUpdate({ releaseDate: '2025-03-01', availableVersion: '1.1.5' }));

      const results = repo.getAll();
      expect(results).toHaveLength(3);
      expect(results[0].availableVersion).toBe('1.2.0');
      expect(results[1].availableVersion).toBe('1.1.5');
      expect(results[2].availableVersion).toBe('1.1.0');
    });

    it('should respect limit and offset options', () => {
      repo.create(createTestUpdate({ releaseDate: '2025-01-01', availableVersion: '1.1.0' }));
      repo.create(createTestUpdate({ releaseDate: '2025-06-01', availableVersion: '1.2.0' }));
      repo.create(createTestUpdate({ releaseDate: '2025-03-01', availableVersion: '1.1.5' }));

      const results = repo.getAll({ limit: 2 });
      expect(results).toHaveLength(2);

      const page2 = repo.getAll({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('should update an existing record', () => {
      const created = repo.create(createTestUpdate({ changelog: 'Initial' }));
      created.changelog = 'Updated changelog';
      created.isCritical = true;
      repo.update(created);

      const fetched = repo.getById(created.updateId!);
      expect(fetched!.changelog).toBe('Updated changelog');
      expect(fetched!.isCritical).toBe(true);
    });

    it('should throw when updating without an ID', () => {
      const update = createTestUpdate();
      expect(() => repo.update(update)).toThrow('Cannot update module update without ID');
    });
  });

  describe('delete', () => {
    it('should delete an existing update and return true', () => {
      const created = repo.create(createTestUpdate());
      const result = repo.delete(created.updateId!);

      expect(result).toBe(true);
      expect(repo.getById(created.updateId!)).toBeUndefined();
    });

    it('should return false when deleting non-existent ID', () => {
      const result = repo.delete(9999);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Filtering Methods
  // ==========================================================================

  describe('getByModule', () => {
    it('should return only updates for the specified module', () => {
      const module2Id = MainTestHelper.insertSampleModule({
        moduleName: 'ESV', abbreviation: 'ESV', databasePath: 'modules/bible_esv.db',
      });

      repo.create(createTestUpdate({ moduleId, availableVersion: '1.1.0' }));
      repo.create(createTestUpdate({ moduleId, availableVersion: '1.2.0' }));
      repo.create(createTestUpdate({ moduleId: module2Id, availableVersion: '2.0.0' }));

      const results = repo.getByModule(moduleId);
      expect(results).toHaveLength(2);
      expect(results.every(u => u.moduleId === moduleId)).toBe(true);

      const results2 = repo.getByModule(module2Id);
      expect(results2).toHaveLength(1);
      expect(results2[0].availableVersion).toBe('2.0.0');
    });

    it('should return empty array for module with no updates', () => {
      const results = repo.getByModule(9999);
      expect(results).toEqual([]);
    });
  });

  describe('getUnignored', () => {
    it('should exclude user-ignored updates', () => {
      const u1 = repo.create(createTestUpdate({ availableVersion: '1.1.0' }));
      repo.create(createTestUpdate({ availableVersion: '1.2.0' }));

      repo.ignoreUpdate(u1.updateId!);

      const results = repo.getUnignored();
      expect(results).toHaveLength(1);
      expect(results[0].availableVersion).toBe('1.2.0');
    });

    it('should order by is_critical DESC then release_date DESC', () => {
      repo.create(createTestUpdate({
        availableVersion: '1.1.0', releaseDate: '2025-06-01', isCritical: false,
      }));
      repo.create(createTestUpdate({
        availableVersion: '1.2.0', releaseDate: '2025-01-01', isCritical: true,
      }));
      repo.create(createTestUpdate({
        availableVersion: '1.3.0', releaseDate: '2025-03-01', isCritical: true,
      }));

      const results = repo.getUnignored();
      expect(results).toHaveLength(3);
      // Critical updates first, ordered by release_date DESC among themselves
      expect(results[0].availableVersion).toBe('1.3.0');
      expect(results[1].availableVersion).toBe('1.2.0');
      expect(results[2].availableVersion).toBe('1.1.0');
    });
  });

  describe('getCritical', () => {
    it('should return only critical, non-ignored updates', () => {
      repo.create(createTestUpdate({ availableVersion: '1.1.0', isCritical: false }));
      repo.create(createTestUpdate({ availableVersion: '1.2.0', isCritical: true }));
      const ignored = repo.create(createTestUpdate({ availableVersion: '1.3.0', isCritical: true }));

      repo.ignoreUpdate(ignored.updateId!);

      const results = repo.getCritical();
      expect(results).toHaveLength(1);
      expect(results[0].availableVersion).toBe('1.2.0');
      expect(results[0].isCritical).toBe(true);
    });

    it('should return empty array when no critical updates exist', () => {
      repo.create(createTestUpdate({ isCritical: false }));
      const results = repo.getCritical();
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // State Mutation Methods
  // ==========================================================================

  describe('ignoreUpdate', () => {
    it('should set user_ignored to true', () => {
      const created = repo.create(createTestUpdate());
      expect(repo.getById(created.updateId!)!.userIgnored).toBe(false);

      repo.ignoreUpdate(created.updateId!);

      const fetched = repo.getById(created.updateId!);
      expect(fetched!.userIgnored).toBe(true);
    });

    it('should remove update from getUnignored, getCritical, and hasUpdate results', () => {
      const created = repo.create(createTestUpdate({ isCritical: true }));

      expect(repo.getUnignored()).toHaveLength(1);
      expect(repo.getCritical()).toHaveLength(1);
      expect(repo.hasUpdate(moduleId)).toBe(true);

      repo.ignoreUpdate(created.updateId!);

      expect(repo.getUnignored()).toHaveLength(0);
      expect(repo.getCritical()).toHaveLength(0);
      expect(repo.hasUpdate(moduleId)).toBe(false);
    });
  });

  describe('markNotified', () => {
    it('should set notified_date to a timestamp', () => {
      const created = repo.create(createTestUpdate());
      expect(repo.getById(created.updateId!)!.notifiedDate).toBeFalsy();

      const before = new Date().toISOString();
      repo.markNotified(created.updateId!);
      const after = new Date().toISOString();

      const fetched = repo.getById(created.updateId!);
      expect(fetched!.notifiedDate).toBeDefined();
      expect(fetched!.notifiedDate! >= before).toBe(true);
      expect(fetched!.notifiedDate! <= after).toBe(true);
    });
  });

  // ==========================================================================
  // Existence and Batch Operations
  // ==========================================================================

  describe('hasUpdate', () => {
    it('should return true when non-ignored updates exist for module', () => {
      repo.create(createTestUpdate());
      expect(repo.hasUpdate(moduleId)).toBe(true);
    });

    it('should return false when no updates exist for module', () => {
      expect(repo.hasUpdate(moduleId)).toBe(false);
    });

    it('should return false when all updates for module are ignored', () => {
      const u1 = repo.create(createTestUpdate());
      const u2 = repo.create(createTestUpdate({ availableVersion: '2.0.0' }));

      repo.ignoreUpdate(u1.updateId!);
      repo.ignoreUpdate(u2.updateId!);

      expect(repo.hasUpdate(moduleId)).toBe(false);
    });
  });

  describe('deleteByModule', () => {
    it('should delete all updates for a module and return count', () => {
      repo.create(createTestUpdate());
      repo.create(createTestUpdate({ availableVersion: '2.0.0' }));
      repo.create(createTestUpdate({ availableVersion: '3.0.0' }));

      const deleted = repo.deleteByModule(moduleId);
      expect(deleted).toBe(3);
      expect(repo.getByModule(moduleId)).toEqual([]);
    });

    it('should return 0 when no updates exist for module', () => {
      const deleted = repo.deleteByModule(9999);
      expect(deleted).toBe(0);
    });

    it('should not affect updates for other modules', () => {
      const module2Id = MainTestHelper.insertSampleModule({
        moduleName: 'NIV', abbreviation: 'NIV', databasePath: 'modules/bible_niv.db',
      });

      repo.create(createTestUpdate({ moduleId }));
      repo.create(createTestUpdate({ moduleId: module2Id }));

      repo.deleteByModule(moduleId);

      expect(repo.getByModule(moduleId)).toHaveLength(0);
      expect(repo.getByModule(module2Id)).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Boolean Field Round-Trip
  // ==========================================================================

  describe('boolean fields', () => {
    it('should round-trip isCritical=true correctly', () => {
      const created = repo.create(createTestUpdate({ isCritical: true }));
      const fetched = repo.getById(created.updateId!);
      expect(fetched!.isCritical).toBe(true);
    });

    it('should round-trip isCritical=false correctly', () => {
      const created = repo.create(createTestUpdate({ isCritical: false }));
      const fetched = repo.getById(created.updateId!);
      expect(fetched!.isCritical).toBe(false);
    });

    it('should round-trip userIgnored=true correctly', () => {
      const created = repo.create(createTestUpdate({ userIgnored: true }));
      const fetched = repo.getById(created.updateId!);
      expect(fetched!.userIgnored).toBe(true);
    });

    it('should default isCritical and userIgnored to false', () => {
      const created = repo.create(createTestUpdate());
      const fetched = repo.getById(created.updateId!);
      expect(fetched!.isCritical).toBe(false);
      expect(fetched!.userIgnored).toBe(false);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle undefined metadata gracefully', () => {
      const created = repo.create(createTestUpdate({ metadata: undefined }));
      const fetched = repo.getById(created.updateId!);
      expect(fetched!.metadata).toBeUndefined();
    });

    it('should handle metadata with complex nested objects', () => {
      const meta = { checksums: { sha256: 'abc', md5: 'def' }, tags: ['security', 'patch'] };
      const created = repo.create(createTestUpdate({ metadata: meta }));
      const fetched = repo.getById(created.updateId!);
      expect(fetched!.metadata).toEqual(meta);
    });

    it('should handle update with notifiedDate already set on create', () => {
      const date = '2025-05-01T12:00:00Z';
      const created = repo.create(createTestUpdate({ notifiedDate: date }));
      const fetched = repo.getById(created.updateId!);
      expect(fetched!.notifiedDate).toBe(date);
    });
  });
});
