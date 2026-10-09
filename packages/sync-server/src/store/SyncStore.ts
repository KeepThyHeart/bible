/**
 * Server storage contract (contracts 0063 §11; W1-F implements over ISql). All queries are scoped by account_id.
 * Row types mirror the design's server schema plus recovery_auth_hash, wrapped_idk, current_epoch and
 * session.kind. Fields are camelCase here; the store maps them to snake_case columns. Times are epoch ms;
 * hashes are raw SHA-256 bytes.
 */
import type { Sync } from '@bible/core';

type KdfParamsJson = Sync.KdfParamsJson;
type KeysetWire = Sync.KeysetWire;
type WrappedKey = Sync.WrappedKey;

export interface AccountRow {
  id: Sync.AccountId;
  /** Lower-cased, NFC. Unique. */
  email: string;
  emailVerified: boolean;
  kdf: KdfParamsJson;
  /** SHA-256 of the client's authKey. */
  authHash: Uint8Array;
  /** SHA-256 of the client's recoveryAuthKey. */
  recoveryAuthHash: Uint8Array;
  wrappedAkPassword: WrappedKey;
  wrappedAkRecovery: WrappedKey;
  wrappedIdk: WrappedKey;
  currentEpoch: number;
  /** Next record seq to hand out (strictly increasing per account). */
  nextSeq: number;
  bytesUsed: number;
  /** Per-account override; null = the server default. */
  quotaBytes: number | null;
  createdAt: number;
  /** Unverified accounts / deletion grace: purged after this time; null = never. */
  deleteAfter: number | null;
}

/** What `accounts.create` takes; counters start at their defaults (nextSeq 1, bytesUsed 0). */
export type NewAccount = Omit<AccountRow, 'nextSeq' | 'bytesUsed'>;

export interface SessionRow {
  tokenHash: Uint8Array;
  accountId: Sync.AccountId;
  deviceId: Sync.DeviceId;
  /** 'recovery' sessions (from /recover) may only call `PUT keys {kind:'password'}`. */
  kind: 'normal' | 'recovery';
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string | null;
}

export interface DeviceRow {
  id: Sync.DeviceId;
  accountId: Sync.AccountId;
  nameSealed: string;
  createdAt: number;
}

export interface EmailTokenRow {
  tokenHash: Uint8Array;
  accountId: Sync.AccountId;
  purpose: 'verify' | 'reset';
  expiresAt: number;
}

export interface SyncStore {
  migrate(): void;
  accounts: { create(a: NewAccount): void; byEmail(email: string): AccountRow | undefined; byId(id: string): AccountRow | undefined;
    update(id: string, patch: Partial<AccountRow>): void; delete(id: string): void };
  sessions: { create(s: SessionRow): void; byTokenHash(h: Uint8Array): SessionRow | undefined; touch(h: Uint8Array, at: number): void;
    deleteForDevice(accountId: string, deviceId: string): void; deleteAllExcept(accountId: string, keepHash?: Uint8Array): void };
  devices: { upsert(d: DeviceRow): void; list(accountId: string): DeviceRow[]; delete(accountId: string, id: string): void };
  keysets: { replaceAll(accountId: string, ks: KeysetWire[]): void; list(accountId: string): KeysetWire[] };
  records: { changes(accountId: string, since: number, limit: number): Sync.EncryptedRecordWire[];
    /** One transaction: seq check, quota check, next_seq bump, bytes_used update. */
    push(accountId: string, recs: Sync.PushRecord[], quotaBytes: number): Sync.PushResponse | { error: 'quota_exceeded' };
    count(accountId: string): number; wipe(accountId: string): void };
  emailTokens: { create(t: EmailTokenRow): void; consume(hash: Uint8Array, purpose: 'verify' | 'reset', now: number): EmailTokenRow | undefined };
}
