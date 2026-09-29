/**
 * The app-wide user-data store: one `WebUserData` per page, opened on first use.
 *
 * Features call `getUserData()` (async, once) and then use the synchronous
 * `items` / `links` repositories on the result. Do not create a `WebUserData`
 * elsewhere in app code: two instances in one tab would each hold their own
 * copy of the data.
 */
import { WebUserData } from './WebUserData';
import type { WebUserDataOptions } from './WebUserData';

let opening: Promise<WebUserData> | null = null;
let ready: WebUserData | null = null;

export function getUserData(): Promise<WebUserData> {
  if (!opening) {
    opening = WebUserData.open().then((store) => {
      ready = store;
      return store;
    });
  }
  return opening;
}

/** The store if it has finished opening, else null (for code that must not wait). */
export function userDataIfReady(): WebUserData | null {
  return ready;
}

/** Tests only: drop the singleton (optionally opening a different one, e.g. on a fake IndexedDB). */
export async function resetUserDataForTests(options?: WebUserDataOptions): Promise<WebUserData | null> {
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
