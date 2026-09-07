import { ISql } from '../Core/ISql';
import { UserDataItem, UserDataValueType } from '../Models/User/UserDataItem';
import { UserDataItemRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';
import { IUserDataRepository } from './IUserDataRepository';

/**
 * Repository for the generic extensible user store (user_*.db).
 *
 * Lets a module keep user data this schema does not model, addressed as
 * (ownerUuid, collection, itemKey). See `UserDataItem` for the model and
 * UserDatabase.sql section 4.7 for the schema rationale.
 *
 * To anchor items to scripture, write `verse_link` rows with
 * `source_type: 'user_data_item'` and `source_id: item.itemId` through
 * `VerseLinkRepository`. Deleting an item does NOT remove those links - the
 * link table is polymorphic and so has no cascade - so a caller that creates
 * them is responsible for removing them.
 *
 * @example
 * ```typescript
 * const repo = new UserDataRepository(userDb);
 *
 * // A module's own preferences
 * repo.put(UserDataItem.json(moduleUuid, 'settings', 'theme', { accent: 'blue' }));
 *
 * // Per-passage user metadata, anchored through verse_link
 * const item = repo.put(UserDataItem.json(moduleUuid, 'verse_ratings', 'jn3', { stars: 5 }));
 * verseLinks.create({ sourceType: 'user_data_item', sourceId: item.itemId!,
 *                     verseIdStart: 43003016, verseIdEnd: 43003016 });
 * ```
 */
export class UserDataRepository implements IUserDataRepository {
  constructor(private sql: ISql) {}

  get(ownerUuid: string, collection: string, itemKey: string): UserDataItem | undefined {
    const row = this.sql.queryOne<UserDataItemRow>(
      `SELECT * FROM user_data_item
       WHERE owner_uuid = ? AND collection = ? AND item_key = ?`,
      [ownerUuid, collection, itemKey]
    );
    return row ? this.mapRow(row) : undefined;
  }

  /**
   * Ordered by `sort_order` then `item_key`. The tiebreak matters: sort_order
   * defaults to 0, so a collection used as a map has every row at 0 and would
   * otherwise come back in whatever order the index happened to yield.
   */
  list(ownerUuid: string, collection: string): UserDataItem[] {
    const rows = this.sql.queryAll<UserDataItemRow>(
      `SELECT * FROM user_data_item
       WHERE owner_uuid = ? AND collection = ?
       ORDER BY sort_order, item_key`,
      [ownerUuid, collection]
    );
    return rows.map(row => this.mapRow(row));
  }

  collections(ownerUuid: string): string[] {
    const rows = this.sql.queryAll<{ collection: string }>(
      `SELECT DISTINCT collection FROM user_data_item
       WHERE owner_uuid = ? ORDER BY collection`,
      [ownerUuid]
    );
    return rows.map(r => r.collection);
  }

  /**
   * Insert or replace, keyed on (owner_uuid, collection, item_key).
   *
   * ON CONFLICT ... DO UPDATE rather than INSERT OR REPLACE: the latter deletes
   * the old row and inserts a new one, which would issue a fresh item_id and
   * silently orphan any `verse_link` rows pointing at the old one. Here the
   * item_id - and so its verse anchors - survive an overwrite, and
   * `created_date` keeps its original value.
   */
  put(item: UserDataItem): UserDataItem {
    this.sql.execute(
      `INSERT INTO user_data_item (
         owner_uuid, collection, item_key, value, value_type, sort_order, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_uuid, collection, item_key) DO UPDATE SET
         value = excluded.value,
         value_type = excluded.value_type,
         sort_order = excluded.sort_order,
         metadata = excluded.metadata,
         modified_date = CURRENT_TIMESTAMP`,
      [
        item.ownerUuid,
        item.collection,
        item.itemKey,
        item.value ?? null,
        item.valueType,
        item.sortOrder,
        stringifyJsonField(item.metadata)
      ]
    );

    // Re-read rather than trusting lastInsertRowId: on the UPDATE branch no row
    // is inserted, so that id would belong to some earlier statement.
    const saved = this.get(item.ownerUuid, item.collection, item.itemKey);
    if (!saved) throw new Error('user_data_item write did not persist');
    item.itemId = saved.itemId;
    item.createdDate = saved.createdDate;
    item.modifiedDate = saved.modifiedDate;
    return item;
  }

  putAll(items: UserDataItem[]): void {
    for (const item of items) this.put(item);
  }

  remove(ownerUuid: string, collection: string, itemKey: string): boolean {
    const result = this.sql.execute(
      `DELETE FROM user_data_item
       WHERE owner_uuid = ? AND collection = ? AND item_key = ?`,
      [ownerUuid, collection, itemKey]
    );
    return result.changes > 0;
  }

  clearCollection(ownerUuid: string, collection: string): number {
    const result = this.sql.execute(
      'DELETE FROM user_data_item WHERE owner_uuid = ? AND collection = ?',
      [ownerUuid, collection]
    );
    return result.changes;
  }

  clearOwner(ownerUuid: string): number {
    const result = this.sql.execute(
      'DELETE FROM user_data_item WHERE owner_uuid = ?',
      [ownerUuid]
    );
    return result.changes;
  }

  owners(): string[] {
    const rows = this.sql.queryAll<{ owner_uuid: string }>(
      'SELECT DISTINCT owner_uuid FROM user_data_item ORDER BY owner_uuid'
    );
    return rows.map(r => r.owner_uuid);
  }

  private mapRow(row: UserDataItemRow): UserDataItem {
    return new UserDataItem({
      itemId: row.item_id,
      ownerUuid: row.owner_uuid,
      collection: row.collection,
      itemKey: row.item_key,
      value: row.value ?? undefined,
      valueType: row.value_type as UserDataValueType,
      sortOrder: row.sort_order,
      createdDate: row.created_date,
      modifiedDate: row.modified_date,
      metadata: parseJsonField(row.metadata)
    });
  }
}
