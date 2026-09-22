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
 * class's own callers already supply - the public constructor's first three
 * parameters are UNCHANGED (`ipc/bibleHandlers.ts` and its siblings, which
 * are not part of this subtask's scope, all keep calling
 * `new ModuleLoader('bible', (db) => new BibleRepository(db), ...)` exactly
 * as before).
 *
 * A fourth, optional `readonly` parameter was added as a same-day follow-up
 * fix to M11's own commit, once independent verification caught what the
 * subtask's own "no production write path remains" check had missed: the
 * core `ModuleLoader`'s new `readonly: true` default is correct for every
 * OTHER desktop module type, but not for `'bible'`. `BibleRepository
 * .buildBookIndex()` - the book-level proximity ("word within N of word")
 * search index - still writes lazily into the module's own file on first
 * use; M3/M5 (task 0026, revision 2) deliberately left this path unmigrated
 * ("searchProximity ... deliberately NOT routed through the registry" - see
 * those subtasks' own notes), so it is a real, live, still-necessary write
 * path, not a leftover the M11 grep-for-write-methods check should have
 * ignored. `ipc/bibleHandlers.ts` passes `readonly: false` explicitly for
 * exactly this reason - see that file's own comment at its one call site.
 * Reproduced directly before this fix: opening a real installed Bible module
 * read-only and attempting the same `INSERT INTO book_search_index` write
 * `buildBookIndex()` performs throws `attempt to write a readonly database`;
 * `BibleSearchService`'s proximity-search caller catches exactly that error
 * and silently skips the module (`isReadOnlyDatabaseError(e)`) rather than
 * failing the whole query - so the regression this fixes was never a crash,
 * only a silent, total loss of proximity-search results for every Bible
 * module on desktop, which no existing test happened to cover (there is no
 * `buildBookIndex`/`searchProximity`/`book_search_index` test anywhere under
 * `apps/desktop/electron`).
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
   * @param readonly - Whether module connections open read-only. Defaults to
   *   `true` (matches the core `ModuleLoader`'s own default - see this
   *   class's doc comment for why `'bible'` is the one caller that must
   *   override it to `false` today).
   */
  constructor(
    moduleType: string,
    createRepo: (db: ISql) => TRepo,
    onRepoCreated?: (repo: TRepo, abbreviation: string) => void,
    readonly?: boolean
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
      readonly,
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
