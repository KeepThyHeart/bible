/**
 * IPC for keyword marks (task 0065): the user's keyword sets, kept as
 * `user_data_item` rows (owner `app:keyword-marks`) in the shared user
 * database. Built-in sets never cross this boundary; they ship in core.
 *
 * Replies use the `Result<T>` envelope; the renderer side is
 * `src/ui/services/keywordSetsAPI.ts`.
 */
import { UserDataRepository, UserDataKeywordSetStore, validateKeywordSet, isValidationErrors } from '@bible/core';
import type { KeywordSet } from '@bible/core';
import { getSharedUserDb } from '../services/sharedUserDb';
import { initializeUserSchema } from '../schema/userSchema';
import { ipcHandler, IpcKnownError } from './handler-helper';

let storeInit: Promise<UserDataKeywordSetStore> | null = null;

/** The keyword store over the shared user DB, opened once (a failed open is retried). */
async function getKeywordStore(): Promise<UserDataKeywordSetStore> {
  if (!storeInit) {
    storeInit = (async () => {
      const db = await getSharedUserDb();
      initializeUserSchema(db);
      return new UserDataKeywordSetStore(new UserDataRepository(db));
    })().catch((err: unknown) => {
      storeInit = null;
      throw err;
    });
  }
  return storeInit;
}

/** Forget the cached store (called when the user database is closed). */
export function resetKeywordStore(): void {
  storeInit = null;
}

export function registerKeywordHandlers(): void {
  ipcHandler<[], KeywordSet[]>('keywords:list', async () => {
    return (await getKeywordStore()).list();
  });

  ipcHandler<[unknown], void>('keywords:put', async (raw) => {
    const valid = validateKeywordSet(raw);
    if (isValidationErrors(valid)) {
      throw new IpcKnownError('invalid_input', `Invalid keyword set: ${valid.map((e) => `${e.path} ${e.message}`).join('; ')}`);
    }
    if (valid.builtIn) throw new IpcKnownError('invalid_input', 'Built-in keyword sets are read-only.');
    await (await getKeywordStore()).put(valid);
  });

  ipcHandler<[string], void>('keywords:remove', async (id) => {
    if (typeof id !== 'string' || id.length === 0 || id.startsWith('builtin:')) {
      throw new IpcKnownError('invalid_input', 'A user keyword set id is required.');
    }
    await (await getKeywordStore()).remove(id);
  });
}
