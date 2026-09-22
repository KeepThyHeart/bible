import type { IModuleMetadataRepository } from '../Data/Repositories/IModuleMetadataRepository';
import type { IModuleConnection, IModuleStore } from '../Data/Access/ModuleStore';
import type { ICodecRegistry } from '../Data/Access/Codec';
import type { IModuleRepositoryFactory, ModuleRepositoryByType } from '../Data/Access/ModuleRepositoryFactory';

/**
 * Resolves a module's database_path (relative, from module_metadata) to an absolute filesystem path.
 */
export interface PathResolver {
  resolveModulePath(databasePath: string): string;
}

/**
 * Optional logger for module loading diagnostics.
 */
export interface ModuleLoaderLogger {
  error(message: string, ...args: unknown[]): void;
}

/**
 * What `ModuleLoader` needs to turn an open connection into a `TRepo`, for the
 * ONE module type this loader instance handles.
 *
 * Deliberately narrower than the general {@link IModuleRepositoryFactory}
 * (task 0026, revision 2, subtask M11): that interface is keyed by
 * `keyof ModuleRepositoryByType` and returns whichever repository a caller
 * asks for, because one factory instance can back several module types.
 * `ModuleLoader` only ever handles one - `moduleType` is fixed for its whole
 * lifetime - so binding it to `ModuleRepositoryByType`'s key union would only
 * add a type parameter every caller has to thread through for no benefit.
 * Instead, `ModuleLoader` stays exactly as generic over `TRepo` as it always
 * was; a real `IModuleRepositoryFactory` is adapted to this shape with one
 * closure - see {@link moduleRepositoryFactoryFor} - and a caller that has no
 * use for the full factory abstraction (the desktop `ModuleLoader` wrapper,
 * whose own callers hand it an arbitrary `createRepo`) can build one by hand
 * just as easily.
 */
export interface ModuleConnectionFactory<TRepo> {
  create(conn: IModuleConnection): TRepo | null;
}

/**
 * Adapt a real {@link IModuleRepositoryFactory} (keyed by module type) into
 * the narrower per-instance {@link ModuleConnectionFactory} shape
 * `ModuleLoader` takes - one closure, capturing the module type and codec
 * registry this loader instance was built for.
 */
export function moduleRepositoryFactoryFor<K extends keyof ModuleRepositoryByType>(
  factory: IModuleRepositoryFactory,
  type: K,
  codecs: ICodecRegistry
): ModuleConnectionFactory<ModuleRepositoryByType[K]> {
  return {
    create: (conn: IModuleConnection) => factory.create(conn, type, codecs),
  };
}

/**
 * Generic factory for lazy-loading module repositories with connection caching.
 *
 * This is the platform-agnostic version of the module loading pattern used by
 * both the desktop (Electron) and web (Express) apps. Platform-specific concerns
 * (path resolution, connection opening, logging) are injected via constructor.
 *
 * Task 0026, revision 2, subtask M11: this constructor takes an
 * {@link IModuleStore} plus a per-type {@link ModuleConnectionFactory} instead
 * of a raw SQL-provider factory and a `createRepo` callback, and an explicit
 * `readonly` - see that option's own doc comment for why the default is now
 * `true`.
 *
 * @example
 * ```typescript
 * const loader = new ModuleLoader({
 *   moduleType: 'commentary',
 *   metadataRepo: moduleMetadataRepo,
 *   pathResolver: { resolveModulePath: (p) => join(dataDir, p) },
 *   store: sqliteModuleStore,
 *   factory: moduleRepositoryFactoryFor(sqliteRepositoryFactory, 'commentary', codecs),
 * });
 *
 * const repo = loader.get('mhc');  // lazy-loads and caches
 * loader.closeAll();                // on app shutdown
 * ```
 */
export class ModuleLoader<TRepo> {
  private repos = new Map<string, TRepo>();
  private connections = new Map<string, IModuleConnection>();
  /** Timestamp (ms) when each module was loaded - used for TTL-based staleness checks. */
  private loadedAt = new Map<string, number>();
  /**
   * Timestamp (ms) of the last failed load per abbreviation.
   *
   * Successes were cached and failures were not, so every call for a missing
   * module repeated the metadata lookup, the `fileExists` stat and the log
   * line. Callers ask per rendered item - one chapter of commentary is dozens
   * of calls in a few milliseconds - so a single absent module filled the log
   * with the same two lines faster than it could be read. A miss is now
   * remembered and reported once per `failureTtlMs`.
   */
  private failedAt = new Map<string, number>();

  private moduleType: string;
  private metadataRepo: IModuleMetadataRepository;
  private pathResolver: PathResolver;
  private store: IModuleStore;
  private factory: ModuleConnectionFactory<TRepo>;
  private readonlyConnections: boolean;
  private onRepoCreated?: (repo: TRepo, abbreviation: string) => void;
  private fileExists: (path: string) => boolean;
  private logger?: ModuleLoaderLogger;
  /** Maximum age in ms before a cached repo is considered stale. 0 = no TTL. */
  private ttlMs: number;
  /**
   * How long a failed load is remembered before it is retried. Bounded rather
   * than permanent so a module installed while the app is running is still
   * picked up, without the caller having to know to call `evict`.
   */
  private failureTtlMs: number;

  constructor(options: {
    moduleType: string;
    metadataRepo: IModuleMetadataRepository;
    pathResolver: PathResolver;
    store: IModuleStore;
    factory: ModuleConnectionFactory<TRepo>;
    /**
     * Whether module connections open read-only. Defaults to `true`.
     *
     * Every write path into a module's own content tables
     * (`BibleRepository.batchInsertVerses`, `.deleteVerse`, the equivalent
     * methods on `CommentaryRepository`/`DictionaryRepository`/
     * `BookRepository`, ...) was already unreachable from any
     * `ModuleLoader`-obtained repository before this subtask: those methods
     * exist for the standalone import/build scripts (`scripts/import-*.js`),
     * which open their own connection directly and never go through
     * `ModuleLoader`. M5 (task 0026, revision 2) removed the one production
     * write path that DID run through a loaded module - the in-module search
     * index - so opening read-only by default changes nothing observable for
     * any caller that does not pass `false` explicitly.
     */
    readonly?: boolean;
    onRepoCreated?: (repo: TRepo, abbreviation: string) => void;
    /** Check if a file exists. Defaults to always returning true (caller responsible). */
    fileExists?: (path: string) => boolean;
    logger?: ModuleLoaderLogger;
    /** Maximum cache age in milliseconds. Defaults to 0 (no TTL). */
    ttlMs?: number;
    /** How long to remember a failed load before retrying it. Defaults to 30s. */
    failureTtlMs?: number;
  }) {
    this.moduleType = options.moduleType;
    this.metadataRepo = options.metadataRepo;
    this.pathResolver = options.pathResolver;
    this.store = options.store;
    this.factory = options.factory;
    this.readonlyConnections = options.readonly ?? true;
    this.onRepoCreated = options.onRepoCreated;
    this.fileExists = options.fileExists ?? (() => true);
    this.logger = options.logger;
    this.ttlMs = options.ttlMs ?? 0;
    this.failureTtlMs = options.failureTtlMs ?? 30_000;
  }

  /**
   * Get or create a repository for the given module abbreviation.
   * Returns null if the module doesn't exist or can't be loaded.
   */
  get(abbreviation: string): TRepo | null {
    const cached = this.repos.get(abbreviation);
    if (cached) {
      // If TTL is configured and the cache entry is stale, evict and reload
      if (this.ttlMs > 0) {
        const age = Date.now() - (this.loadedAt.get(abbreviation) ?? 0);
        if (age > this.ttlMs) {
          this.evict(abbreviation);
          // Fall through to reload below
        } else {
          return cached;
        }
      } else {
        return cached;
      }
    }

    // A remembered failure short-circuits before any lookup, stat or logging.
    // Without this the whole body below ran on every call for a module that is
    // simply not installed.
    const failedAt = this.failedAt.get(abbreviation);
    if (failedAt !== undefined && Date.now() - failedAt < this.failureTtlMs) {
      return null;
    }

    const metadata = this.metadataRepo.getByAbbreviation(abbreviation);
    if (!metadata || metadata.moduleType !== this.moduleType) {
      this.recordFailure(
        abbreviation,
        `[ModuleLoader:${this.moduleType}] Module not found: ${abbreviation}`,
      );
      return null;
    }

    const dbPath = this.pathResolver.resolveModulePath(metadata.databasePath);
    if (!this.fileExists(dbPath)) {
      this.recordFailure(
        abbreviation,
        `[ModuleLoader:${this.moduleType}] Database not found: ${dbPath}`,
      );
      return null;
    }

    try {
      const conn = this.store.open({ kind: 'file', path: dbPath }, { readonly: this.readonlyConnections });
      const repo = this.factory.create(conn);
      if (repo === null) {
        conn.close();
        this.recordFailure(
          abbreviation,
          `[ModuleLoader:${this.moduleType}] Factory produced no repository for ${dbPath}`,
        );
        return null;
      }

      this.connections.set(abbreviation, conn);
      this.repos.set(abbreviation, repo);
      this.loadedAt.set(abbreviation, Date.now());
      this.failedAt.delete(abbreviation);

      if (this.onRepoCreated) {
        this.onRepoCreated(repo, abbreviation);
      }

      return repo;
    } catch (error) {
      this.recordFailure(
        abbreviation,
        `[ModuleLoader:${this.moduleType}] Failed to load ${abbreviation}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Remember a failed load and log it. Only the attempt that actually ran is
   * logged - repeat callers inside the retry window return early above and say
   * nothing, so the log carries one line per genuine attempt.
   */
  private recordFailure(abbreviation: string, message: string, ...args: unknown[]): void {
    this.failedAt.set(abbreviation, Date.now());
    this.logger?.error(message, ...args);
  }

  /** Get all currently loaded repositories. */
  getAll(): Map<string, TRepo> {
    return this.repos;
  }

  /** Check if a repository is already loaded for the given abbreviation. */
  has(abbreviation: string): boolean {
    return this.repos.has(abbreviation);
  }

  /**
   * Evict a single module from the cache and close its database connection.
   * Useful when a module file has been updated or reinstalled.
   */
  evict(abbreviation: string): void {
    const conn = this.connections.get(abbreviation);
    if (conn) {
      try {
        conn.close();
      } catch {
        // Ignore close errors
      }
    }
    this.connections.delete(abbreviation);
    this.repos.delete(abbreviation);
    this.loadedAt.delete(abbreviation);
    // An explicit evict means "this module changed on disk" - forget the miss
    // so the next call retries immediately rather than waiting out the window.
    this.failedAt.delete(abbreviation);
  }

  /** Close all database connections. Call on app shutdown. */
  closeAll(): void {
    for (const conn of this.connections.values()) {
      try {
        conn.close();
      } catch {
        // Ignore close errors during shutdown
      }
    }
    this.connections.clear();
    this.repos.clear();
    this.loadedAt.clear();
    this.failedAt.clear();
  }
}
