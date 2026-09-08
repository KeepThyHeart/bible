import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import log from 'electron-log';
import { EncryptedSqliteProvider } from '../providers/EncryptedSqliteProvider';
import { getOrCreateEncryptionKey } from '../utils/encryptionKeyManager';

/**
 * Shared encrypted user database connection singleton.
 * Opens the user DB once and shares across session, notes, and highlight handlers.
 */

let userDb: EncryptedSqliteProvider | null = null;

function getUserDbPath(username: string = 'default'): string {
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
  if (!userDb) {
    const dbPath = getUserDbPath(username);
    log.info('[SharedUserDb] Opening encrypted user database at:', dbPath);

    const encryptionKey = await getOrCreateEncryptionKey();
    userDb = new EncryptedSqliteProvider(dbPath, encryptionKey);

    log.info('[SharedUserDb] Encrypted user database opened successfully');
  }
  return userDb;
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
  }
}
