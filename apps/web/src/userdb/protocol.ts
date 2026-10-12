/**
 * Main thread <-> user-DB worker wire protocol (contracts 0063 §12, as refreshed for task 0150; M3 additions per
 * `m3/web-design.md` §2). One leader tab owns OPFS via navigator.locks 'kth-userdb'; others proxy over
 * BroadcastChannel 'kth-userdb'. Types only (nothing that runs): both sides import this one file so they cannot drift.
 *
 * Security rules the types encode:
 * - `{op:'sync', action:'account'}` answers an `AccountResult`: the worker sync host sanitises every AccountClient
 *   result, so keys (`UnlockedAccount`) never reach the main thread or the BroadcastChannel.
 * - `hostCall` events (worker -> leader tab main thread) are delivered to the leader tab only and are never posted on
 *   the BroadcastChannel (leader.ts). Followers never see one.
 */
import type { Sync } from '@bible/core/browser';
import type { MemoryPush } from '@bible/memory/api';

/** The wire's error shape (`errors.ts` builds it as `WireError`; `UserDbError` rebuilds it). */
export interface WireErrorShape { name: string; message: string; code?: string }

/** A Bible module as the web knows it: the server catalog id (stored in user rows) and its abbreviation (portable ref). */
export interface ModuleRef { id: number; abbr: string }

/** Allow-listed `SyncApiClient` methods behind `{op:'sync', action:'api'}` (account screens beyond AccountClient). */
export type SyncApiMethod = 'info' | 'account' | 'devices' | 'revokeDevice' | 'exportAll' | 'reset'
  | 'resendVerification' | 'verifyEmail' | 'setDeviceName';

/** Main-thread APIs the worker may call back into (`hostCall`); the leader tab registers them (`client.ts`). */
export type HostApiName = 'memory.bible';

export type UserDbRequest =
  | { op: 'open' }                                          // create/upgrade schema (core createUserSchema)
  | { op: 'call'; repo: UserRepoName; method: string; args: unknown[] }
  /** Persisted in the worker (`setting` web/sync.*); re-sent when the module catalog loads. */
  | { op: 'sync'; action: 'configure'; baseUrl: string; remember: boolean; modules: ModuleRef[] }
  /** Answers an `AccountResult` (sanitised: never keys). */
  | { op: 'sync'; action: 'account'; method: keyof AccountClientMethods; args: unknown[] }
  | { op: 'sync'; action: 'syncNow' }                       // -> Sync.SyncResult | null (never rejects)
  | { op: 'sync'; action: 'status' }                        // -> Sync.SyncStatus
  | { op: 'sync'; action: 'api'; method: SyncApiMethod; args: unknown[] }
  | { op: 'backup'; action: 'exportPlain' | 'exportEncrypted'; password?: string }
  | { op: 'import'; source: 'kth-user-data' }               // one-shot copy of the 0084 IndexedDB store (plan-refresh item 9)
  | { op: 'wipe' }                                          // sign-out with wipeLocal / delete account
  /** Leader main thread -> worker: the answer to a `hostCall` event. */
  | { op: 'hostReply'; callId: number; ok: true; value: unknown }
  | { op: 'hostReply'; callId: number; ok: false; error: WireErrorShape };

/** A request on the wire: the client numbers it, the response echoes the id. */
export type UserDbRequestMessage = UserDbRequest & { id: number };

/**
 * `userData` = core UserDataRepository (user_data_item + verse_link, replaces the `kth-user-data` IndexedDB store);
 * `userDataMirror` = snapshot/reserveIds/applyChanges for the main-thread `MemoryUserDb` mirror (S1);
 * `annotations` = plain-DTO facade over markup/notes/collections (S2);
 * `memory` = MemoryService over the worker's sqlPort (S3).
 */
export type UserRepoName = 'notes' | 'commentaries' | 'markup' | 'collections' | 'crossRefs' | 'verseLinks' | 'readingPlans' | 'prayer' | 'journal'
  | 'userData' | 'memory' | 'annotations' | 'userDataMirror';
export type UserDbResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: WireErrorShape };
export type UserDbEvent =
  | { event: 'changed'; tables: string[] }
  | { event: 'syncStatus'; status: Sync.SyncStatus }
  | { event: 'leader'; isLeader: boolean }
  | { event: 'memoryPush'; push: MemoryPush }
  /** Worker -> leader tab only (never on the BroadcastChannel); answered with `{op:'hostReply'}`. */
  | { event: 'hostCall'; callId: number; api: HostApiName; method: string; args: unknown[] };
export type AccountClientMethods = Pick<Sync.AccountClient, 'signUp' | 'signIn' | 'signInWithRecoveryCode' | 'resume' | 'changePassword'
  | 'regenerateRecoveryCode' | 'rotateKeys' | 'startOver' | 'signOut' | 'deleteAccount'>;

/**
 * Sanitised results of `{op:'sync', action:'account'}`: never keys. `resume` -> `{ resumed }`; `signUp`,
 * `regenerateRecoveryCode`, `startOver` (anything that mints a recovery code) -> `{ recoveryCode }`; others -> `null`.
 */
export type AccountResult = null | { recoveryCode: string } | { resumed: boolean };

/** Signature of `createWasmSql` (W1-E, `./createWasmSql.ts`): sync ISql over @sqlite.org/sqlite-wasm oo1 + opfs-sahpool VFS (worker only). */
export type CreateWasmSql = (db: unknown /* oo1.DB */, path: string) => Sync.ISql;
