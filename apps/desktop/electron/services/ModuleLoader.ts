import { existsSync } from 'fs';
import log from 'electron-log';
import { getSharedModuleMetadataRepo } from './sharedMainDb';
import { resolveModulePath } from '../utils/appPaths';
import { createRegistrySqlFactory } from './ModuleDatabaseRegistry';
import { ModuleLoader as CoreModuleLoader, SqliteModuleStore } from '@bible/core';
import type { ISql, IModuleConnection } from '@bible/core';

/**
 * Desktop-specific ModuleLoader that wraps the core ModuleLoader with
 * Electron platform bindings (electron-log, better-sqlite3, app paths).
 *
 * Task 0026, revision 2, subtask M11: internally this now builds a
 * `SqliteModuleStore` (driven by the same `ModuleDatabaseRegistry`-backed
 * SQLite driver the old `sqlFactory` used) and a tiny per-instance
 * connection factory that just forwards to the `createRepo` callback this
 * class's own callers already supply - the public constructor below is
 * UNCHANGED (`ipc/bibleHandlers.ts` and its siblings, which are not part of
 * this subtask's scope, all keep calling `new ModuleLoader('bible', (db) =>
 * new BibleRepository(db), ...)` exactly as before).
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
    // The store's driver delegates to ModuleDatabaseRegistry so every module
    // DB connection - whether opened via abbreviation (this class) or
    // numeric moduleId (studyHandlers) - shares a single handle owned by the
    // registry.
    const store = new SqliteModuleStore(createRegistrySqlFactory(moduleType));

    this.core = new CoreModuleLoader<TRepo>({
      moduleType,
      metadataRepo: getSharedModuleMetadataRepo(),
      pathResolver: { resolveModulePath },
      store,
      // `IModuleConnection.sql` is present for every connection this store
      // opens (it only ever opens SQLite files) - `createRepo` gets exactly
      // the `ISql` it always got.
      factory: { create: (conn: IModuleConnection) => (conn.sql ? createRepo(conn.sql) : null) },
      // Defaults to true at the core level (M5 removed every production
      // write path into module content); left implicit here rather than
      // repeated, since this class has only ever opened module content, never
      // a user database.
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
