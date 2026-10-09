/**
 * The sync server's 32-byte secret (HMAC for fake prelogin salts), generated once and kept next to the
 * sync database. Never logged. Losing it only changes the fake salts handed to unknown emails, but a
 * changing value would let an attacker tell real accounts from unknown ones, so it is persisted and an
 * unreadable or short file is an error rather than a reason to regenerate.
 */

import { randomBytes } from 'crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from 'fs';
import { join } from 'path';

export const SECRET_FILE = 'server-secret.key';
const SECRET_BYTES = 32;

/** `<appState>/plugin-data/sync`. */
export function syncStateDir(appStateDir: string): string {
  return join(appStateDir, 'plugin-data', 'sync');
}

/** Reads the secret from `dir`, creating it (mode 0600, exclusive create) when absent. */
export function loadOrCreateServerSecret(dir: string): Uint8Array {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, SECRET_FILE);
  if (!existsSync(file)) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      try {
        writeSync(fd, randomBytes(SECRET_BYTES));
      } finally {
        closeSync(fd);
      }
    } catch (err) {
      // Lost a race with another process creating it: read theirs.
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort (e.g. a filesystem without modes) */
  }
  const bytes = readFileSync(file);
  if (bytes.length < SECRET_BYTES) {
    throw new Error(`Sync server secret file ${file} is shorter than ${SECRET_BYTES} bytes; restore it from backup or delete it (this resets the fake prelogin salts).`);
  }
  return new Uint8Array(bytes.subarray(0, SECRET_BYTES));
}
