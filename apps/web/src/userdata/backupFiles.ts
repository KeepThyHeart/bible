/**
 * Browser file plumbing for backup export and import. UI-free on purpose: the
 * settings surface that will host "Back up / Restore" calls these two functions.
 */
import { getUserData } from './userData';
import type { UserDataStore } from './types';

/** Hand already built backup bytes to the browser as a dated download. Returns the file name. */
export function saveBackupBytes(bytes: Uint8Array, extension: 'zip' | 'bbk', now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const name = `keep-thy-heart-${day}.${extension}`;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: extension === 'bbk' ? 'application/octet-stream' : 'application/zip' }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a moment to start the download before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return name;
}

/** Build the backup from the in-memory user-data store and hand it to the browser as a download. Returns the file name. */
export async function downloadBackup(options: { password?: string; store?: UserDataStore; now?: Date } = {}): Promise<string> {
  const store = options.store ?? (await getUserData());
  const out = await store.exportBackup({ password: options.password });
  return saveBackupBytes(out.bytes, out.extension, options.now);
}

/**
 * Full export from the worker database (every user table, as the desktop exports): the export is built in the
 * worker and downloaded here. Returns the file name.
 */
export async function downloadWorkerBackup(
  client: { exportBackup(password?: string): Promise<{ bytes: Uint8Array; extension: 'zip' | 'bbk' }> },
  options: { password?: string; now?: Date } = {},
): Promise<string> {
  const out = await client.exportBackup(options.password);
  return saveBackupBytes(out.bytes, out.extension, options.now);
}

/** Read a chosen `.zip` / `.bbk` and merge (default) or replace into the store. Throws on a damaged file or wrong password. */
export async function restoreBackupFile(
  file: Blob,
  options: { password?: string; mode?: 'merge' | 'replace'; store?: UserDataStore } = {}
) {
  const store = options.store ?? (await getUserData());
  const bytes = new Uint8Array(await file.arrayBuffer());
  return store.importBackup(bytes, { password: options.password, mode: options.mode });
}
