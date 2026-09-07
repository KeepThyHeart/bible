import type { ISql } from '../Data/Core/ISql';
import type { IModuleMetadataRepository } from '../Data/Repositories/IModuleMetadataRepository';

/**
 * Resolves a module's database_path (relative, from module_metadata) to an absolute filesystem path.
 */
export interface PathResolver {
  resolveModulePath(databasePath: string): string;
}

/**
 * Creates ISql provider instances. Platform packages supply the concrete implementation
 * (e.g., better-sqlite3 for Electron, sql.js for browser).
 */
export interface SqlProviderFactory {
  create(absolutePath: string): ISql;
}

/**
 * Optional logger for module loading diagnostics.
 */
export interface ModuleLoaderLogger {
  error(message: string, ...args: unknown[]): void;
}

/**
 * Generic factory for lazy-loading module repositories with connection caching.
 *
 * This is the platform-agnostic version of the module loading pattern used by
 * both the desktop (Electron) and web (Express) apps. Platform-specific concerns
 * (path resolution, SQLite driver, logging) are injected via constructor.
 *
 * @example
 * ```typescript
 * const loader = new ModuleLoader({
 *   moduleType: 'commentary',
 *   metadataRepo: moduleMetadataRepo,
 *   pathResolver: { resolveModulePath: (p) => join(dataDir, p) },
 *   sqlFactory: { create: (p) => new SqliteProvider(p) },
 *   createRepo: (db) => new CommentaryRepository(db),
 * });
 *
 * const repo = loader.get('mhc');  // lazy-loads and caches
 * loader.closeAll();                // on app shutdown
 * ```
 */
export class ModuleLoader<TRepo> {
  private repos = new Map<string, TRepo>();
  private dbs = new Map<string, ISql>();
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
  private sqlFactory: SqlProviderFactory;
  private createRepo: (db: ISql) => TRepo;
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
    sqlFactory: SqlProviderFactory;
    createRepo: (db: ISql) => TRepo;
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
    this.sqlFactory = options.sqlFactory;
    this.createRepo = options.createRepo;
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
      const db = this.sqlFactory.create(dbPath);
      const repo = this.createRepo(db);

      this.dbs.set(abbreviation, db);
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
    const db = this.dbs.get(abbreviation);
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
    this.dbs.delete(abbreviation);
    this.repos.delete(abbreviation);
    this.loadedAt.delete(abbreviation);
    // An explicit evict means "this module changed on disk" - forget the miss
    // so the next call retries immediately rather than waiting out the window.
    this.failedAt.delete(abbreviation);
  }

  /** Close all database connections. Call on app shutdown. */
  closeAll(): void {
    for (const db of this.dbs.values()) {
      try {
        db.close();
      } catch {
        // Ignore close errors during shutdown
      }
    }
    this.dbs.clear();
    this.repos.clear();
    this.loadedAt.clear();
    this.failedAt.clear();
  }
}
