import { UserDataItem } from '../Models/User/UserDataItem';

/**
 * The generic extensible user store (`user_data_item`).
 *
 * Every method is scoped by `ownerUuid` - a module's `module_info.module_uuid`,
 * or `app:<feature>`. Nothing here lets one owner read or clear another's data
 * by accident: the owner is always the first argument, never optional.
 */
export interface IUserDataRepository {
  /** One item, or undefined if the owner has no such key in that collection. */
  get(ownerUuid: string, collection: string, itemKey: string): UserDataItem | undefined;

  /** Every item in one collection, in `sortOrder` then `itemKey` order. */
  list(ownerUuid: string, collection: string): UserDataItem[];

  /** The names of every collection this owner has stored anything in. */
  collections(ownerUuid: string): string[];

  /** Insert or replace one item, addressed by (owner, collection, key). */
  put(item: UserDataItem): UserDataItem;

  /** Insert or replace many items in one transaction. */
  putAll(items: UserDataItem[]): void;

  /** Remove one item. Returns false if it was not there. */
  remove(ownerUuid: string, collection: string, itemKey: string): boolean;

  /** Remove a whole collection. Returns the number of items removed. */
  clearCollection(ownerUuid: string, collection: string): number;

  /** Remove everything one owner has stored. Returns the number removed. */
  clearOwner(ownerUuid: string): number;

  /**
   * Every distinct `ownerUuid` in the store.
   *
   * For finding orphans: compare against installed module UUIDs. The store
   * deliberately keeps data for uninstalled modules, so this is the only way to
   * discover it - there is no cascade.
   */
  owners(): string[];
}
