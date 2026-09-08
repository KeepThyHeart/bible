import * as crypto from 'crypto';
import { app, safeStorage } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import log from 'electron-log';

const KEY_FILENAME = 'encryption-key.enc';

let cachedKey: string | null = null;

function getKeyFilePath(): string {
  const dir = join(app.getPath('userData'), 'secrets');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return join(dir, KEY_FILENAME);
}

function readEncryptedKey(): string | null {
  const path = getKeyFilePath();
  if (!existsSync(path)) return null;
  try {
    const blob = readFileSync(path);
    return safeStorage.decryptString(blob);
  } catch (err) {
    log.error('[Encryption] Failed to decrypt key file:', err);
    return null;
  }
}

function writeEncryptedKey(hexKey: string): void {
  const blob = safeStorage.encryptString(hexKey);
  writeFileSync(getKeyFilePath(), blob, { mode: 0o600 });
}

// One-shot migration from the old keytar-backed key store. keytar is no longer
// a dependency - the dynamic require below is best-effort, and a missing or
// broken binding is treated as "no prior key to migrate."
interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

async function migrateFromKeytar(): Promise<string | null> {
  let keytar: KeytarLike;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    keytar = require('keytar') as KeytarLike;
  } catch {
    return null;
  }
  try {
    const key = await keytar.getPassword('bible-desktop-app', 'user-db-encryption-key');
    if (!key) return null;
    log.info('[Encryption] Migrating encryption key from OS keychain to safeStorage');
    writeEncryptedKey(key);
    try {
      await keytar.deletePassword('bible-desktop-app', 'user-db-encryption-key');
    } catch (err) {
      log.warn('[Encryption] Failed to remove old keytar entry after migration:', err);
    }
    return key;
  } catch (err) {
    log.warn('[Encryption] keytar migration attempt failed:', err);
    return null;
  }
}

/**
 * Get or create the encryption key for user databases.
 *
 * Stores the key as a safeStorage-encrypted blob under userData/secrets/.
 * On first run after upgrading from a keytar-based install, migrates any
 * existing key out of the OS keychain. Cached in memory after first call.
 */
export async function getOrCreateEncryptionKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  // The deterministic test key must NEVER be used by a real (packaged) install,
  // even if NODE_ENV=test leaks into its environment - that would make every
  // user's database trivially decryptable. Gate it on `!app.isPackaged`.
  if (process.env.NODE_ENV === 'test' && !app.isPackaged) {
    log.info('[Encryption] Test mode: using deterministic encryption key');
    cachedKey = crypto.createHash('sha256').update('bible-test-key').digest('hex');
    return cachedKey;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption key storage unavailable: Electron safeStorage cannot encrypt on this system');
  }

  const existing = readEncryptedKey();
  if (existing) {
    log.info('[Encryption] Loaded encryption key from safeStorage');
    cachedKey = existing;
    return existing;
  }

  const migrated = await migrateFromKeytar();
  if (migrated) {
    cachedKey = migrated;
    return migrated;
  }

  log.info('[Encryption] No encryption key found, generating new key...');
  const key = crypto.randomBytes(32).toString('hex');
  writeEncryptedKey(key);
  log.info('[Encryption] New encryption key generated and stored via safeStorage');
  cachedKey = key;
  return key;
}

/**
 * Delete the encryption key. WARNING: encrypted databases become unreadable.
 */
export async function deleteEncryptionKey(): Promise<boolean> {
  const path = getKeyFilePath();
  if (!existsSync(path)) {
    log.info('[Encryption] No encryption key found to delete');
    return false;
  }
  unlinkSync(path);
  cachedKey = null;
  log.warn('[Encryption] Encryption key file deleted');
  return true;
}

export async function hasEncryptionKey(): Promise<boolean> {
  return existsSync(getKeyFilePath());
}
