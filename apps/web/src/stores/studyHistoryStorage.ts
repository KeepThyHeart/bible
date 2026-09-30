/**
 * Persistence for the Study pane's verse history, on the user-data store.
 *
 * This is the first web feature moved off ad-hoc `localStorage`. Layout:
 *
 *   owner       app:study
 *   collection  verse-history
 *   itemKey     the verse id, as a string
 *   value       JSON `{ verseId, timestamp }`
 *
 * Order is by `timestamp` (newest first), so the items carry no sort order.
 * The old `bible-reader-study-history` key is copied in once and then removed.
 */
import { UserData } from '@bible/core/browser';
import { getUserData } from '../userdata/userData';

const { UserDataItem, appOwner, migrateLocalStorage } = UserData;

export interface VerseHistoryEntry {
  verseId: number;
  timestamp: number;
}

export const STUDY_HISTORY_OWNER = appOwner('study');
export const STUDY_HISTORY_COLLECTION = 'verse-history';
export const LEGACY_STUDY_HISTORY_KEY = 'bible-reader-study-history';

function isEntry(v: unknown): v is VerseHistoryEntry {
  return typeof v === 'object' && v !== null && Number.isInteger((v as VerseHistoryEntry).verseId) && typeof (v as VerseHistoryEntry).timestamp === 'number';
}

/** The legacy value was a JSON array of entries; anything else is treated as unreadable. */
function convertLegacy(raw: string) {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return null;
  return parsed.filter(isEntry).map((e) => ({ itemKey: String(e.verseId), payload: e }));
}

/** One migration per store instance (a store is the app's singleton; tests open several). */
const migrations = new WeakMap<object, Promise<void>>();

async function ready() {
  const store = await getUserData();
  let migration = migrations.get(store);
  if (!migration) {
    migration = migrateLocalStorage(
      store.items,
      localStorage,
      [{ legacyKey: LEGACY_STUDY_HISTORY_KEY, ownerUuid: STUDY_HISTORY_OWNER, collection: STUDY_HISTORY_COLLECTION, convert: convertLegacy }],
      () => store.flush()
    ).then(() => undefined, () => undefined);
    migrations.set(store, migration);
  }
  await migration;
  return store;
}

/** Newest first. Never rejects: history is a convenience, not worth an error. */
export async function loadVerseHistory(): Promise<VerseHistoryEntry[]> {
  try {
    const store = await ready();
    return store.items
      .list(STUDY_HISTORY_OWNER, STUDY_HISTORY_COLLECTION)
      .map((i) => i.parsedValue())
      .filter(isEntry)
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/** Make the stored history equal `entries` (at most a few dozen items, so a full diff is cheap). */
export async function saveVerseHistory(entries: VerseHistoryEntry[]): Promise<void> {
  try {
    const store = await ready();
    const keep = new Set(entries.map((e) => String(e.verseId)));
    for (const item of store.items.list(STUDY_HISTORY_OWNER, STUDY_HISTORY_COLLECTION)) {
      if (!keep.has(item.itemKey)) store.items.remove(STUDY_HISTORY_OWNER, STUDY_HISTORY_COLLECTION, item.itemKey);
    }
    for (const e of entries) {
      const value = JSON.stringify(e);
      // Skip unchanged entries so a jump does not restamp (and re-write) the other 29.
      if (store.items.get(STUDY_HISTORY_OWNER, STUDY_HISTORY_COLLECTION, String(e.verseId))?.value === value) continue;
      store.items.put(UserDataItem.json(STUDY_HISTORY_OWNER, STUDY_HISTORY_COLLECTION, String(e.verseId), e));
    }
  } catch {
    /* see loadVerseHistory */
  }
}
