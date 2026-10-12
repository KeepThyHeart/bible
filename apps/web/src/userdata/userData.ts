/**
 * The app-wide user-data store: one provider instance per page, opened on first use.
 *
 * Features call `getUserData()` (async, once) and then use the synchronous
 * `items` / `links` repositories on the result. Do not create a store
 * elsewhere in app code: two instances in one tab would each hold their own
 * copy of the data.
 *
 * Provider: `WebUserData` (IndexedDB) by default. With the `localUserDb` flag on and a browser that supports it
 * (`isUserDbSupported()`), `OpfsUserData` (sqlite-wasm on OPFS, via the user-DB worker) instead. Both modules are
 * dynamically imported only on the flagged path, so with the flag off nothing new loads. Any failure to open the
 * OPFS provider (unsupported, timeout, worker error) is warned about and falls back to `WebUserData`.
 */
import { isEnabled } from '../utils/featureFlags';
import { WebUserData } from './WebUserData';
import type { WebUserDataOptions } from './WebUserData';
import type { UserDataStore } from './types';

let opening: Promise<UserDataStore> | null = null;
let ready: UserDataStore | null = null;

async function openStore(): Promise<UserDataStore> {
  if (isEnabled('localUserDb')) {
    try {
      const { isUserDbSupported } = await import('../userdb/client');
      if (isUserDbSupported()) {
        const { OpfsUserData } = await import('../userdb/OpfsUserData');
        return await OpfsUserData.open();
      }
      console.warn('[userdata] local user database is not supported in this browser; using the IndexedDB store');
    } catch (e) {
      console.warn('[userdata] local user database unavailable; using the IndexedDB store', e instanceof Error ? e.message : e);
    }
  }
  return WebUserData.open();
}

export function getUserData(): Promise<UserDataStore> {
  if (!opening) {
    opening = openStore().then((store) => {
      ready = store;
      return store;
    });
  }
  return opening;
}

/** The store if it has finished opening, else null (for code that must not wait). */
export function userDataIfReady(): UserDataStore | null {
  return ready;
}

/** Tests only: drop the singleton (optionally opening a different one, e.g. on a fake IndexedDB). */
export async function resetUserDataForTests(options?: WebUserDataOptions): Promise<UserDataStore | null> {
  ready?.close();
  ready = null;
  opening = null;
  if (!options) return null;
  opening = WebUserData.open(options).then((store) => {
    ready = store;
    return store;
  });
  return opening;
}
