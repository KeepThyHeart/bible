import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainTestHelper } from './helpers/MainTestHelper';
import { DownloadQueueRepository } from '../Data/Repositories/DownloadQueueRepository';
import { DownloadQueue } from '../Data/Models/Main/DownloadQueue';

describe('DownloadQueueRepository', () => {
  let repo: DownloadQueueRepository;

  beforeAll(() => {
    MainTestHelper.initializeWithFullSchema();
    repo = new DownloadQueueRepository(MainTestHelper.getProvider());
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

  function createTestDownload(overrides: Partial<{
    moduleId: string;
    moduleName: string;
    downloadUrl: string;
    downloadSizeBytes: number;
    status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
    progressBytes: number;
    downloadSpeedBps: number;
    startedDate: string;
    completedDate: string;
    errorMessage: string;
    retryCount: number;
    metadata: Record<string, unknown>;
  }> = {}): DownloadQueue {
    return new DownloadQueue({
      moduleId: overrides.moduleId ?? 'bible_kjv',
      moduleName: overrides.moduleName ?? 'King James Version',
      downloadUrl: overrides.downloadUrl ?? 'https://example.com/modules/bible_kjv.db',
      downloadSizeBytes: overrides.downloadSizeBytes,
      status: overrides.status,
      progressBytes: overrides.progressBytes,
      downloadSpeedBps: overrides.downloadSpeedBps,
      startedDate: overrides.startedDate,
      completedDate: overrides.completedDate,
      errorMessage: overrides.errorMessage,
      retryCount: overrides.retryCount,
      metadata: overrides.metadata,
    });
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  describe('create', () => {
    it('should create a download and return it with queueId set', () => {
      const download = createTestDownload();
      const created = repo.create(download);

      expect(created.queueId).toBeDefined();
      expect(created.queueId).toBeGreaterThan(0);
      expect(created.moduleId).toBe('bible_kjv');
      expect(created.moduleName).toBe('King James Version');
      expect(created.downloadUrl).toBe('https://example.com/modules/bible_kjv.db');
      expect(created.status).toBe('pending');
      expect(created.progressBytes).toBe(0);
      expect(created.retryCount).toBe(0);
    });

    it('should persist all optional fields', () => {
      const download = createTestDownload({
        downloadSizeBytes: 10485760,
        status: 'downloading',
        progressBytes: 5242880,
        downloadSpeedBps: 1048576,
        startedDate: '2025-06-15T10:00:00Z',
        errorMessage: 'Retrying after timeout',
        retryCount: 1,
        metadata: { source: 'crosswire', checksum: 'sha256:abc123' },
      });
      const created = repo.create(download);
      const fetched = repo.getById(created.queueId!);

      expect(fetched).toBeDefined();
      expect(fetched!.downloadSizeBytes).toBe(10485760);
      expect(fetched!.status).toBe('downloading');
      expect(fetched!.progressBytes).toBe(5242880);
      expect(fetched!.downloadSpeedBps).toBe(1048576);
      expect(fetched!.startedDate).toBe('2025-06-15T10:00:00Z');
      expect(fetched!.errorMessage).toBe('Retrying after timeout');
      expect(fetched!.retryCount).toBe(1);
      expect(fetched!.metadata).toEqual({ source: 'crosswire', checksum: 'sha256:abc123' });
    });
  });

  describe('getById', () => {
    it('should return undefined for non-existent ID', () => {
      const result = repo.getById(9999);
      expect(result).toBeUndefined();
    });

    it('should return the correct download by ID', () => {
      const created = repo.create(createTestDownload({ moduleName: 'ESV Bible' }));
      const fetched = repo.getById(created.queueId!);

      expect(fetched).toBeDefined();
      expect(fetched!.queueId).toBe(created.queueId);
      expect(fetched!.moduleName).toBe('ESV Bible');
    });
  });

  describe('update', () => {
    it('should update an existing record', () => {
      const created = repo.create(createTestDownload());
      created.status = 'downloading';
      created.progressBytes = 1024;
      created.startedDate = '2025-07-01T08:00:00Z';
      repo.update(created);

      const fetched = repo.getById(created.queueId!);
      expect(fetched!.status).toBe('downloading');
      expect(fetched!.progressBytes).toBe(1024);
      expect(fetched!.startedDate).toBe('2025-07-01T08:00:00Z');
    });

    it('should throw when updating without an ID', () => {
      const download = createTestDownload();
      expect(() => repo.update(download)).toThrow('Cannot update download without ID');
    });
  });

  describe('delete', () => {
    it('should delete an existing download and return true', () => {
      const created = repo.create(createTestDownload());
      const result = repo.delete(created.queueId!);

      expect(result).toBe(true);
      expect(repo.getById(created.queueId!)).toBeUndefined();
    });

    it('should return false when deleting non-existent ID', () => {
      const result = repo.delete(9999);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  describe('getByModuleId', () => {
    it('should return the most recent download for a module', () => {
      repo.create(createTestDownload({
        moduleId: 'bible_kjv',
        startedDate: '2025-01-01T00:00:00Z',
        moduleName: 'KJV First',
      }));
      repo.create(createTestDownload({
        moduleId: 'bible_kjv',
        startedDate: '2025-06-15T00:00:00Z',
        moduleName: 'KJV Second',
      }));

      const result = repo.getByModuleId('bible_kjv');
      expect(result).toBeDefined();
      expect(result!.moduleName).toBe('KJV Second');
    });

    it('should return undefined when no downloads exist for module', () => {
      const result = repo.getByModuleId('nonexistent_module');
      expect(result).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return empty array when no downloads exist', () => {
      const results = repo.getAll();
      expect(results).toEqual([]);
    });

    it('should return all downloads ordered by started_date DESC by default', () => {
      repo.create(createTestDownload({ moduleId: 'mod_a', startedDate: '2025-01-01T00:00:00Z', moduleName: 'A' }));
      repo.create(createTestDownload({ moduleId: 'mod_b', startedDate: '2025-06-01T00:00:00Z', moduleName: 'B' }));
      repo.create(createTestDownload({ moduleId: 'mod_c', startedDate: '2025-03-01T00:00:00Z', moduleName: 'C' }));

      const results = repo.getAll();
      expect(results).toHaveLength(3);
      expect(results[0].moduleName).toBe('B');
      expect(results[1].moduleName).toBe('C');
      expect(results[2].moduleName).toBe('A');
    });

    it('should respect limit and offset options', () => {
      repo.create(createTestDownload({ moduleId: 'mod_a', startedDate: '2025-01-01T00:00:00Z' }));
      repo.create(createTestDownload({ moduleId: 'mod_b', startedDate: '2025-06-01T00:00:00Z' }));
      repo.create(createTestDownload({ moduleId: 'mod_c', startedDate: '2025-03-01T00:00:00Z' }));

      const page1 = repo.getAll({ limit: 2 });
      expect(page1).toHaveLength(2);

      const page2 = repo.getAll({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });
  });

  describe('getByStatus', () => {
    it('should return only downloads with matching status', () => {
      repo.create(createTestDownload({ moduleId: 'mod_a', status: 'pending' }));
      repo.create(createTestDownload({ moduleId: 'mod_b', status: 'downloading' }));
      repo.create(createTestDownload({ moduleId: 'mod_c', status: 'completed' }));
      repo.create(createTestDownload({ moduleId: 'mod_d', status: 'failed' }));
      repo.create(createTestDownload({ moduleId: 'mod_e', status: 'pending' }));

      const pending = repo.getByStatus('pending');
      expect(pending).toHaveLength(2);
      expect(pending.every(d => d.status === 'pending')).toBe(true);

      const completed = repo.getByStatus('completed');
      expect(completed).toHaveLength(1);
      expect(completed[0].status).toBe('completed');

      const paused = repo.getByStatus('paused');
      expect(paused).toHaveLength(0);
    });
  });

  describe('getActive', () => {
    it('should return only pending and downloading items', () => {
      repo.create(createTestDownload({ moduleId: 'mod_a', status: 'pending' }));
      repo.create(createTestDownload({ moduleId: 'mod_b', status: 'downloading' }));
      repo.create(createTestDownload({ moduleId: 'mod_c', status: 'completed' }));
      repo.create(createTestDownload({ moduleId: 'mod_d', status: 'failed' }));
      repo.create(createTestDownload({ moduleId: 'mod_e', status: 'paused' }));

      const active = repo.getActive();
      expect(active).toHaveLength(2);
      const statuses = active.map(d => d.status);
      expect(statuses).toContain('pending');
      expect(statuses).toContain('downloading');
      expect(statuses).not.toContain('completed');
      expect(statuses).not.toContain('failed');
      expect(statuses).not.toContain('paused');
    });

    it('should return empty array when no active downloads exist', () => {
      repo.create(createTestDownload({ moduleId: 'mod_a', status: 'completed' }));
      repo.create(createTestDownload({ moduleId: 'mod_b', status: 'failed' }));

      const active = repo.getActive();
      expect(active).toEqual([]);
    });
  });

  // ==========================================================================
  // Progress and Status Updates
  // ==========================================================================

  describe('updateProgress', () => {
    it('should update progress bytes and speed', () => {
      const created = repo.create(createTestDownload({ downloadSizeBytes: 10000000 }));

      repo.updateProgress(created.queueId!, 5000000, 1048576);

      const fetched = repo.getById(created.queueId!);
      expect(fetched!.progressBytes).toBe(5000000);
      expect(fetched!.downloadSpeedBps).toBe(1048576);
    });

    it('should set speed to null when not provided', () => {
      const created = repo.create(createTestDownload({ downloadSpeedBps: 500000 }));

      repo.updateProgress(created.queueId!, 1024);

      const fetched = repo.getById(created.queueId!);
      expect(fetched!.progressBytes).toBe(1024);
      // SQLite stores null, which passes through to the entity
      expect(fetched!.downloadSpeedBps).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should set started_date when transitioning to downloading', () => {
      const created = repo.create(createTestDownload({ status: 'pending' }));
      expect(created.startedDate).toBeUndefined();

      const before = new Date().toISOString();
      repo.updateStatus(created.queueId!, 'downloading');
      const after = new Date().toISOString();

      const fetched = repo.getById(created.queueId!);
      expect(fetched!.status).toBe('downloading');
      expect(fetched!.startedDate).toBeDefined();
      expect(fetched!.startedDate! >= before).toBe(true);
      expect(fetched!.startedDate! <= after).toBe(true);
    });

    it('should not overwrite existing started_date when set to downloading again', () => {
      const originalDate = '2025-01-01T00:00:00Z';
      const created = repo.create(createTestDownload({
        status: 'pending',
        startedDate: originalDate,
      }));

      repo.updateStatus(created.queueId!, 'downloading');

      const fetched = repo.getById(created.queueId!);
      expect(fetched!.startedDate).toBe(originalDate);
    });

    it('should set completed_date when transitioning to completed', () => {
      const created = repo.create(createTestDownload({ status: 'downloading' }));

      const before = new Date().toISOString();
      repo.updateStatus(created.queueId!, 'completed');
      const after = new Date().toISOString();

      const fetched = repo.getById(created.queueId!);
      expect(fetched!.status).toBe('completed');
      expect(fetched!.completedDate).toBeDefined();
      expect(fetched!.completedDate! >= before).toBe(true);
      expect(fetched!.completedDate! <= after).toBe(true);
    });

    it('should set error message when transitioning to failed', () => {
      const created = repo.create(createTestDownload({ status: 'downloading' }));

      repo.updateStatus(created.queueId!, 'failed', 'Connection timed out');

      const fetched = repo.getById(created.queueId!);
      expect(fetched!.status).toBe('failed');
      expect(fetched!.errorMessage).toBe('Connection timed out');
    });

    it('should update status without setting dates for other statuses', () => {
      const created = repo.create(createTestDownload({ status: 'downloading' }));

      repo.updateStatus(created.queueId!, 'paused');

      const fetched = repo.getById(created.queueId!);
      expect(fetched!.status).toBe('paused');
      expect(fetched!.completedDate).toBeNull();
    });
  });

  // ==========================================================================
  // Batch and Cancel Operations
  // ==========================================================================

  describe('clearCompleted', () => {
    it('should remove only completed downloads and return count', () => {
      repo.create(createTestDownload({ moduleId: 'mod_a', status: 'completed' }));
      repo.create(createTestDownload({ moduleId: 'mod_b', status: 'completed' }));
      repo.create(createTestDownload({ moduleId: 'mod_c', status: 'pending' }));
      repo.create(createTestDownload({ moduleId: 'mod_d', status: 'failed' }));

      const count = repo.clearCompleted();
      expect(count).toBe(2);

      const remaining = repo.getAll();
      expect(remaining).toHaveLength(2);
      expect(remaining.every(d => d.status !== 'completed')).toBe(true);
    });

    it('should return 0 when no completed downloads exist', () => {
      repo.create(createTestDownload({ status: 'pending' }));
      repo.create(createTestDownload({ moduleId: 'mod_b', status: 'downloading' }));

      const count = repo.clearCompleted();
      expect(count).toBe(0);
    });
  });

  describe('cancel', () => {
    it('should set status to failed and error message to Cancelled by user', () => {
      const created = repo.create(createTestDownload({ status: 'downloading' }));

      repo.cancel(created.queueId!);

      const fetched = repo.getById(created.queueId!);
      expect(fetched!.status).toBe('failed');
      expect(fetched!.errorMessage).toBe('Cancelled by user');
    });

    it('should cancel a pending download', () => {
      const created = repo.create(createTestDownload({ status: 'pending' }));

      repo.cancel(created.queueId!);

      const fetched = repo.getById(created.queueId!);
      expect(fetched!.status).toBe('failed');
      expect(fetched!.errorMessage).toBe('Cancelled by user');
    });
  });

  // ==========================================================================
  // Metadata JSON Round-Trip
  // ==========================================================================

  describe('metadata', () => {
    it('should round-trip undefined metadata', () => {
      const created = repo.create(createTestDownload({ metadata: undefined }));
      const fetched = repo.getById(created.queueId!);
      expect(fetched!.metadata).toBeUndefined();
    });

    it('should round-trip complex nested metadata', () => {
      const meta = {
        checksums: { sha256: 'abc123', md5: 'def456' },
        mirrors: ['https://mirror1.example.com', 'https://mirror2.example.com'],
        retryHistory: [
          { attempt: 1, error: 'timeout', timestamp: '2025-01-01T00:00:00Z' },
        ],
      };
      const created = repo.create(createTestDownload({ metadata: meta }));
      const fetched = repo.getById(created.queueId!);
      expect(fetched!.metadata).toEqual(meta);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle module_id as text (not integer)', () => {
      const created = repo.create(createTestDownload({
        moduleId: 'com.example.bible-esv-2025',
      }));
      const fetched = repo.getById(created.queueId!);
      expect(fetched!.moduleId).toBe('com.example.bible-esv-2025');

      const byModule = repo.getByModuleId('com.example.bible-esv-2025');
      expect(byModule).toBeDefined();
      expect(byModule!.queueId).toBe(created.queueId);
    });

    it('should handle zero download size bytes', () => {
      const created = repo.create(createTestDownload({ downloadSizeBytes: 0 }));
      const fetched = repo.getById(created.queueId!);
      expect(fetched!.downloadSizeBytes).toBe(0);
    });

    it('should handle download with no started or completed dates', () => {
      const created = repo.create(createTestDownload());
      const fetched = repo.getById(created.queueId!);
      // SQLite returns null for unset columns
      expect(fetched!.startedDate).toBeNull();
      expect(fetched!.completedDate).toBeNull();
    });
  });
});
