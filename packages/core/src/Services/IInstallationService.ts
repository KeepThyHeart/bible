import { ModuleMetadata } from '../Data/Models/Main/ModuleMetadata';
import { InstallationResult } from '../Data/Core/CatalogTypes';

/**
 * Installation service interface
 * Handles module installation, verification, and removal
 */
export interface IInstallationService {
  /**
   * Install a native format module
   * @param sourcePath - Path to the downloaded module file
   * @param moduleInfo - Module metadata from catalog
   * @returns Installation result with module ID
   */
  installModule(sourcePath: string, moduleInfo: Partial<ModuleMetadata>): Promise<InstallationResult>;

  /**
   * Verify module integrity
   * @param dbPath - Path to module database file
   * @returns True if module is valid
   */
  verifyModule(dbPath: string): Promise<boolean>;

  /**
   * Register module in main database
   * @param moduleInfo - Module metadata
   * @returns Module ID
   */
  registerModule(moduleInfo: ModuleMetadata): Promise<number>;

  /**
   * Uninstall a module
   * @param moduleId - Module ID to uninstall
   * @param removeUserData - Whether to remove associated user data
   * @returns True if successful
   */
  uninstallModule(moduleId: number, removeUserData?: boolean): Promise<boolean>;

  /**
   * Get module installation path
   * @param moduleType - Type of module
   * @param moduleId - Module identifier
   * @returns Full path to module database
   */
  getModulePath(moduleType: string, moduleId: string): string;

  /**
   * Decompress a gzipped module file
   * @param sourcePath - Path to .gz file
   * @param destinationPath - Path to output file
   */
  decompressModule(sourcePath: string, destinationPath: string): Promise<void>;

  /**
   * Get module size on disk
   * @param dbPath - Path to module database
   * @returns Size in bytes
   */
  getModuleSize(dbPath: string): Promise<number>;

  /**
   * Extract module information from a module database file
   * @param dbPath - Path to module database (.db or .db.gz)
   * @returns Module metadata extracted from module_info table
   */
  extractModuleInfo(dbPath: string): Promise<Partial<ModuleMetadata>>;
}
