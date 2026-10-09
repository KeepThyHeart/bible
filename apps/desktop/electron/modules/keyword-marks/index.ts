/**
 * Keyword marks, main-process half (task 0065, migrated onto the feature-module contract in 0127):
 * the user's keyword sets, kept as `user_data_item` rows (owner `app:keyword-marks`) in the shared
 * user database. Built-in sets never cross this boundary; they ship in core. This is unrelated to
 * `KeywordIndexService` (the keyword-SEARCH sidecar index).
 *
 * Channels are `module:keyword-marks:<method>`; replies use the `Result<T>` envelope. The renderer
 * side is `src/ui/modules/keyword-marks/keywordSetsAPI.ts`.
 */
import { UserDataRepository, UserDataKeywordSetStore, validateKeywordSet, isValidationErrors } from '@bible/core';
import type { KeywordSet } from '@bible/core';
import { getSharedUserDb } from '../../services/sharedUserDb';
import { initializeUserSchema } from '../../schema/userSchema';
import { IpcKnownError } from '../../ipc/result';
import type { FeatureMainModule, ModuleIpc } from '../FeatureMainModule';

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

/** Forget the cached store (the module's `close()`, run before the user database is closed). */
export function resetKeywordStore(): void {
  storeInit = null;
}

function registerKeywordIpc(ipc: ModuleIpc): void {
  ipc.handle('list', async (): Promise<KeywordSet[]> => (await getKeywordStore()).list());

  ipc.handle('put', async (raw: unknown): Promise<void> => {
    const valid = validateKeywordSet(raw);
    if (isValidationErrors(valid)) {
      throw new IpcKnownError('invalid_input', `Invalid keyword set: ${valid.map((e) => `${e.path} ${e.message}`).join('; ')}`);
    }
    if (valid.builtIn) throw new IpcKnownError('invalid_input', 'Built-in keyword sets are read-only.');
    await (await getKeywordStore()).put(valid);
  });

  ipc.handle('remove', async (id: unknown): Promise<void> => {
    if (typeof id !== 'string' || id.length === 0 || id.startsWith('builtin:')) {
      throw new IpcKnownError('invalid_input', 'A user keyword set id is required.');
    }
    await (await getKeywordStore()).remove(id);
  });
}

const keywordMarksMainModule: FeatureMainModule = {
  id: 'keyword-marks',
  registerIpc(ipc) {
    registerKeywordIpc(ipc);
  },
  close: resetKeywordStore,
};

export default keywordMarksMainModule;
