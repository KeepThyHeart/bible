import log from 'electron-log';
import { existsSync } from 'fs';
import type { ISql } from '@bible/core';
import { SqliteProvider } from '../providers/SqliteProvider';
import { resolveModulePath } from '../utils/appPaths';
import { getSharedModuleMetadataRepo } from './sharedMainDb';

/**
 * Options accepted when opening a module database. Matches the subset of
 * SqliteProvider options that matter to callers (readonly is the only knob
 * currently exercised by the handlers).
 */
export interface ModuleDbOpenOptions {
  readonly?: boolean;
}

/**
 * Internal cache entry. `path` is the absolute filesystem path and acts as
 * the canonical key - every lookup form (moduleId, abbreviation) resolves
 * to a path first, then hits this cache, so duplicate connections are
 * impossible regardless of which handler opens the DB first.
 */
interface CacheEntry {
  path: string;
  readonly: boolean;
  provider: SqliteProvider;
}

/**
 * Centralized cache + lifecycle manager for every module database opened by
 * the Electron main process.
 *
 * Connection ownership is centralized here so that handlers do not each keep
 * a private cache keyed by abbreviation or moduleId, re-open a database another
 * handler already holds, or spin up ad-hoc `new SqliteProvider(...)` instances.
 *
 * The registry gives us one place that knows about every open module DB and
 * one `closeAll()` call to run at shutdown. `ModuleLoader` delegates its
 * SQL factory here, so both the abbreviation-based loader path and the
 * moduleId-based study path share the same connection object.
 */
export class ModuleDatabaseRegistry {
  /** Keyed by absolute filesystem path. */
  private entries = new Map<string, CacheEntry>();

  /**
   * Open (or reuse) a module DB by absolute file path. This is the low-level
   * entry point - `openByModuleId` / `openByAbbreviation` resolve to a path
   * and then call through here.
   *
   * Returns `null` if the file does not exist. If a cached entry exists with
   * the same path but a different readonly flag, the cached entry is returned
   * unchanged (the first opener wins; handlers should agree on readonly).
   */
  openByPath(absolutePath: string, opts: ModuleDbOpenOptions = {}): SqliteProvider | null {
    const existing = this.entries.get(absolutePath);
    if (existing && existing.provider.isOpen()) {
      return existing.provider;
    }
    if (existing) {
      // Cached handle was closed out-of-band - drop it and re-open.
      this.entries.delete(absolutePath);
    }

    if (!existsSync(absolutePath)) {
      log.warn(`[ModuleDatabaseRegistry] Database not found: ${absolutePath}`);
      return null;
    }

    try {
      const readonly = opts.readonly ?? false;
      const provider = new SqliteProvider(absolutePath, { readonly });
      this.entries.set(absolutePath, { path: absolutePath, readonly, provider });
      log.debug(`[ModuleDatabaseRegistry] Opened ${absolutePath} (readonly=${readonly})`);
      return provider;
    } catch (error) {
      log.error(`[ModuleDatabaseRegistry] Failed to open ${absolutePath}:`, error);
      return null;
    }
  }

  /**
   * Open a module DB by numeric module_id (as stored in `module_metadata`).
   * Resolves the relative `database_path` column through `resolveModulePath`.
   */
  openByModuleId(moduleId: number, opts: ModuleDbOpenOptions = {}): SqliteProvider | null {
    try {
      const metadata = getSharedModuleMetadataRepo().getById(moduleId);
      if (!metadata) {
        log.warn(`[ModuleDatabaseRegistry] Module ${moduleId} not found in main database`);
        return null;
      }
      const absPath = resolveModulePath(metadata.databasePath);
      return this.openByPath(absPath, opts);
    } catch (error) {
      log.error(`[ModuleDatabaseRegistry] Error resolving module ${moduleId}:`, error);
      return null;
    }
  }

  /**
   * Open a module DB by abbreviation (+ optional moduleType guard). Used by
   * the desktop `ModuleLoader` wrapper so every abbreviation-based lookup
   * funnels through the same cache as moduleId-based lookups.
   */
  openByAbbreviation(
    abbreviation: string,
    moduleType?: string,
    opts: ModuleDbOpenOptions = {}
  ): SqliteProvider | null {
    try {
      const metadata = getSharedModuleMetadataRepo().getByAbbreviation(abbreviation);
      if (!metadata) {
        return null;
      }
      if (moduleType && metadata.moduleType !== moduleType) {
        return null;
      }
      const absPath = resolveModulePath(metadata.databasePath);
      return this.openByPath(absPath, opts);
    } catch (error) {
      log.error(`[ModuleDatabaseRegistry] Error resolving abbreviation ${abbreviation}:`, error);
      return null;
    }
  }

  /**
   * Evict a single entry by absolute path (closes the connection). Safe to
   * call for unknown paths.
   */
  close(absolutePath: string): void {
    const entry = this.entries.get(absolutePath);
    if (!entry) return;
    try {
      if (entry.provider.isOpen()) entry.provider.close();
    } catch (error) {
      log.error(`[ModuleDatabaseRegistry] Error closing ${absolutePath}:`, error);
    }
    this.entries.delete(absolutePath);
  }

  /** Number of currently cached connections - exposed for diagnostics/tests. */
  size(): number {
    return this.entries.size;
  }

  /**
   * Check whether a given path is already cached. Mostly useful for tests;
   * production code should just call `openByPath` which is idempotent.
   */
  has(absolutePath: string): boolean {
    return this.entries.has(absolutePath);
  }

  /** Close every cached connection. Call on app shutdown (`will-quit`). */
  closeAll(): void {
    for (const entry of this.entries.values()) {
      try {
        if (entry.provider.isOpen()) entry.provider.close();
      } catch (error) {
        log.error(`[ModuleDatabaseRegistry] Error closing ${entry.path} during shutdown:`, error);
      }
    }
    this.entries.clear();
  }
}

/** Process-wide singleton. The Electron main process is the only consumer. */
let singleton: ModuleDatabaseRegistry | null = null;

export function getModuleDatabaseRegistry(): ModuleDatabaseRegistry {
  if (!singleton) singleton = new ModuleDatabaseRegistry();
  return singleton;
}

/** Expose the ISql factory shape that the core ModuleLoader expects. */
export function createRegistrySqlFactory(moduleType: string): { create: (path: string) => ISql } {
  return {
    create: (absolutePath: string): ISql => {
      const registry = getModuleDatabaseRegistry();
      const provider = registry.openByPath(absolutePath);
      if (!provider) {
        // The ModuleLoader contract wants a thrown error here so the
        // `try { sqlFactory.create(...) } catch` in the core loader turns
        // this into a clean null return rather than a partially-initialized
        // cache entry.
        throw new Error(`[ModuleDatabaseRegistry] Could not open ${moduleType} module at ${absolutePath}`);
      }
      return provider;
    },
  };
}

/** Test-only reset hook. Not exported from index; only used by unit tests. */
export function __resetModuleDatabaseRegistryForTests(): void {
  if (singleton) singleton.closeAll();
  singleton = null;
}
