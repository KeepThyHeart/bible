/**
 * Saved word groups for the Word study pane, on the web user-data store.
 *
 *   owner       app:word-study   (same as desktop, see WordGroupStore in @bible/core)
 *   collection  groups
 *   itemKey     the group id
 *   value       JSON WordGroup `{ id, label, terms, exclude?, ... }`
 *
 * Backup classification: user_data_item rows are `content` in the backup registry, so
 * groups are backed up with the rest of the user's own data; no new table is added and
 * nothing in `USER_TABLES` changes. Contains no secrets. Not anchored to scripture, so no
 * verse_link rows exist for these items.
 *
 * The old `bible.wordGroups.v1` localStorage array is copied in once (existing items are
 * never overwritten) and then removed by `migrateLocalStorage`.
 */
import { UserData, WordGroupStore, WORD_GROUP_OWNER, WORD_GROUP_COLLECTION, normalizeWordGroup } from '@bible/core/browser';
import type { WordGroup } from '@bible/core/browser';
import { getUserData } from '../userdata/userData';

const { migrateLocalStorage } = UserData;

export const WORD_GROUPS_KEY = 'bible.wordGroups.v1';

function convertLegacy(raw: string) {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return null;
  const out: { itemKey: string; payload: WordGroup }[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Partial<WordGroup>;
    if (!Array.isArray(rec.terms) || !rec.terms.every((t) => typeof t === 'string')) continue;
    const group = normalizeWordGroup({ ...rec, terms: rec.terms as string[] });
    if (group.terms.length > 0) out.push({ itemKey: group.id, payload: group });
  }
  return out;
}

/** One migration per store instance (the app's singleton; tests open several). */
const migrations = new WeakMap<object, Promise<void>>();

async function ready() {
  const store = await getUserData();
  let migration = migrations.get(store);
  if (!migration) {
    migration = migrateLocalStorage(
      store.items,
      localStorage,
      [{ legacyKey: WORD_GROUPS_KEY, ownerUuid: WORD_GROUP_OWNER, collection: WORD_GROUP_COLLECTION, convert: convertLegacy }],
      () => store.flush()
    ).then(() => undefined, () => undefined);
    migrations.set(store, migration);
  }
  await migration;
  return new WordGroupStore(store.items);
}

/** All saved groups, sorted by label. Never rejects. */
export async function listWordGroups(): Promise<WordGroup[]> {
  try {
    return (await ready()).list();
  } catch {
    return [];
  }
}

/** Save (insert or replace by id); resolves with the normalized group. Falls back to the normalized input if storage fails. */
export async function saveWordGroup(group: WordGroup): Promise<WordGroup> {
  const normalized = normalizeWordGroup(group);
  try {
    return (await ready()).save(normalized);
  } catch {
    return normalized;
  }
}

export async function removeWordGroup(id: string): Promise<void> {
  try {
    (await ready()).remove(id);
  } catch { /* storage unavailable: the group stays in memory for the session */ }
}
