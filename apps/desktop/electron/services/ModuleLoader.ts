import { existsSync } from 'fs';
import log from 'electron-log';
import { getSharedModuleMetadataRepo } from './sharedMainDb';
import { resolveModulePath } from '../utils/appPaths';
import { createRegistrySqlFactory } from './ModuleDatabaseRegistry';
import { ModuleLoader as CoreModuleLoader } from '@bible/core';
import type { ISql } from '@bible/core';

/**
 * Desktop-specific ModuleLoader that wraps the core ModuleLoader with
 * Electron platform bindings (electron-log, better-sqlite3, app paths).
 *
 * @example
 * ```typescript
 * const loader = new ModuleLoader('commentary', (db) => new CommentaryRepository(db));
 * const repo = loader.get('mhc'); // lazy-loads and caches
 * loader.closeAll();               // on app shutdown
 * ```
 */
export class ModuleLoader<TRepo> {
  private core: CoreModuleLoader<TRepo>;

  /**
   * @param moduleType - Expected module type string (e.g., 'bible', 'commentary')
   * @param createRepo - Factory function that creates a repository from an ISql provider
   * @param onRepoCreated - Optional callback after a repo is created (e.g., for ensureSearchTablesExist)
   */
  constructor(
    moduleType: string,
    createRepo: (db: ISql) => TRepo,
    onRepoCreated?: (repo: TRepo, abbreviation: string) => void
  ) {
    // SQL factory delegates to ModuleDatabaseRegistry so every module DB
    // connection - whether opened via abbreviation (ModuleLoader) or numeric
    // moduleId (studyHandlers) - shares a single handle owned by the registry.
    this.core = new CoreModuleLoader({
      moduleType,
      metadataRepo: getSharedModuleMetadataRepo(),
      pathResolver: { resolveModulePath },
      sqlFactory: createRegistrySqlFactory(moduleType),
      createRepo,
      onRepoCreated,
      fileExists: existsSync,
      logger: log,
    });
  }

  /**
   * Get or create a repository for the given module abbreviation.
   * Returns null if the module doesn't exist or can't be loaded.
   */
  get(abbreviation: string): TRepo | null {
    return this.core.get(abbreviation);
  }

  /** Get all currently loaded repositories. */
  getAll(): Map<string, TRepo> {
    return this.core.getAll();
  }

  /**
   * Evict a single module from the cache and close its database connection.
   * Useful after a module has been reinstalled or updated on disk.
   */
  evict(abbreviation: string): void {
    this.core.evict(abbreviation);
  }

  /** Close all database connections. Call on app shutdown. */
  closeAll(): void {
    this.core.closeAll();
  }
}
