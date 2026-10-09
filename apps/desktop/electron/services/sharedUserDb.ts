import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import log from 'electron-log';
import { EncryptedSqliteProvider } from '../providers/EncryptedSqliteProvider';
import { getOrCreateEncryptionKey } from '../utils/encryptionKeyManager';
import { Backup } from '@bible/core';
import { dirname } from 'path';
import { createPreRestoreSnapshot } from './backup/nodeAdapters';

/**
 * Shared encrypted user database connection singleton.
 * Opens the user DB once and shares across session, notes, and highlight handlers.
 */

let userDb: EncryptedSqliteProvider | null = null;
/**
 * The in-flight open. `getSharedUserDb` used to test `if (!userDb)` and then
 * `await` the key lookup -- so every caller that arrived during that await saw
 * a null `userDb` and opened its own connection. At startup that is five
 * callers (session handlers, notes, highlights, the extension host, file
 * notes), i.e. five SQLCipher key derivations instead of one, serialised on the
 * main thread. Caching the PROMISE is what makes this a singleton.
 */
let userDbOpening: Promise<EncryptedSqliteProvider> | null = null;

/** Absolute path of the encrypted user database file (creating its folder). */
export function getUserDbPath(username: string = 'default'): string {
  const userDataPath = app.getPath('userData');
  const dbDir = join(userDataPath, 'data', 'users');

  // Ensure directory exists
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  return join(dbDir, `user_${username}.db`);
}

/**
 * Get the shared encrypted user database, opening it on first access.
 */
export async function getSharedUserDb(username: string = 'default'): Promise<EncryptedSqliteProvider> {
  if (userDb) return userDb;
  if (!userDbOpening) {
    userDbOpening = (async () => {
      const dbPath = getUserDbPath(username);
      log.info('[SharedUserDb] Opening encrypted user database at:', dbPath);

      const encryptionKey = await getOrCreateEncryptionKey();
      const db = new EncryptedSqliteProvider(dbPath, encryptionKey);
      // Task 0150: the user schema moves to v3 (new tables only). Keep a copy of an
      // existing database first; a failed copy only warns.
      try {
        const before = Backup.readUserSchemaVersion(db);
        if (before > 0 && before < Backup.USER_SCHEMA_VERSION) {
          db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
          createPreRestoreSnapshot({ userDbPath: dbPath, root: join(dirname(dbPath), 'pre-migration'), keep: 3 });
          log.info(`[SharedUserDb] user schema v${before} -> v${Backup.USER_SCHEMA_VERSION}: copied the database first`);
        }
      } catch (e) {
        log.warn('[SharedUserDb] pre-migration copy failed', e);
      }
      userDb = db;

      log.info('[SharedUserDb] Encrypted user database opened successfully');
      return db;
    })().catch((err: unknown) => {
      // A failed open must not poison every later attempt.
      userDbOpening = null;
      throw err;
    });
  }
  return userDbOpening;
}

/**
 * Close the shared user database connection. Call on app shutdown.
 */
export function closeSharedUserDb(): void {
  if (userDb) {
    try {
      userDb.close();
      log.info('[SharedUserDb] User database closed');
    } catch (error) {
      log.error('[SharedUserDb] Error closing user database:', error);
    }
    userDb = null;
    userDbOpening = null;
  }
}
