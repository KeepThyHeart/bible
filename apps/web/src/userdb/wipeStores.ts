/**
 * After a local wipe (sign-out with wipe, delete account): delete the browser stores that would otherwise survive the
 * OPFS files. `kth-secrets` holds the remembered account keys; `kth-user-data` is the pre-OPFS user-data store, deleted
 * so the one-shot import (whose marker lived in the wiped DB) cannot resurrect wiped data (design finding 8).
 * Worker and main thread safe; no side effects at module load.
 */
import { SECRETS_DB_NAME } from './IndexedDbSecretStore';

export const LEGACY_USER_DATA_DB_NAME = 'kth-user-data';
export const WIPED_BROWSER_STORES = [SECRETS_DB_NAME, LEGACY_USER_DATA_DB_NAME] as const;

/** How long a blocked delete may wait for the other connections to close before the wipe reports `wipe_incomplete`. */
export const WIPE_BLOCKED_TIMEOUT_MS = 5_000;
/** BroadcastChannel of `WebUserData`; a `{close:true}` message makes it release its connection. */
export const LEGACY_USER_DATA_CHANNEL = 'kth-user-data';

export class WipeIncompleteError extends Error {
  readonly code = 'wipe_incomplete';
  constructor(name: string) {
    super(`IndexedDB ${name} is still open in another tab`);
    this.name = 'WipeIncompleteError';
  }
}

function deleteDatabase(idb: IDBFactory, name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (timer !== undefined) clearTimeout(timer);
      fn();
    };
    const req = idb.deleteDatabase(name);
    req.onsuccess = () => finish(resolve);
    req.onerror = () => finish(() => reject(req.error ?? new Error(`Could not delete IndexedDB ${name}`)));
    // Another connection is open (it normally closes on versionchange). Ask the legacy store's holders to close over the
    // channel, then give up after a bounded wait instead of hanging the wipe; the import marker already blocks a
    // resurrection (handler.wipe), and the delete still completes later if the holder goes away.
    req.onblocked = () => {
      if (timer !== undefined) return;
      if (name === LEGACY_USER_DATA_DB_NAME && typeof BroadcastChannel !== 'undefined') {
        try {
          const ch = new BroadcastChannel(LEGACY_USER_DATA_CHANNEL);
          ch.postMessage({ close: true });
          ch.close();
        } catch { /* best effort */ }
      }
      timer = setTimeout(() => reject(new WipeIncompleteError(name)), timeoutMs);
    };
  });
}

/** Deletes both stores; a missing store is fine. Rejects if a delete fails or stays blocked past the timeout. */
export async function wipeBrowserStores(
  idb: IDBFactory | undefined = globalThis.indexedDB,
  timeoutMs: number = WIPE_BLOCKED_TIMEOUT_MS,
): Promise<void> {
  if (!idb) return;
  const results = await Promise.allSettled(WIPED_BROWSER_STORES.map((name) => deleteDatabase(idb, name, timeoutMs)));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}
