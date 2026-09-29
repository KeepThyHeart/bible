/**
 * One-shot migration of legacy `localStorage` keys into the user-data store.
 *
 * Each feature that used to keep its own `localStorage` blob declares a
 * {@link LegacyKeyMapping}. Running {@link migrateLocalStorage} is safe on every
 * start-up:
 *
 * - A key that is absent is skipped, and nothing is recorded, so it is looked for again next time.
 * - A key is migrated once. The proof is a marker item (`app:userdata` / `migrations` / `ls:<key>`),
 *   written after the data, so a crash between the two steps re-runs the copy rather than losing it.
 * - Existing items are never overwritten: if the feature already wrote to the store, that wins.
 * - The legacy key is removed only after the caller's `persist()` confirms the copy is durable
 *   (pass the store's `flush`). An unreadable value is left alone and reported.
 */
import { UserDataItem, appOwner } from '../Data/Models/User/UserDataItem';
import type { UserDataValueType } from '../Data/Models/User/UserDataItem';
import type { IUserDataRepository } from '../Data/Repositories/IUserDataRepository';

/** The part of `Storage` the migration touches (so tests and non-browser hosts can fake it). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export interface MigratedItem {
  itemKey: string;
  /** Stored as JSON unless `valueType` says otherwise (then it must be a string). */
  payload: unknown;
  valueType?: UserDataValueType;
  sortOrder?: number;
}

export interface LegacyKeyMapping {
  legacyKey: string;
  ownerUuid: string;
  collection: string;
  /** Turn the raw string into items. Throw or return null when it cannot be read. */
  convert(raw: string): MigratedItem[] | null;
  /** Keep the legacy key after copying (default: remove it). */
  keepLegacy?: boolean;
}

export type MigrationOutcome = 'migrated' | 'absent' | 'already-migrated' | 'unreadable';

export interface MigrationResult {
  legacyKey: string;
  outcome: MigrationOutcome;
  /** Items written (existing items are not overwritten and not counted). */
  written: number;
}

/** Where the "this key was migrated" markers live. */
export const MIGRATION_OWNER = appOwner('userdata');
export const MIGRATION_COLLECTION = 'migrations';

export async function migrateLocalStorage(
  items: IUserDataRepository,
  storage: KeyValueStorage,
  mappings: LegacyKeyMapping[],
  persist: () => Promise<void> = async () => {}
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];
  for (const m of mappings) {
    const markerKey = `ls:${m.legacyKey}`;
    if (items.get(MIGRATION_OWNER, MIGRATION_COLLECTION, markerKey)) {
      results.push({ legacyKey: m.legacyKey, outcome: 'already-migrated', written: 0 });
      continue;
    }
    let raw: string | null;
    try {
      raw = storage.getItem(m.legacyKey);
    } catch {
      raw = null;
    }
    if (raw === null) {
      results.push({ legacyKey: m.legacyKey, outcome: 'absent', written: 0 });
      continue;
    }
    let converted: MigratedItem[] | null;
    try {
      converted = m.convert(raw);
    } catch {
      converted = null;
    }
    if (!converted) {
      results.push({ legacyKey: m.legacyKey, outcome: 'unreadable', written: 0 });
      continue;
    }
    let written = 0;
    for (const c of converted) {
      if (items.get(m.ownerUuid, m.collection, c.itemKey)) continue;
      const type = c.valueType ?? 'json';
      items.put(
        new UserDataItem({
          ownerUuid: m.ownerUuid,
          collection: m.collection,
          itemKey: c.itemKey,
          value: type === 'json' ? JSON.stringify(c.payload) : String(c.payload),
          valueType: type,
          sortOrder: c.sortOrder,
        })
      );
      written++;
    }
    items.put(UserDataItem.json(MIGRATION_OWNER, MIGRATION_COLLECTION, markerKey, { at: new Date().toISOString(), from: m.legacyKey }));
    await persist();
    if (!m.keepLegacy) {
      try {
        storage.removeItem(m.legacyKey);
      } catch {
        /* the copy is safe; a leftover key is only clutter, and the marker stops a second copy */
      }
    }
    results.push({ legacyKey: m.legacyKey, outcome: 'migrated', written });
  }
  return results;
}
