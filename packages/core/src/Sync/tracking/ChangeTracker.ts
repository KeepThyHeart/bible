/**
 * Change tracking over the user DB (contracts 0063 §4). Browser-safe: pure `ISql`, no globals at module load.
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
import { USER_TABLES } from '../../Backup/Registry';

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

// --- implementation -----------------------------------------------------------------------------------------
//
// Triggers (one set per tracked table, named sync_trg_<table>_{ai,au,ad}) keep `sync_record` up to date for
// local edits. All three are guarded by the `applying` flag, so rows the engine writes inside `applyRemote`
// are not echoed back as local changes. `local_key` is the primary key as text; composite keys are joined
// with char(31). SQLite fires these triggers for foreign-key cascade deletes too, so a cascaded child delete
// is tracked like a direct one.

const SYNC_TABLES = ['sync_record', 'sync_state', 'sync_opaque', 'sync_pending'] as const;

const SYNC_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sync_record (
  table_name   TEXT NOT NULL,
  local_key    TEXT NOT NULL,
  record_id    TEXT UNIQUE,
  changed_ms   INTEGER NOT NULL,
  hlc          TEXT,
  server_seq   INTEGER,
  dirty        INTEGER NOT NULL DEFAULT 1,
  deleted      INTEGER NOT NULL DEFAULT 0,
  base_json    TEXT,
  PRIMARY KEY (table_name, local_key)
)`,
  'CREATE INDEX IF NOT EXISTS sync_record_dirty ON sync_record(dirty) WHERE dirty = 1',
  'CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sync_opaque (record_id TEXT PRIMARY KEY, server_seq INTEGER NOT NULL, blob BLOB)',
  `CREATE TABLE IF NOT EXISTS sync_pending (record_id TEXT PRIMARY KEY, server_seq INTEGER NOT NULL,
  plaintext TEXT NOT NULL, missing TEXT NOT NULL)`,
];

/** Wall-clock milliseconds, evaluated by SQLite (3.42+ for 'subsec'). */
const NOW_MS = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const NOT_APPLYING = "COALESCE((SELECT value FROM sync_state WHERE key = 'applying'), '0') <> '1'";
const TRIGGER_PREFIX = 'sync_trg_';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** SQL expression for the row's local key, read from `new` or `old` (or a bare table row when `alias` is ''). */
function keyExpr(pk: readonly string[], alias: 'new' | 'old' | ''): string {
  const col = (c: string): string => `CAST(${alias ? `${alias}.` : ''}${quoteIdent(c)} AS TEXT)`;
  return pk.map(col).join(' || char(31) || ');
}

function triggerNames(table: string): { ai: string; au: string; ad: string } {
  return { ai: `${TRIGGER_PREFIX}${table}_ai`, au: `${TRIGGER_PREFIX}${table}_au`, ad: `${TRIGGER_PREFIX}${table}_ad` };
}

/** Upsert the key as a live, dirty record. */
function touchSql(kind: string, key: string): string {
  return `INSERT INTO sync_record (table_name, local_key, changed_ms, dirty, deleted)
    VALUES (${kind}, ${key}, ${NOW_MS}, 1, 0)
    ON CONFLICT (table_name, local_key) DO UPDATE SET changed_ms = excluded.changed_ms, dirty = 1, deleted = 0;`;
}

/** A deleted key: forget it if the server never had it, otherwise leave a dirty tombstone. `cond` narrows both. */
function removeSql(kind: string, key: string, cond = ''): string {
  return `DELETE FROM sync_record WHERE table_name = ${kind} AND local_key = ${key} AND server_seq IS NULL${cond};
    UPDATE sync_record SET deleted = 1, dirty = 1, changed_ms = ${NOW_MS}
      WHERE table_name = ${kind} AND local_key = ${key}${cond};`;
}

function triggerDdl(t: TrackedTable): string[] {
  if (t.pk.length === 0) throw new Error(`ChangeTracker: table ${t.table} has no primary key`);
  const names = triggerNames(t.table);
  const tbl = quoteIdent(t.table);
  const kind = quoteText(t.kind);
  const newKey = keyExpr(t.pk, 'new');
  const oldKey = keyExpr(t.pk, 'old');
  return [
    `CREATE TRIGGER ${quoteIdent(names.ai)} AFTER INSERT ON ${tbl} WHEN ${NOT_APPLYING} BEGIN
    ${touchSql(kind, newKey)}
  END`,
    // A primary-key change is a delete of the old key plus an insert of the new one.
    `CREATE TRIGGER ${quoteIdent(names.au)} AFTER UPDATE ON ${tbl} WHEN ${NOT_APPLYING} BEGIN
    ${removeSql(kind, oldKey, ` AND (${oldKey}) IS NOT (${newKey})`)}
    ${touchSql(kind, newKey)}
  END`,
    `CREATE TRIGGER ${quoteIdent(names.ad)} AFTER DELETE ON ${tbl} WHEN ${NOT_APPLYING} BEGIN
    ${removeSql(kind, oldKey)}
  END`,
  ];
}

interface RecordRow {
  table_name: string; local_key: string; record_id: string | null; changed_ms: number; hlc: string | null;
  server_seq: number | null; dirty: number; deleted: number; base_json: string | null;
}

function toBytes(blob: unknown): Uint8Array | null {
  if (blob === null || blob === undefined) return null;
  if (blob instanceof Uint8Array) return new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
  throw new Error('ChangeTracker: unexpected blob value');
}

export function createChangeTracker(sql: ISql): ChangeTracker {
  const tableExists = (name: string): boolean =>
    sql.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [name])!.n > 0;

  const getState = (key: string): string | undefined =>
    sql.queryOne<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key])?.value;
  const setState = (key: string, value: string): void => {
    sql.execute(
      'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  };

  return {
    install(tables: TrackedTable[]): void {
      sql.transaction(() => {
        for (const statement of SYNC_DDL) sql.execute(statement);
        sql.execute("INSERT OR IGNORE INTO sync_state (key, value) VALUES ('applying', '0')");
        for (const t of tables) {
          if (!tableExists(t.table)) continue;
          const names = triggerNames(t.table);
          // Recreate rather than CREATE IF NOT EXISTS, so a changed pk or kind takes effect; same result otherwise.
          for (const n of [names.ai, names.au, names.ad]) sql.execute(`DROP TRIGGER IF EXISTS ${quoteIdent(n)}`);
          for (const statement of triggerDdl(t)) sql.execute(statement);
          // Enrol existing rows for the first upload; rows already tracked keep their record.
          sql.execute(
            `INSERT OR IGNORE INTO sync_record (table_name, local_key, changed_ms, dirty, deleted)
             SELECT ?, ${keyExpr(t.pk, '')}, ${NOW_MS}, 1, 0 FROM ${quoteIdent(t.table)}`,
            [t.kind],
          );
        }
      });
    },

    uninstall(): void {
      sql.transaction(() => {
        const triggers = sql.queryAll<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND substr(name, 1, ?) = ?",
          [TRIGGER_PREFIX.length, TRIGGER_PREFIX],
        );
        for (const { name } of triggers) sql.execute(`DROP TRIGGER IF EXISTS ${quoteIdent(name)}`);
        for (const table of SYNC_TABLES) sql.execute(`DROP TABLE IF EXISTS ${table}`);
      });
    },

    dirty(limit: number): DirtyRow[] {
      return sql.queryAll<RecordRow>(
        `SELECT * FROM sync_record WHERE dirty = 1 ORDER BY changed_ms, table_name, local_key LIMIT ?`,
        [limit],
      ).map((r) => ({
        kind: r.table_name,
        localKey: r.local_key,
        recordId: r.record_id,
        changedMs: r.changed_ms,
        serverSeq: r.server_seq,
        deleted: r.deleted === 1,
        baseJson: r.base_json,
      }));
    },

    pendingCount(): number {
      return sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM sync_record WHERE dirty = 1')!.n;
    },

    markSynced(kind, localKey, v): void {
      sql.execute(
        `INSERT INTO sync_record (table_name, local_key, record_id, changed_ms, hlc, server_seq, dirty, deleted, base_json)
         VALUES (?, ?, ?, ${NOW_MS}, ?, ?, 0, ?, ?)
         ON CONFLICT (table_name, local_key) DO UPDATE SET record_id = excluded.record_id, hlc = excluded.hlc,
           server_seq = excluded.server_seq, dirty = 0, deleted = excluded.deleted, base_json = excluded.base_json`,
        [kind, localKey, v.recordId, v.hlc, v.serverSeq, v.deleted ? 1 : 0, v.baseJson],
      );
    },

    assignRecordId(kind, localKey, recordId): void {
      const r = sql.execute('UPDATE sync_record SET record_id = ? WHERE table_name = ? AND local_key = ?', [recordId, kind, localKey]);
      if (r.changes === 0) throw new Error(`ChangeTracker: no sync record for ${kind} ${JSON.stringify(localKey)}`);
    },

    lookupByRecordId(recordId) {
      const r = sql.queryOne<RecordRow>('SELECT * FROM sync_record WHERE record_id = ?', [recordId]);
      if (!r) return undefined;
      return {
        kind: r.table_name, localKey: r.local_key, deleted: r.deleted === 1, dirty: r.dirty === 1,
        serverSeq: r.server_seq, baseJson: r.base_json, hlc: r.hlc,
      };
    },

    lookupByLocal(kind, localKey) {
      const r = sql.queryOne<{ record_id: string | null }>(
        'SELECT record_id FROM sync_record WHERE table_name = ? AND local_key = ?', [kind, localKey]);
      return r ? { recordId: r.record_id } : undefined;
    },

    applyRemote<T>(fn: () => T): T {
      try {
        return sql.transaction(() => {
          setState('applying', '1');
          const result = fn();
          setState('applying', '0');
          return result;
        });
      } finally {
        // The rollback of a throwing fn already reverts the flag; re-assert it for drivers that leave it set.
        if (getState('applying') === '1') setState('applying', '0');
      }
    },

    state: { get: getState, set: setState },

    opaque: {
      put(id, seq, blob): void {
        sql.execute('INSERT OR REPLACE INTO sync_opaque (record_id, server_seq, blob) VALUES (?, ?, ?)', [id, seq, blob]);
      },
      all() {
        return sql.queryAll<{ record_id: string; server_seq: number; blob: unknown }>(
          'SELECT record_id, server_seq, blob FROM sync_opaque ORDER BY server_seq, record_id',
        ).map((r) => ({ id: r.record_id, seq: r.server_seq, blob: toBytes(r.blob) }));
      },
      remove(id): void {
        sql.execute('DELETE FROM sync_opaque WHERE record_id = ?', [id]);
      },
    },

    pending: {
      put(id, seq, pt, missing): void {
        sql.execute(
          'INSERT OR REPLACE INTO sync_pending (record_id, server_seq, plaintext, missing) VALUES (?, ?, ?, ?)',
          [id, seq, JSON.stringify(pt), JSON.stringify(missing)],
        );
      },
      all() {
        return sql.queryAll<{ record_id: string; server_seq: number; plaintext: string; missing: string }>(
          'SELECT record_id, server_seq, plaintext, missing FROM sync_pending ORDER BY server_seq, record_id',
        ).map((r) => ({
          id: r.record_id,
          seq: r.server_seq,
          pt: JSON.parse(r.plaintext) as RecordPlaintext,
          missing: JSON.parse(r.missing) as RecordId[],
        }));
      },
      remove(id): void {
        sql.execute('DELETE FROM sync_pending WHERE record_id = ?', [id]);
      },
    },
  };
}

/** Workspace-class tables that sync anyway (plan refresh §1.8). */
const SYNCED_WORKSPACE_TABLES: readonly string[] = ['memory_setting', 'memory_resume_state'];
/** Extension-class tables that sync, with their record kind. */
const SYNCED_EXTENSION_TABLES: Readonly<Record<string, string>> = { extension_storage: 'ext.kv' };

/**
 * The tracked set for the user DB: every registry table with cls 'content', plus 'memory_setting' and
 * 'memory_resume_state', plus 'extension_storage' (kind 'ext.kv'). Registry order.
 */
export function coreTrackedTables(): TrackedTable[] {
  const out: TrackedTable[] = [];
  for (const spec of USER_TABLES) {
    const extKind = SYNCED_EXTENSION_TABLES[spec.name];
    if (spec.cls === 'content' || SYNCED_WORKSPACE_TABLES.includes(spec.name)) {
      out.push({ table: spec.name, pk: [...spec.pk], kind: spec.name });
    } else if (extKind !== undefined) {
      out.push({ table: spec.name, pk: [...spec.pk], kind: extKind });
    }
  }
  return out;
}
