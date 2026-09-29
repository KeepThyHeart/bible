/**
 * The web-capable user-data store: the generic `user_data_item` / `verse_link`
 * repositories over memory, backup format v1 export/import for them, and the
 * `localStorage` migration helper. Browser-safe; see `docs/features/user-data-store.md`.
 */
export * from './MemoryUserDb';
export * from './UserDataBackup';
export * from './LocalStorageMigration';
export { UserDataItem, appOwner, APP_OWNER_PREFIX } from '../Data/Models/User/UserDataItem';
export type { UserDataValueType } from '../Data/Models/User/UserDataItem';
export { VerseLinkRecord } from '../Data/Models/Common/VerseLinkRecord';
export type { IUserDataRepository } from '../Data/Repositories/IUserDataRepository';
export type { IVerseLinkRepository, VerseLinkFilter } from '../Data/Repositories/IVerseLinkRepository';
