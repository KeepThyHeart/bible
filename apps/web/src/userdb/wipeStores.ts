/**
 * After a local wipe (sign-out with wipe, delete account): delete the browser stores that would otherwise survive the
 * OPFS files. `kth-secrets` holds the remembered account keys; `kth-user-data` is the pre-OPFS user-data store, deleted
 * so the one-shot import (whose marker lived in the wiped DB) cannot resurrect wiped data (design finding 8).
 * Worker and main thread safe; no side effects at module load.
 */
import { SECRETS_DB_NAME } from './IndexedDbSecretStore';

export const LEGACY_USER_DATA_DB_NAME = 'kth-user-data';
export const WIPED_BROWSER_STORES = [SECRETS_DB_NAME, LEGACY_USER_DATA_DB_NAME] as const;

function deleteDatabase(idb: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = idb.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`Could not delete IndexedDB ${name}`));
    // Another connection is open: the delete completes once it closes (WebUserData closes on versionchange).
    req.onblocked = () => undefined;
  });
}

/** Deletes both stores; a missing store is fine. Rejects only if a delete fails. */
export async function wipeBrowserStores(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<void> {
  if (!idb) return;
  const results = await Promise.allSettled(WIPED_BROWSER_STORES.map((name) => deleteDatabase(idb, name)));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}
