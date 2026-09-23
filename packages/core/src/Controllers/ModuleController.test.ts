import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModuleController } from './ModuleController';
import { IModuleMetadataRepository } from '../Data/Repositories/IModuleMetadataRepository';
import { IDownloadQueueRepository } from '../Data/Repositories/IDownloadQueueRepository';
import { IDownloadService } from '../Services/IDownloadService';
import { IInstallationService } from '../Services/IInstallationService';
import { IModuleCatalogService } from '../Services/IModuleCatalogService';
import { CatalogModule } from '../Data/Core/CatalogTypes';
import { DownloadQueue } from '../Data/Models/Main/DownloadQueue';

/**
 * Minimal mock of IModuleMetadataRepository for testing ModuleController.
 * Only the methods ModuleController calls need real logic.
 */
function createMockModuleMetadataRepo(
  overrides?: Partial<IModuleMetadataRepository>
): IModuleMetadataRepository {
  return {
    getById: vi.fn(() => undefined),
    getByUuid: vi.fn(() => undefined),
    getByAbbreviation: vi.fn(() => undefined),
    getAll: vi.fn(() => []),
    getByType: vi.fn(() => []),
    getByLanguage: vi.fn(() => []),
    getUnindexedModules: vi.fn(() => []),
    create: vi.fn((entity) => entity),
    update: vi.fn((entity) => entity),
    delete: vi.fn(() => true),
    markAsIndexed: vi.fn(),
    search: vi.fn(() => []),
    getByFeature: vi.fn(() => []),
    ...overrides,
  };
}

/**
 * Minimal mock of IDownloadQueueRepository for testing ModuleController.
 */
function createMockDownloadQueueRepo(
  overrides?: Partial<IDownloadQueueRepository>
): IDownloadQueueRepository {
  return {
    getById: vi.fn(() => undefined),
    create: vi.fn((entity: DownloadQueue) => {
      entity.queueId = entity.queueId ?? 1;
      return entity;
    }),
    update: vi.fn((entity) => entity),
    delete: vi.fn(() => true),
    getAll: vi.fn(() => []),
    getByStatus: vi.fn(() => []),
    getActive: vi.fn(() => []),
    updateProgress: vi.fn(),
    updateStatus: vi.fn(),
    clearCompleted: vi.fn(() => 0),
    getByModuleId: vi.fn(() => undefined),
    cancel: vi.fn(),
    ...overrides,
  };
}

/**
 * Minimal mock of IDownloadService for testing ModuleController.
 */
function createMockDownloadService(overrides?: Partial<IDownloadService>): IDownloadService {
  return {
    startDownload: vi.fn(async (_queueId, _url, destination) => destination),
    pauseDownload: vi.fn(),
    resumeDownload: vi.fn(async () => {}),
    cancelDownload: vi.fn(),
    getProgress: vi.fn(() => undefined),
    verifyChecksum: vi.fn(async () => true),
    onProgress: vi.fn(),
    offProgress: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    getActiveDownloads: vi.fn(() => []),
    clearCompleted: vi.fn(),
    ...overrides,
  };
}

/**
 * Minimal mock of IInstallationService for testing ModuleController.
 */
function createMockInstallationService(
  overrides?: Partial<IInstallationService>
): IInstallationService {
  return {
    installModule: vi.fn(async () => ({ success: true, moduleId: 1, moduleName: 'Test' })),
    verifyModule: vi.fn(async () => true),
    registerModule: vi.fn(async () => 1),
    uninstallModule: vi.fn(async () => true),
    getModulePath: vi.fn(() => '/modules/test.db'),
    decompressModule: vi.fn(async () => {}),
    getModuleSize: vi.fn(async () => 0),
    extractModuleInfo: vi.fn(async () => ({})),
    ...overrides,
  };
}

/**
 * Minimal mock of IModuleCatalogService for testing ModuleController.
 */
function createMockCatalogService(
  overrides?: Partial<IModuleCatalogService>
): IModuleCatalogService {
  return {
    fetchCatalog: vi.fn(async () => {
      throw new Error('not implemented in mock');
    }),
    refreshCatalog: vi.fn(async () => {
      throw new Error('not implemented in mock');
    }),
    refreshAllCatalogs: vi.fn(async () => []),
    getCachedCatalog: vi.fn(() => undefined),
    searchModules: vi.fn(() => []),
    getAllAvailableModules: vi.fn(() => []),
    getModuleInfo: vi.fn(() => undefined),
    validateCatalog: vi.fn(() => true),
    ...overrides,
  };
}

/** A realistic CatalogModule fixture, overridable per test. */
function makeCatalogModule(overrides?: Partial<CatalogModule>): CatalogModule {
  return {
    module_id: 'kjv',
    module_type: 'bible',
    name: 'King James Version',
    abbreviation: 'KJV',
    language_code: 'en',
    version: '1.0',
    description: 'A classic English translation',
    license: 'Public Domain',
    download_url: 'https://catalog.example.com/modules/kjv_v1.0.db.gz',
    download_size_bytes: 1000,
    installed_size_bytes: 2000,
    checksum: 'sha256:' + 'a'.repeat(64),
    features: [],
    tags: [],
    recommended: false,
    created_date: '2024-01-01',
    updated_date: '2024-01-01',
    ...overrides,
  };
}

describe('ModuleController', () => {
  let moduleMetadataRepo: IModuleMetadataRepository;
  let downloadQueueRepo: IDownloadQueueRepository;
  let downloadService: IDownloadService;
  let installationService: IInstallationService;
  let catalogService: IModuleCatalogService;
  let controller: ModuleController;

  beforeEach(() => {
    moduleMetadataRepo = createMockModuleMetadataRepo();
    downloadQueueRepo = createMockDownloadQueueRepo();
    downloadService = createMockDownloadService();
    installationService = createMockInstallationService();
    catalogService = createMockCatalogService();
    controller = new ModuleController(
      moduleMetadataRepo,
      downloadQueueRepo,
      downloadService,
      installationService,
      catalogService,
      '/tmp/downloads'
    );
  });

  // ==========================================================================
  // installModule - format_version gate
  // ==========================================================================

  describe('installModule - format_version gate', () => {
    it('refuses a catalog entry whose format_version is not readable, before downloading it', async () => {
      const catalogModule = makeCatalogModule({ format_version: '0.99' });
      (catalogService.getModuleInfo as ReturnType<typeof vi.fn>).mockReturnValue(catalogModule);

      const result = await controller.installModule('kjv');

      expect(result.success).toBe(false);
      expect(result.error).toContain('0.99');
      expect(downloadService.startDownload).not.toHaveBeenCalled();
      expect(installationService.installModule).not.toHaveBeenCalled();
    });

    it('installs normally when format_version is absent (older catalog)', async () => {
      const catalogModule = makeCatalogModule();
      delete (catalogModule as { format_version?: string }).format_version;
      (catalogService.getModuleInfo as ReturnType<typeof vi.fn>).mockReturnValue(catalogModule);

      const result = await controller.installModule('kjv');

      expect(result.success).toBe(true);
      expect(downloadService.startDownload).toHaveBeenCalledTimes(1);
    });

    it.each(['0.1', '0.2', '2.0'])(
      'installs normally when format_version (%s) is readable',
      async (version) => {
        const catalogModule = makeCatalogModule({ format_version: version });
        (catalogService.getModuleInfo as ReturnType<typeof vi.fn>).mockReturnValue(catalogModule);

        const result = await controller.installModule('kjv');

        expect(result.success).toBe(true);
        expect(downloadService.startDownload).toHaveBeenCalledTimes(1);
      }
    );
  });

  // ==========================================================================
  // installModule - temp filename extension
  // ==========================================================================

  describe('installModule - temp filename extension', () => {
    it('uses a .gz-suffixed temp filename when download_url ends in .gz', async () => {
      const catalogModule = makeCatalogModule({
        download_url: 'https://catalog.example.com/modules/kjv_v1.0.db.gz',
      });
      (catalogService.getModuleInfo as ReturnType<typeof vi.fn>).mockReturnValue(catalogModule);

      await controller.installModule('kjv');

      const [, , destination] = (downloadService.startDownload as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(destination).toBe('/tmp/downloads/kjv_v1.0.db.gz');
    });

    it('does not append .gz to the temp filename when download_url does not end in .gz', async () => {
      const catalogModule = makeCatalogModule({
        download_url: 'https://catalog.example.com/modules/kjv_v1.0.db',
      });
      (catalogService.getModuleInfo as ReturnType<typeof vi.fn>).mockReturnValue(catalogModule);

      await controller.installModule('kjv');

      const [, , destination] = (downloadService.startDownload as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(destination).toBe('/tmp/downloads/kjv_v1.0.db');
      expect(destination.endsWith('.gz')).toBe(false);
    });
  });

  // ==========================================================================
  // installModule - existing behaviour (unaffected by this subtask)
  // ==========================================================================

  describe('installModule - existing behaviour', () => {
    it('returns an error when the module is not found in the catalog', async () => {
      (catalogService.getModuleInfo as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const result = await controller.installModule('missing');

      expect(result).toEqual({ success: false, error: 'Module not found in catalog' });
      expect(downloadService.startDownload).not.toHaveBeenCalled();
    });

    it('returns an error when the module is already installed', async () => {
      const catalogModule = makeCatalogModule();
      (catalogService.getModuleInfo as ReturnType<typeof vi.fn>).mockReturnValue(catalogModule);
      (moduleMetadataRepo.getByAbbreviation as ReturnType<typeof vi.fn>).mockReturnValue({
        moduleId: 1,
      });

      const result = await controller.installModule('kjv');

      expect(result).toEqual({ success: false, error: 'Module already installed' });
      expect(downloadService.startDownload).not.toHaveBeenCalled();
    });
  });
});
