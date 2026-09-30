/**
 * Web persistence for keyword sets, on the user-data store (task 0084).
 *
 *   owner       app:keyword-marks
 *   collection  sets
 *   itemKey     the set id
 *   value       JSON `KeywordSet`
 *
 * The old localStorage key (`kth.keywordSets`, one JSON array of sets) is copied in once
 * and then removed. Reads and writes wait for the store to open and for that migration.
 */
import {
  UserData,
  UserDataKeywordSetStore,
  StorageKeywordSetStore,
  KEYWORD_OWNER,
  KEYWORD_COLLECTION,
  isValidationErrors,
  validateKeywordSet,
  type IKeywordSetStore,
  type KeywordSet,
} from '@bible/core/browser';
import { getUserData } from '../userdata/userData';

export const LEGACY_KEYWORD_SETS_KEY = 'kth.keywordSets';

const { migrateLocalStorage } = UserData;

/** The legacy value was a JSON array of sets; anything else is unreadable. Invalid sets are dropped. */
export function convertLegacyKeywordSets(raw: string, onDropped: () => void = () => {}) {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return null;
  const valid = parsed
    .map(validateKeywordSet)
    .filter((s): s is KeywordSet => !isValidationErrors(s));
  if (valid.length < parsed.length) onDropped();
  return valid.filter((s) => !s.builtIn).map((s) => ({ itemKey: s.id, payload: s }));
}

const migrations = new WeakMap<object, Promise<void>>();

async function ready(): Promise<IKeywordSetStore> {
  const store = await getUserData();
  // Memory-only store (IndexedDB blocked, private window): keep the sets where they were, in localStorage.
  if (!store.persistent) return new StorageKeywordSetStore(localStorage);
  let migration = migrations.get(store);
  if (!migration) {
    // Sets that fail validation are not copied, so the old key is then kept rather than deleted.
    let dropped = false;
    migration = migrateLocalStorage(
      store.items,
      localStorage,
      [{
        legacyKey: LEGACY_KEYWORD_SETS_KEY, ownerUuid: KEYWORD_OWNER, collection: KEYWORD_COLLECTION,
        convert: (raw: string) => convertLegacyKeywordSets(raw, () => { dropped = true; }),
        get keepLegacy() { return dropped; },
      }],
      () => store.flush(),
    ).then(() => undefined, () => undefined);
    migrations.set(store, migration);
  }
  await migration;
  return new UserDataKeywordSetStore(store.items);
}

/** `IKeywordSetStore` over `getUserData()`. */
export class WebKeywordSetStore implements IKeywordSetStore {
  async list(): Promise<KeywordSet[]> { return (await ready()).list(); }
  async put(set: KeywordSet): Promise<void> { await (await ready()).put(set); }
  async remove(id: string): Promise<void> { await (await ready()).remove(id); }
}

/** Run `fn` whenever another tab changes keyword sets. Returns an unsubscribe. */
export function onKeywordSetsChangedElsewhere(fn: () => void): () => void {
  let off = () => {};
  let cancelled = false;
  void getUserData().then((store) => {
    if (cancelled) return;
    off = store.onRemoteChange((changes) => {
      if (changes.some((c) => (c.type === 'item:put' ? c.row.owner_uuid === KEYWORD_OWNER : c.type === 'item:delete' && c.ownerUuid === KEYWORD_OWNER))) fn();
    });
  }, () => {});
  return () => { cancelled = true; off(); };
}
