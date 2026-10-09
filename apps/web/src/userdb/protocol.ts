/**
 * Main thread <-> user-DB worker wire protocol (contracts 0063 §12, as refreshed for task 0150).
 * One leader tab owns OPFS via navigator.locks 'kth-userdb'; others proxy over BroadcastChannel 'kth-userdb'.
 * Types only (plus nothing that runs): both sides import this one file so they cannot drift.
 */
import type { Sync } from '@bible/core/browser';

export type UserDbRequest =
  | { op: 'open' }                                          // create/upgrade schema (core createUserSchema)
  | { op: 'call'; repo: UserRepoName; method: string; args: unknown[] }
  | { op: 'sync'; action: 'configure'; baseUrl: string; remember: boolean }
  | { op: 'sync'; action: 'account'; method: keyof AccountClientMethods; args: unknown[] }
  | { op: 'sync'; action: 'syncNow' }
  | { op: 'backup'; action: 'exportPlain' | 'exportEncrypted'; password?: string }
  | { op: 'import'; source: 'kth-user-data' }               // one-shot copy of the 0084 IndexedDB store (plan-refresh item 9)
  | { op: 'wipe' };                                          // sign-out with wipeLocal / delete account

/** A request on the wire: the client numbers it, the response echoes the id. */
export type UserDbRequestMessage = UserDbRequest & { id: number };

/**
 * `userData` = core UserDataRepository (user_data_item + verse_link, replaces the `kth-user-data` IndexedDB store);
 * `memory` = MemoryService over the worker's sqlPort (later wave).
 */
export type UserRepoName = 'notes' | 'commentaries' | 'markup' | 'collections' | 'crossRefs' | 'verseLinks' | 'readingPlans' | 'prayer' | 'journal'
  | 'userData' | 'memory';
export type UserDbResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: { name: string; message: string; code?: string } };
export type UserDbEvent = { event: 'changed'; tables: string[] } | { event: 'syncStatus'; status: Sync.SyncStatus } | { event: 'leader'; isLeader: boolean };
export type AccountClientMethods = Pick<Sync.AccountClient, 'signUp' | 'signIn' | 'signInWithRecoveryCode' | 'resume' | 'changePassword'
  | 'regenerateRecoveryCode' | 'rotateKeys' | 'startOver' | 'signOut' | 'deleteAccount'>;

/** Signature of `createWasmSql` (W1-E, `./createWasmSql.ts`): sync ISql over @sqlite.org/sqlite-wasm oo1 + opfs-sahpool VFS (worker only). */
export type CreateWasmSql = (db: unknown /* oo1.DB */, path: string) => Sync.ISql;
