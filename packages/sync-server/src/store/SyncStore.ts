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

/** A device with the activity of its sessions (`lastSeenAt` falls back to `createdAt` when it has none). */
export interface DeviceDetail extends DeviceRow {
  lastSeenAt: number;
  userAgent: string | null;
}

/** Bookkeeping charged per record row on top of its blob, so tiny records cannot be stored for free. */
export const ROW_OVERHEAD_BYTES = 128;
/** Default cap on rows per account (live and tombstones). */
export const DEFAULT_MAX_RECORDS = 1_000_000;

export interface SyncStore {
  migrate(): void;
  accounts: { create(a: NewAccount): void; byEmail(email: string): AccountRow | undefined; byId(id: string): AccountRow | undefined;
    update(id: string, patch: Partial<AccountRow>): void; delete(id: string): void;
    /** Changes the account's id; the caller must have deleted every child row first (records, keysets, devices, sessions, tokens). */
    rekey(oldId: string, newId: string): void };
  sessions: { create(s: SessionRow): void; byTokenHash(h: Uint8Array): SessionRow | undefined; touch(h: Uint8Array, at: number): void;
    deleteForDevice(accountId: string, deviceId: string): void; deleteAllExcept(accountId: string, keepHash?: Uint8Array): void;
    /** Drop every recovery-kind session of the account. */
    deleteRecovery(accountId: string): void };
  devices: { upsert(d: DeviceRow): void; list(accountId: string): DeviceRow[];
    /** Like `list`, plus the latest session activity per device. */
    listDetailed(accountId: string): DeviceDetail[];
    /** Deletes the device and that device's sessions. */
    delete(accountId: string, id: string): void };
  keysets: { replaceAll(accountId: string, ks: KeysetWire[]): void; list(accountId: string): KeysetWire[] };
  records: { changes(accountId: string, since: number, limit: number): Sync.EncryptedRecordWire[];
    /**
     * Rows after `since` in seq order, at most `limit`, stopping once the blob bytes taken reach `maxBytes` (always
     * at least one row). `more` says rows remain. Blobs of rows not returned are never loaded.
     */
    changesPage(accountId: string, since: number, limit: number, maxBytes: number): { records: Sync.EncryptedRecordWire[]; more: boolean };
    /**
     * One transaction: seq check, quota check (each row costs its blob size + ROW_OVERHEAD_BYTES, tombstones
     * included), record-count cap (`maxRecords`), next_seq bump, bytes_used update.
     */
    push(accountId: string, recs: Sync.PushRecord[], quotaBytes: number, maxRecords?: number): Sync.PushResponse | { error: 'quota_exceeded' };
    count(accountId: string): number; wipe(accountId: string): void };
  emailTokens: { create(t: EmailTokenRow): void;
    /** Drops the account's outstanding tokens of one purpose (a newly issued token replaces older ones). */
    deleteForAccount(accountId: string, purpose: 'verify' | 'reset'): void; consume(hash: Uint8Array, purpose: 'verify' | 'reset', now: number): EmailTokenRow | undefined };
}
