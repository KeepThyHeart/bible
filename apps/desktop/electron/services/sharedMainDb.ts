import { existsSync } from 'fs';
import log from 'electron-log';
import { SqliteProvider } from '../providers/SqliteProvider';
import { BibleBookRepository, ModuleMetadataRepository } from '@bible/core';
import { resolveMainDbPath } from '../utils/appPaths';

/**
 * Shared main.db connection singleton.
 * Opens main.db once and provides shared repositories to all handlers.
 */

let mainDb: SqliteProvider | null = null;
let moduleMetadataRepo: ModuleMetadataRepository | null = null;
let bookRepo: BibleBookRepository | null = null;

function getMainDbPath(): string {
  return resolveMainDbPath();
}

/**
 * Get the shared main.db SqliteProvider, opening it on first access.
 */
export function getSharedMainDb(): SqliteProvider {
  if (!mainDb) {
    const mainDbPath = getMainDbPath();
    log.info('[SharedMainDb] Opening main.db from:', mainDbPath);
    log.info('[SharedMainDb] Main database exists:', existsSync(mainDbPath));

    mainDb = new SqliteProvider(mainDbPath);
    log.info('[SharedMainDb] Main database opened successfully');
  }
  return mainDb;
}

/**
 * Get the shared ModuleMetadataRepository.
 */
export function getSharedModuleMetadataRepo(): ModuleMetadataRepository {
  if (!moduleMetadataRepo) {
    moduleMetadataRepo = new ModuleMetadataRepository(getSharedMainDb());
  }
  return moduleMetadataRepo;
}

/**
 * Get the shared BibleBookRepository.
 */
export function getSharedBookRepo(): BibleBookRepository {
  if (!bookRepo) {
    bookRepo = new BibleBookRepository(getSharedMainDb());
  }
  return bookRepo;
}

/**
 * Close the shared main.db connection. Call on app shutdown.
 */
export function closeSharedMainDb(): void {
  if (mainDb) {
    try {
      mainDb.close();
      log.info('[SharedMainDb] Main database closed');
    } catch (error) {
      log.error('[SharedMainDb] Error closing main database:', error);
    }
    mainDb = null;
    moduleMetadataRepo = null;
    bookRepo = null;
  }
}
