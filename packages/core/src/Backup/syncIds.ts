/**
 * Internal helpers that let a backup carry sync identities (format 1.1) and let a restore keep them.
 * Not part of the public `Backup` barrel (`index.ts` lists its files one by one and leaves this one out).
 *
 * Background (see `docs/features/backup-format.md`, "Sync identities"): a synced user database keeps, per tracked row,
 * a `sync_record` line (kind = table name, local key = primary key as text, record id, server version metadata).
 * A restore is a user edit, so the change-tracking triggers stay on; this module repairs the identities afterwards:
 *
 *  - Writer: the random-id tables get a last column `sync_id` holding the row's record id.
 *  - Replace: a restored row takes the identity (and server version metadata) of the record with the same `sync_id`;
 *    a row without one becomes a new record; records that are no longer present become tombstones.
 *  - Merge: a backup row whose `sync_id` is a live local record IS that row (reused, never duplicated); an inserted
 *    row takes its `sync_id`, adopting a local tombstone that holds it.
 *
 * All of it applies only when the backup's record-id key fingerprint equals the target's (same account): record ids
 * from another account mean nothing here. Browser-safe: pure `ISql`, no globals at module load.
 */
import type { ISql, SqlParameter } from '../Data/Core/ISql';
import type { TableSpec } from './Registry';

/** The extra last column of a table section in a 1.1 payload. */
export const SYNC_ID_COLUMN = 'sync_id';

const RECORD_ID = /^[0-9a-f]{32}$/;
const IDK_FP = /^[0-9a-f]{16}$/;

/** Wall-clock milliseconds, evaluated by SQLite (the same expression the change tracker uses). */
const NOW_MS = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const TRIGGER_PREFIX = 'sync_trg_';

/**
 * Tracked tables whose record ids are derived from the row's content (natural keys), so they carry no `sync_id`.
 * Mirrors the natural-key table of `Sync/codecs/tableCodec.ts`; a test keeps the two equal.
 */
export const NATURAL_KEY_TABLES: ReadonlySet<string> = new Set([
  'user_reading_progress', 'user_data_item', 'memory_setting', 'memory_resume_state', 'memory_recite_detail',
  'memory_passage', 'memory_card', 'reading_plan_day',
]);

export function isRecordId(v: unknown): v is string {
  return typeof v === 'string' && RECORD_ID.test(v);
}

export function isIdkFingerprint(v: unknown): v is string {
  return typeof v === 'string' && IDK_FP.test(v);
}

/** Tables whose rows have a random record id: tracked content tables with an autoincrement key and no natural key. */
export function carriesSyncId(spec: TableSpec): boolean {
  return spec.cls === 'content' && spec.autoId && spec.pk.length === 1 && !NATURAL_KEY_TABLES.has(spec.name);
}

function tableExists(sql: ISql, name: string): boolean {
  return sql.queryOne("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]) !== undefined;
}

/** The record-id key fingerprint this database last synced under, if it has sync tables and has synced at all. */
export function readIdkFingerprint(sql: ISql): string | undefined {
  if (!tableExists(sql, 'sync_record') || !tableExists(sql, 'sync_state')) return undefined;
  const v = sql.queryOne<{ value: string }>("SELECT value FROM sync_state WHERE key = 'idk_fp'")?.value;
  return isIdkFingerprint(v) ? v : undefined;
}

/** True when the change-tracking triggers for this table are installed (that is what "tracked" means). */
export function isTracked(sql: ISql, table: string): boolean {
  return sql.queryOne("SELECT 1 AS x FROM sqlite_master WHERE type = 'trigger' AND name = ?", [`${TRIGGER_PREFIX}${table}_ai`]) !== undefined;
}

/** Record id of every live, identified row of a table, by local key (primary key as text). */
export function readLiveRecordIds(sql: ISql, table: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of sql.queryAll<{ local_key: string; record_id: string }>(
    'SELECT local_key, record_id FROM sync_record WHERE table_name = ? AND deleted = 0 AND record_id IS NOT NULL', [table])) {
    out.set(r.local_key, r.record_id);
  }
  return out;
}

// --- identities ---------------------------------------------------------------------------------------------

/** One `sync_record` line that has a record id. */
export interface Identity {
  table_name: string;
  local_key: string;
  record_id: string;
  rev: number;
  hlc: string | null;
  server_seq: number | null;
  dirty: number;
  deleted: number;
  base_json: string | null;
}

/** Every identified record of these tables (live rows and tombstones), taken before a replace deletes anything. */
export function snapshotIdentities(sql: ISql, tables: string[]): Identity[] {
  if (tables.length === 0) return [];
  return sql.queryAll<Identity>(
    `SELECT table_name, local_key, record_id, rev, hlc, server_seq, dirty, deleted, base_json FROM sync_record
     WHERE record_id IS NOT NULL AND table_name IN (${tables.map(() => '?').join(', ')})`, tables);
}

/** Key of a tombstone whose old local key is taken again by a restored row. Never a real key (US cannot be in a number). */
export function syntheticKey(recordId: string): string {
  return `\u001fr:${recordId}`;
}

/**
 * After a replace has deleted and re-inserted the rows of `tables` (triggers on), rewrite their `sync_record` lines.
 *
 * `restored` maps each table to the `sync_id` of the rows that were inserted, by local key; a row absent from it (or with
 * an unusable id) has none. `before` is `snapshotIdentities` taken before the first delete.
 *
 *  - A restored row with a `sync_id` S takes record id S and S's server version metadata (`server_seq`, `hlc`, `base_json`)
 *    from `before`, and stays dirty: its content may differ from the server's.
 *  - A restored row without one is a new record: no id, no server metadata, dirty.
 *  - A record that had a server version and is not taken over by a restored row becomes a dirty tombstone, at its old
 *    local key, or at a synthetic key when a restored row now uses that key. (A record that was already a tombstone
 *    keeps its state.) A record the server never saw is simply gone.
 */
export function rewriteReplaced(sql: ISql, tables: string[], before: Identity[], restored: Map<string, Map<string, string>>): void {
  if (tables.length === 0) return;
  const inList = tables.map(() => '?').join(', ');
  // 1. Forget every line that is not a live restored row, and clear what the live ones inherited from the old rows
  //    that shared their local key (the insert trigger keeps a line's record id on conflict).
  sql.execute(`DELETE FROM sync_record WHERE deleted = 1 AND table_name IN (${inList})`, tables);
  sql.execute(
    `UPDATE sync_record SET record_id = NULL, server_seq = NULL, hlc = NULL, base_json = NULL, dirty = 1, rev = rev + 1
     WHERE table_name IN (${inList})`, tables);

  // 2. Reattach: restored rows that carry a sync_id.
  const byId = new Map(before.map((r) => [r.record_id, r]));
  const taken = new Set<string>();
  for (const table of tables) {
    for (const [localKey, id] of restored.get(table) ?? []) {
      if (!isRecordId(id) || taken.has(id)) continue; // not an id, or a second row claiming the same one
      const old = byId.get(id);
      if (old && old.table_name !== table) continue;   // that id belongs to another kind of record: not this row's
      if (sql.queryOne('SELECT 1 AS x FROM sync_record WHERE record_id = ?', [id])) continue; // held by a row outside this restore
      const res = sql.execute(
        'UPDATE sync_record SET record_id = ?, server_seq = ?, hlc = ?, base_json = ? WHERE table_name = ? AND local_key = ? AND deleted = 0',
        [id, old?.server_seq ?? null, old?.hlc ?? null, old?.base_json ?? null, table, localKey]);
      if (res.changes > 0) taken.add(id);
    }
  }

  // 3. Tombstones for the records nobody took over.
  for (const old of before) {
    if (taken.has(old.record_id) || old.server_seq === null) continue;
    const free = sql.queryOne('SELECT 1 AS x FROM sync_record WHERE table_name = ? AND local_key = ?', [old.table_name, old.local_key]) === undefined;
    sql.execute(
      `INSERT INTO sync_record (table_name, local_key, record_id, changed_ms, rev, hlc, server_seq, dirty, deleted, base_json)
       VALUES (?, ?, ?, ${NOW_MS}, ?, ?, ?, ?, 1, ?)`,
      [old.table_name, free ? old.local_key : syntheticKey(old.record_id), old.record_id, old.rev + 1, old.hlc, old.server_seq,
        old.deleted ? old.dirty : 1, old.base_json]);
  }
}

// --- merge ------------------------------------------------------------------------------------------------

/**
 * Give a row that a merge just inserted the record id `id` from the backup. The insert trigger has already created its
 * (dirty, unidentified) line. A local tombstone that holds `id` is adopted: its server version metadata moves to the
 * row and the tombstone goes, so the row is an update of that record rather than a second one. An id held by a live
 * row (or by another kind of record) is left alone: the row gets a fresh identity. Returns whether the id was taken.
 */
export function adoptRecordId(sql: ISql, table: string, localKey: string, id: string): boolean {
  if (!isRecordId(id)) return false;
  const me = sql.queryOne<Identity>('SELECT * FROM sync_record WHERE table_name = ? AND local_key = ?', [table, localKey]);
  if (!me || me.deleted === 1) return false;
  if (me.record_id === id) return true;
  if (me.record_id !== null) {
    // The line inherited the identity of an older row with this local key (a reused rowid revives that row's tombstone
    // line, record id included); that record is not this row. Release the id first (record_id is UNIQUE), then park the
    // old record as a tombstone on a synthetic key if the server has it. The row starts as a fresh record.
    sql.execute(
      'UPDATE sync_record SET record_id = NULL, server_seq = NULL, hlc = NULL, base_json = NULL, dirty = 1 WHERE table_name = ? AND local_key = ?',
      [table, localKey]);
    if (me.server_seq !== null) {
      sql.execute(
        `INSERT INTO sync_record (table_name, local_key, record_id, changed_ms, rev, hlc, server_seq, dirty, deleted, base_json)
         VALUES (?, ?, ?, ${NOW_MS}, ?, ?, ?, 1, 1, ?)`,
        [table, syntheticKey(me.record_id), me.record_id, me.rev + 1, me.hlc, me.server_seq, me.base_json]);
    }
  }
  const holder = sql.queryOne<Identity>('SELECT * FROM sync_record WHERE record_id = ?', [id]);
  if (holder && (holder.table_name !== table || holder.deleted !== 1)) return false;
  let params: SqlParameter[] = [id, null, null, null, table, localKey];
  if (holder) {
    sql.execute('DELETE FROM sync_record WHERE table_name = ? AND local_key = ?', [holder.table_name, holder.local_key]);
    params = [id, holder.server_seq, holder.hlc, holder.base_json, table, localKey];
  }
  sql.execute('UPDATE sync_record SET record_id = ?, server_seq = ?, hlc = ?, base_json = ?, dirty = 1 WHERE table_name = ? AND local_key = ?', params);
  return true;
}
