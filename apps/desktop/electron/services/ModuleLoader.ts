import { existsSync } from 'fs';
import log from 'electron-log';
import { getSharedModuleMetadataRepo } from './sharedMainDb';
import { resolveModulePath } from '../utils/appPaths';
import { createRegistrySqlFactory } from './ModuleDatabaseRegistry';
import {
  ModuleLoader as CoreModuleLoader,
  SqliteModuleStore,
  SqliteModuleRepositoryFactory,
  moduleRepositoryFactoryFor,
  nodeCodecRegistry,
} from '@bible/core';
import type {
  ModuleRepositoryByType,
  ModuleConnectionFactory,
  ICodecRegistry,
  BibleRepository,
  CommentaryRepository,
  DictionaryRepository,
  BookRepository,
  TopicalIndexRepository,
  CrossReferenceRepository,
  TagGraphRepository,
} from '@bible/core';

/**
 * One `SqliteModuleRepositoryFactory` and one codec registry, shared by
 * every desktop `ModuleLoader` instance (task 0034, finishing M11's
 * construction migration - this is the same "cheap to construct, share it"
 * posture `apps/web/server/DatabaseManager.ts` already takes with its own
 * instances of these two).
 */
const repositoryFactory = new SqliteModuleRepositoryFactory();
const codecs: ICodecRegistry = nodeCodecRegistry();

/**
 * `IModuleRepositoryFactory.create()` (and so `moduleRepositoryFactoryFor()`)
 * is typed to hand back the per-type INTERFACE (`IBibleRepository`, ...) -
 * deliberately, per M11's design doc, so a caller of the factory abstraction
 * never depends on a concrete repository's extra surface. Every caller of
 * THIS class, unchanged by task 0034, was written against the CONCRETE class
 * (`BibleRepository`, not `IBibleRepository`) - matching every other desktop
 * file that already imports these types directly, and the extension bridges
 * (`extensions/bridges/*.ts`), whose `deps` interfaces name the concrete
 * classes too. This maps each `ModuleRepositoryByType` key to the concrete
 * class `SqliteModuleRepositoryFactory` is KNOWN to build for it - matching
 * `apps/web/server/DatabaseManager.ts`'s own `asConcreteFactory` for exactly
 * the same reason - so this class can keep returning the concrete type its
 * six callers already depend on.
 */
interface ConcreteModuleRepositoryByType {
  bible: BibleRepository;
  commentary: CommentaryRepository;
  dictionary: DictionaryRepository;
  book: BookRepository;
  topicalIndex: TopicalIndexRepository;
  crossRef: CrossReferenceRepository;
  tagGraph: TagGraphRepository;
}

function asConcreteFactory<K extends keyof ModuleRepositoryByType>(
  factory: ModuleConnectionFactory<ModuleRepositoryByType[K]>
): ModuleConnectionFactory<ConcreteModuleRepositoryByType[K]> {
  return factory as unknown as ModuleConnectionFactory<ConcreteModuleRepositoryByType[K]>;
}

/**
 * Desktop-specific ModuleLoader that wraps the core ModuleLoader with
 * Electron platform bindings (electron-log, better-sqlite3, app paths).
 *
 * Task 0026, revision 2, subtask M11: internally this builds a
 * `SqliteModuleStore` (driven by the same `ModuleDatabaseRegistry`-backed
 * SQLite driver the old `sqlFactory` used).
 *
 * Task 0034 (finishing M11): the constructor's second parameter changed
 * from a raw `createRepo: (db: ISql) => TRepo` callback to `repoType: K`, a
 * key of `ModuleRepositoryByType` - every one of this class's six callers
 * passed exactly `(db) => new XRepository(db)` (or, for `'commentary'`,
 * with `codecs` already defaulted internally), which is now `moduleType`'s
 * own `X` looked up through the shared `IModuleRepositoryFactory` seam
 * instead of hand-rolled per call site. `TRepo` is now derived from `K`
 * (`ModuleRepositoryByType[K]`) rather than an independent type parameter -
 * every caller already constructed exactly that concrete class, so nothing
 * observable changes; see `ipc/bibleHandlers.ts` and its five siblings for
 * the updated call sites.
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
 * const loader = new ModuleLoader('commentary', 'commentary');
 * await loader.ensure('mhc');       // opens (may await), caches
 * const repo = loader.get('mhc');   // cache hit - sync, cheap, safe in a loop
 * loader.closeAll();                // on app shutdown
 * ```
 */
export class ModuleLoader<K extends keyof ModuleRepositoryByType> {
  private core: CoreModuleLoader<ConcreteModuleRepositoryByType[K]>;

  /**
   * @param moduleType - Expected module type string (e.g., 'bible', 'commentary')
   * @param repoType - Which `ModuleRepositoryByType` key this loader
   *   constructs - `moduleType` and `repoType` name the same content but do
   *   not always spell it the same way (`'cross_reference'` vs `'crossRef'`,
   *   `'topical_index'` vs `'topicalIndex'`); both are required because
   *   `moduleType` is also the string `module_metadata.module_type` stores.
   * @param onRepoCreated - Optional callback after a repo is created (e.g., for ensureSearchTablesExist)
   * @param readonly - Whether module connections open read-only. Defaults to
   *   `true` (matches the core `ModuleLoader`'s own default - see this
   *   class's doc comment for why `'bible'` is the one caller that must
   *   override it to `false` today).
   */
  constructor(
    moduleType: string,
    repoType: K,
    onRepoCreated?: (repo: ConcreteModuleRepositoryByType[K], abbreviation: string) => void,
    readonly?: boolean
  ) {
    // The store's driver delegates to ModuleDatabaseRegistry so every module
    // DB connection - whether opened via abbreviation (this class) or
    // numeric moduleId (studyHandlers) - shares a single handle owned by the
    // registry.
    const store = new SqliteModuleStore(createRegistrySqlFactory(moduleType));

    this.core = new CoreModuleLoader<ConcreteModuleRepositoryByType[K]>({
      moduleType,
      metadataRepo: getSharedModuleMetadataRepo(),
      pathResolver: { resolveModulePath },
      store,
      factory: asConcreteFactory<K>(moduleRepositoryFactoryFor(repositoryFactory, repoType, codecs)),
      readonly,
      onRepoCreated,
      fileExists: existsSync,
      logger: log,
    });
  }

  /**
   * Ensure a repository is loaded and cached for the given module
   * abbreviation - opening it if it is not already cached. Call this once
   * per module, before the (synchronous) `get()` reads that follow it - see
   * `@bible/core`'s `ModuleLoader.ensure()`/`.get()` doc comment (task 0034).
   */
  ensure(abbreviation: string): Promise<ConcreteModuleRepositoryByType[K] | null> {
    return this.core.ensure(abbreviation);
  }

  /**
   * Get an already-cached repository for the given module abbreviation.
   * Returns null on a cache miss - call `ensure()` first to load one.
   */
  get(abbreviation: string): ConcreteModuleRepositoryByType[K] | null {
    return this.core.get(abbreviation);
  }

  /** Get all currently loaded repositories. */
  getAll(): Map<string, ConcreteModuleRepositoryByType[K]> {
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
