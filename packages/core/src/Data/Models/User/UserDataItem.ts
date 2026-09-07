import { Metadata } from '../../Core/Types';

/**
 * How to parse {@link UserDataItem.value}, which is always stored as TEXT.
 * Same vocabulary as `setting.value_type`.
 */
export type UserDataValueType = 'string' | 'int' | 'bool' | 'json';

/** Owner namespace for application-owned data, as opposed to a module's. */
export const APP_OWNER_PREFIX = 'app:';

/**
 * Build the owner id for an application feature, e.g. `appOwner('reading-stats')`.
 *
 * Module UUIDs are RFC 4122 and never contain ':', so an app owner can never
 * collide with a module's.
 */
export function appOwner(feature: string): string {
  return `${APP_OWNER_PREFIX}${feature}`;
}

/**
 * One item in the generic extensible user store (`user_data_item`).
 *
 * Somewhere for a module - or a future app feature - to keep user data the
 * schema does not model. Addressed at three levels:
 *
 *   {@link ownerUuid}   Whose data: a module's `module_info.module_uuid`, or
 *                       `app:<feature>`. NOT the local `module_id`, which
 *                       changes on reinstall and would orphan the data.
 *   {@link collection}  Which named set within that owner - 'settings',
 *                       'verse_ratings'. Independently enumerable and clearable.
 *   {@link itemKey}     The item within the collection.
 *
 * To anchor an item to scripture, write `verse_link` rows with
 * `source_type: 'user_data_item'` and `source_id: itemId` - the store carries no
 * verse columns of its own, so passage ranges and reverse lookup work through
 * the one linking shape the whole project uses.
 *
 * The store cannot index or constrain anything inside `value`. It is the right
 * home for module-owned and experimental data; a first-class feature that needs
 * per-field queries deserves a real table.
 */
export class UserDataItem {
  itemId?: number;
  ownerUuid: string;
  collection: string;
  itemKey: string;
  /** Raw payload as stored. Use {@link parsedValue} to decode it. */
  value?: string;
  valueType: UserDataValueType;
  sortOrder: number;
  createdDate?: string;
  modifiedDate?: string;
  metadata?: Metadata;

  constructor(data: {
    itemId?: number;
    ownerUuid: string;
    collection: string;
    itemKey: string;
    value?: string;
    valueType?: UserDataValueType;
    sortOrder?: number;
    createdDate?: string;
    modifiedDate?: string;
    metadata?: Metadata;
  }) {
    this.itemId = data.itemId;
    this.ownerUuid = data.ownerUuid;
    this.collection = data.collection;
    this.itemKey = data.itemKey;
    this.value = data.value;
    this.valueType = data.valueType ?? 'json';
    this.sortOrder = data.sortOrder ?? 0;
    this.createdDate = data.createdDate;
    this.modifiedDate = data.modifiedDate;
    this.metadata = data.metadata;
  }

  /** True if this item belongs to the application rather than to a module. */
  isAppOwned(): boolean {
    return this.ownerUuid.startsWith(APP_OWNER_PREFIX);
  }

  /**
   * Decode {@link value} according to {@link valueType}.
   *
   * Returns `undefined` for a NULL value, and for a 'json' value that does not
   * parse. Malformed JSON is treated as absent rather than thrown: the payload
   * is written by modules outside this codebase, so a bad value must not take
   * down the caller reading an unrelated collection.
   */
  parsedValue(): unknown {
    if (this.value === undefined || this.value === null) return undefined;
    switch (this.valueType) {
      case 'int': {
        const n = Number.parseInt(this.value, 10);
        return Number.isNaN(n) ? undefined : n;
      }
      case 'bool':
        return this.value === '1' || this.value.toLowerCase() === 'true';
      case 'json':
        try {
          return JSON.parse(this.value);
        } catch {
          return undefined;
        }
      case 'string':
      default:
        return this.value;
    }
  }

  /**
   * Build an item whose value is a JSON payload.
   *
   * The common case, and it keeps `JSON.stringify` and `valueType: 'json'` from
   * drifting apart at each call site.
   */
  static json(
    ownerUuid: string,
    collection: string,
    itemKey: string,
    payload: unknown,
    options?: { sortOrder?: number; metadata?: Metadata }
  ): UserDataItem {
    return new UserDataItem({
      ownerUuid,
      collection,
      itemKey,
      value: JSON.stringify(payload),
      valueType: 'json',
      sortOrder: options?.sortOrder,
      metadata: options?.metadata
    });
  }
}
