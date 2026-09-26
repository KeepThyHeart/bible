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
import { isReadableFormatVersion } from '../Data/Format/ModuleFormat';

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
   * Install a module.
   *
   * @param catalogModuleId - The catalog module id to install.
   * @param catalogId - When given, resolve `catalogModuleId` only against
   *                    that catalog (see `IModuleCatalogService.getModuleInfo`)
   *                    rather than across every enabled catalog. First-run
   *                    starter-pack installs always pass this, so a
   *                    third-party catalog can never satisfy an install the
   *                    user believes is coming from the official one.
   */
  async installModule(catalogModuleId: string, catalogId?: number): Promise<InstallationResult> {
    try {
      // Get module info from catalog
      const moduleInfo = this.catalogService.getModuleInfo(catalogModuleId, catalogId);
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

      // Refuse a format_version this build cannot read before any network
      // request for the module payload starts - the whole point of carrying
      // format_version in the catalog is to make that refusal possible before
      // the download, not after it. Allow-list lookup only, never a numeric
      // comparison (see ModuleFormat.ts's doc comment on why a range would be
      // wrong). Absence of the field is not a violation - an older catalog
      // that predates it, or an entry this catalog schema has no opinion on,
      // simply has nothing to check (mirrors validateModuleFile.ts's posture).
      if (moduleInfo.format_version && !isReadableFormatVersion(moduleInfo.format_version)) {
        return {
          success: false,
          error: `"${moduleInfo.name}" uses format_version ${moduleInfo.format_version}, which this version of the app cannot read. Update the app to install this module.`
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

      // Determine temp file path. The extension follows what download_url
      // actually names, rather than assuming `.db.gz`: InstallationService's
      // own installModule() downstream branches on `sourcePath.endsWith('.gz')`
      // to decide whether to decompress, so this temp filename must agree with
      // the real payload or that branch picks the wrong path (attempts to
      // gunzip a non-gzip file, or skips decompressing one that needs it).
      // `.gz` (transport compression) is stripped first so a `.db.gz` payload
      // still contributes its real `.db` extension underneath, rather than
      // collapsing to just `.gz`.
      const downloadUrlPath = new URL(moduleInfo.download_url).pathname;
      const isGzipped = downloadUrlPath.endsWith('.gz');
      const withoutGz = isGzipped ? downloadUrlPath.slice(0, -'.gz'.length) : downloadUrlPath;
      const lastDot = withoutGz.lastIndexOf('.');
      const baseExtension = lastDot >= 0 ? withoutGz.slice(lastDot) : '.db';
      const extension = isGzipped ? `${baseExtension}.gz` : baseExtension;
      const fileName = `${moduleInfo.module_id}_v${moduleInfo.version}${extension}`;
      const tempFilePath = `${this.tempDownloadPath}/${fileName}`;

      // Start download. The catalog's checksum covers the unpacked module, so
      // the installation service checks it after unpacking, not the download.
      const downloadedPath = await this.downloadService.startDownload(
        queueEntry.queueId!,
        moduleInfo.download_url,
        tempFilePath
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
      }, moduleInfo.checksum
        ? {
            sha256: moduleInfo.checksum.replace('sha256:', ''),
            maxBytes: moduleInfo.installed_size_bytes || undefined,
          }
        : undefined);

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
