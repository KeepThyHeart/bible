/**
 * The surface of the app's user-data store, shared by both providers:
 * `WebUserData` (IndexedDB, default) and `OpfsUserData` (sqlite-wasm on OPFS, flag `localUserDb`).
 * Type-only module: importing it never loads either provider.
 */
import type { UserData } from '@bible/core/browser';

export interface PersistenceStatus {
  /** The browser has a storage API at all. */
  supported: boolean;
  /** Storage is marked persistent (not evictable under pressure). */
  persisted: boolean;
}

export type UserDataChange = UserData.UserDataChange;

export interface UserDataStore {
  /** The synchronous store. Prefer `items` and `links`; the raw db is for backup and tests. */
  readonly db: UserData.MemoryUserDb;
  readonly items: UserData.MemoryUserDb['items'];
  readonly links: UserData.MemoryUserDb['links'];
  /** False when nothing durable backs the store (IndexedDB unavailable, memory only). */
  readonly persistent: boolean;
  /** Resolves when every change made so far is committed. Rejects if the last write failed. */
  flush(): Promise<void>;
  /** Be told when a background write fails. The changes stay queued and retry with the next write. */
  onError(listener: (error: unknown) => void): () => void;
  /** Be told about changes made elsewhere (other tabs, sync pulls, wipes); already applied to this store. */
  onRemoteChange(listener: (changes: UserDataChange[]) => void): () => void;
  requestPersistence(): Promise<PersistenceStatus>;
  exportBackup(
    options?: Omit<Parameters<typeof UserData.exportUserData>[1], 'app'> & { app?: Parameters<typeof UserData.exportUserData>[1]['app'] },
  ): ReturnType<typeof UserData.exportUserData>;
  importBackup(
    file: Uint8Array,
    options?: Parameters<typeof UserData.importUserData>[2],
  ): Promise<Awaited<ReturnType<typeof UserData.importUserData>>>;
  close(): void;
}
