import { ModuleMetadata, ModuleFeature } from '../Data/Models/Main/ModuleMetadata';
import { DownloadQueue } from '../Data/Models/Main/DownloadQueue';
import { IModuleMetadataRepository } from '../Data/Repositories/IModuleMetadataRepository';
import { IDownloadQueueRepository } from '../Data/Repositories/IDownloadQueueRepository';
import { IDownloadService } from '../Services/IDownloadService';
import { IInstallationService } from '../Services/IInstallationService';
import { IModuleCatalogService } from '../Services/IModuleCatalogService';
import {
  CatalogModule,
  ModuleFilter,
  DownloadProgress,
  InstallationResult,
  UpdateCheckResult
} from '../Data/Core/CatalogTypes';

/**
 * Module Controller
 * Orchestrates module discovery, download, installation, and management.
 *
 * Accepts repository interfaces (not ISql) so callers control database lifecycle
 * and the controller remains testable without a real database.
 */
export class ModuleController {
  constructor(
    private moduleMetadataRepo: IModuleMetadataRepository,
    private downloadQueueRepo: IDownloadQueueRepository,
    private downloadService: IDownloadService,
    private installationService: IInstallationService,
    private catalogService: IModuleCatalogService,
    private tempDownloadPath: string
  ) {
    this.setupDownloadCallbacks();
  }

  /**
   * Search available modules
   */
  searchModules(filter: ModuleFilter): CatalogModule[] {
    return this.catalogService.searchModules(filter);
  }

  /**
   * Get all available modules
   */
  getAvailableModules(): CatalogModule[] {
    return this.catalogService.getAllAvailableModules();
  }

  /**
   * Get all installed modules
   */
  getInstalledModules(): ModuleMetadata[] {
    return this.moduleMetadataRepo.getAll();
  }

  /**
   * Get module details
   */
  getModuleDetails(moduleId: number): ModuleMetadata | undefined {
    return this.moduleMetadataRepo.getById(moduleId);
  }

  /**
   * Install a module
   */
  async installModule(catalogModuleId: string): Promise<InstallationResult> {
    try {
      // Get module info from catalog
      const moduleInfo = this.catalogService.getModuleInfo(catalogModuleId);
      if (!moduleInfo) {
        return {
          success: false,
          error: 'Module not found in catalog'
        };
      }

      // Check if already installed
      const existing = this.moduleMetadataRepo.getByAbbreviation(moduleInfo.abbreviation);
      if (existing) {
        return {
          success: false,
          error: 'Module already installed'
        };
      }

      // Create download queue entry
      const downloadQueue = new DownloadQueue({
        moduleId: moduleInfo.module_id,
        moduleName: moduleInfo.name,
        downloadUrl: moduleInfo.download_url,
        downloadSizeBytes: moduleInfo.download_size_bytes,
        status: 'pending'
      });

      const queueEntry = this.downloadQueueRepo.create(downloadQueue);

      // Determine temp file path
      const fileName = `${moduleInfo.module_id}_v${moduleInfo.version}.db.gz`;
      const tempFilePath = `${this.tempDownloadPath}/${fileName}`;

      // Start download
      const downloadedPath = await this.downloadService.startDownload(
        queueEntry.queueId!,
        moduleInfo.download_url,
        tempFilePath,
        moduleInfo.checksum.replace('sha256:', '')
      );

      // Mark download as completed in queue
      this.downloadQueueRepo.updateStatus(queueEntry.queueId!, 'completed');

      // Install module
      const installResult = await this.installationService.installModule(downloadedPath, {
        moduleType: moduleInfo.module_type,
        moduleName: moduleInfo.name,
        abbreviation: moduleInfo.abbreviation,
        version: moduleInfo.version,
        languageCode: moduleInfo.language_code,
        features: moduleInfo.features as ModuleFeature[],
        metadata: {
          description: moduleInfo.description,
          author: moduleInfo.author,
          publisher: moduleInfo.publisher,
          year_published: moduleInfo.year_published,
          license: moduleInfo.license,
          license_url: moduleInfo.license_url,
        }
      });

      return installResult;
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Uninstall a module
   */
  async uninstallModule(moduleId: number, removeUserData: boolean = false): Promise<boolean> {
    return this.installationService.uninstallModule(moduleId, removeUserData);
  }

  /**
   * Update a module
   */
  async updateModule(moduleId: number): Promise<InstallationResult> {
    try {
      // Get current module
      const currentModule = this.moduleMetadataRepo.getById(moduleId);
      if (!currentModule) {
        return {
          success: false,
          error: 'Module not found'
        };
      }

      // Check for available update
      const updateInfo = await this.checkForUpdate(moduleId);
      if (!updateInfo.hasUpdate) {
        return {
          success: false,
          error: 'No update available'
        };
      }

      // Uninstall old version
      await this.uninstallModule(moduleId, false);

      // Install new version using module abbreviation to find it in catalog
      const catalogModule = this.catalogService.getAllAvailableModules()
        .find(m => m.abbreviation === currentModule.abbreviation);

      if (!catalogModule) {
        return {
          success: false,
          error: 'Module not found in catalog'
        };
      }

      return this.installModule(catalogModule.module_id);
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Check for module update
   */
  async checkForUpdate(moduleId: number): Promise<UpdateCheckResult> {
    const module = this.moduleMetadataRepo.getById(moduleId);
    if (!module) {
      return {
        hasUpdate: false,
        currentVersion: ''
      };
    }

    // Find module in catalog
    const catalogModule = this.catalogService.getAllAvailableModules()
      .find(m => m.abbreviation === module.abbreviation);

    if (!catalogModule) {
      return {
        hasUpdate: false,
        currentVersion: module.version || ''
      };
    }

    // Compare versions
    const hasUpdate = catalogModule.version !== module.version;

    return {
      hasUpdate,
      currentVersion: module.version || '',
      availableVersion: catalogModule.version,
      downloadUrl: catalogModule.download_url,
      downloadSizeBytes: catalogModule.download_size_bytes
    };
  }

  /**
   * Get download progress
   */
  getDownloadProgress(queueId: number): DownloadProgress | undefined {
    return this.downloadService.getProgress(queueId);
  }

  /**
   * Get all active downloads
   */
  getActiveDownloads(): DownloadProgress[] {
    return this.downloadService.getActiveDownloads();
  }

  /**
   * Pause download
   */
  pauseDownload(queueId: number): void {
    this.downloadService.pauseDownload(queueId);
    this.downloadQueueRepo.updateStatus(queueId, 'paused');
  }

  /**
   * Resume download
   */
  async resumeDownload(queueId: number): Promise<void> {
    await this.downloadService.resumeDownload(queueId);
    this.downloadQueueRepo.updateStatus(queueId, 'downloading');
  }

  /**
   * Cancel download
   */
  cancelDownload(queueId: number): void {
    this.downloadService.cancelDownload(queueId);
    this.downloadQueueRepo.updateStatus(queueId, 'failed', 'Cancelled by user');
  }

  /**
   * Setup download service callbacks
   */
  private setupDownloadCallbacks(): void {
    // Progress callback
    this.downloadService.onProgress((progress) => {
      this.downloadQueueRepo.updateProgress(
        progress.queueId,
        progress.progressBytes,
        progress.speedBps
      );
    });

    // Error callback
    this.downloadService.onError((queueId, error) => {
      this.downloadQueueRepo.updateStatus(queueId, 'failed', error.message);
    });
  }
}
