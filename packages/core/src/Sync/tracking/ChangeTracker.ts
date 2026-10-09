/**
 * Change tracking over the user DB (contracts 0063 §4; W1-C implements).
 *
 * Tables the tracker creates (names are fixed; W1-A adds them to `EXCLUDED_TABLES`, removes the unused `sync_metadata`):
 *
 * ```sql
 * CREATE TABLE IF NOT EXISTS sync_record (
 *   table_name   TEXT NOT NULL,        -- registry table, or 'ext.kv', 'ext.db:<extId>/<db>/<table>', 'bn.file'
 *   local_key    TEXT NOT NULL,        -- pk as text; composite pks joined with char(31)
 *   record_id    TEXT UNIQUE,          -- NULL until assigned (derived ids are assigned at push time)
 *   changed_ms   INTEGER NOT NULL,     -- wall ms of the last local change (set by triggers)
 *   hlc          TEXT,                 -- HLC of the version last pushed or applied
 *   server_seq   INTEGER,              -- seq of the server version this row is based on; NULL = never on server
 *   dirty        INTEGER NOT NULL DEFAULT 1,
 *   deleted      INTEGER NOT NULL DEFAULT 0,
 *   base_json    TEXT,                 -- RecordPlaintext.d as last synced (3-way merge base)
 *   PRIMARY KEY (table_name, local_key)
 * );
 * CREATE INDEX IF NOT EXISTS sync_record_dirty ON sync_record(dirty) WHERE dirty = 1;
 * CREATE TABLE IF NOT EXISTS sync_state   (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- keys below
 * CREATE TABLE IF NOT EXISTS sync_opaque  (record_id TEXT PRIMARY KEY, server_seq INTEGER NOT NULL, blob BLOB);
 * CREATE TABLE IF NOT EXISTS sync_pending (record_id TEXT PRIMARY KEY, server_seq INTEGER NOT NULL,
 *                                          plaintext TEXT NOT NULL, missing TEXT NOT NULL); -- child waiting for parent
 * -- sync_state keys: 'device_id', 'account_id', 'cursor' (last pulled seq), 'hlc_last', 'applying' ('1' while applying remote changes)
 * ```
 */
import type { ISql } from '../../Data/Core/ISql';
import type { HlcString, RecordId, RecordPlaintext } from '../types';
import { notImplemented } from '../notImplemented';

export interface TrackedTable {
  table: string;                  // e.g. 'user_note'
  pk: string[];                   // from the registry
  kind: string;                   // sync_record.table_name value (normally === table)
}

export interface DirtyRow {
  kind: string; localKey: string; recordId: RecordId | null;
  changedMs: number; serverSeq: number | null; deleted: boolean; baseJson: string | null;
}

export interface ChangeTracker {
  /** Idempotent: create sync_* tables and AFTER INSERT/UPDATE/DELETE triggers for `tables`.
   *  Triggers do nothing while sync_state.applying = '1'. Existing rows are enrolled as dirty (first upload). */
  install(tables: TrackedTable[]): void;
  /** Drop triggers and sync_* tables (sign-out). Local user data is untouched. */
  uninstall(): void;
  dirty(limit: number): DirtyRow[];
  pendingCount(): number;
  /** After a successful push or an applied pull. */
  markSynced(kind: string, localKey: string, v: { recordId: RecordId; serverSeq: number; hlc: HlcString; baseJson: string | null; deleted: boolean }): void;
  assignRecordId(kind: string, localKey: string, recordId: RecordId): void;
  lookupByRecordId(recordId: RecordId): { kind: string; localKey: string; deleted: boolean; dirty: boolean; serverSeq: number | null; baseJson: string | null; hlc: HlcString | null } | undefined;
  lookupByLocal(kind: string, localKey: string): { recordId: RecordId | null } | undefined;
  /** Runs `fn` in one transaction with sync_state.applying = '1'; restores '0' even if fn throws (rollback). */
  applyRemote<T>(fn: () => T): T;
  state: { get(key: string): string | undefined; set(key: string, value: string): void };
  /** Store / list / delete undecodable records and children awaiting parents. */
  opaque: { put(id: RecordId, seq: number, blob: Uint8Array | null): void; all(): Array<{ id: RecordId; seq: number; blob: Uint8Array | null }>; remove(id: RecordId): void };
  pending: { put(id: RecordId, seq: number, pt: RecordPlaintext, missing: RecordId[]): void; all(): Array<{ id: RecordId; seq: number; pt: RecordPlaintext; missing: RecordId[] }>; remove(id: RecordId): void };
}

export function createChangeTracker(sql: ISql): ChangeTracker {
  throw notImplemented(sql);
}
/** The tracked set for the user DB: every registry table with cls 'content', plus 'extension_storage' (kind 'ext.kv'). */
export function coreTrackedTables(): TrackedTable[] {
  throw notImplemented();
}
