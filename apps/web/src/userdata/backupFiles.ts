/**
 * Browser file plumbing for backup export and import. UI-free on purpose: the
 * settings surface that will host "Back up / Restore" calls these two functions.
 */
import { getUserData } from './userData';
import type { WebUserData } from './WebUserData';

/** Build the backup and hand it to the browser as a download. Returns the file name. */
export async function downloadBackup(options: { password?: string; store?: WebUserData; now?: Date } = {}): Promise<string> {
  const store = options.store ?? (await getUserData());
  const out = await store.exportBackup({ password: options.password });
  const day = (options.now ?? new Date()).toISOString().slice(0, 10);
  const name = `keep-thy-heart-${day}.${out.extension}`;
  const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: out.encrypted ? 'application/octet-stream' : 'application/zip' }));
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

/** Read a chosen `.zip` / `.bbk` and merge (default) or replace into the store. Throws on a damaged file or wrong password. */
export async function restoreBackupFile(
  file: Blob,
  options: { password?: string; mode?: 'merge' | 'replace'; store?: WebUserData } = {}
) {
  const store = options.store ?? (await getUserData());
  const bytes = new Uint8Array(await file.arrayBuffer());
  return store.importBackup(bytes, { password: options.password, mode: options.mode });
}
