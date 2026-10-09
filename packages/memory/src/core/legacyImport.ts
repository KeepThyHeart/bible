/**
 * One-time import of the Scripture Memory extension's own database into the
 * user database (task 0114).
 *
 * The extension kept its data in `<user data>/extensions/<id>/db/memory.db`
 * (schema v1-v7, versioned in its `meta` table). This copies every row into
 * the `memory_*` tables, once, and records that it did.
 *
 * Data-safety rules, in order of importance:
 *
 * 1. **The source is never written.** It is opened read-only by the caller and
 *    read inside one read transaction, so the snapshot is consistent even if
 *    the old extension is still running and writing to it. The file is left
 *    where it is; nothing here deletes it.
 * 2. **All or nothing.** The rows and the `memory_import` record are written
 *    in one transaction on the user database. Counts and foreign keys are
 *    checked before it commits; any failure rolls everything back, records
 *    nothing, and the import is tried again next time.
 * 3. **Never over real data.** The import runs only into a store that holds
 *    nothing but, at most, the empty Default list the module creates on first
 *    start (which the imported lists replace). Any passage, card, attempt,
 *    resume point, recite detail, push card, setting or other list counts as
 *    the user's own data: the import is then skipped and recorded as
 *    `skipped-not-empty`; the old file stays on disk.
 * 4. **Ids are kept.** Because the target is empty, every row keeps its id, so
 *    foreign keys and the ids inside settings (`practiceScope` names a list)
 *    and push-card keys stay valid without remapping.
 * 5. **Older schemas are read, not migrated.** A column a version lacks is
 *    filled with the default its migration added; a table it lacks is empty.
 *    A version newer than this code knows is not imported (and not recorded),
 *    so a later build can.
 *
 * `memory_import` is machine-local bookkeeping and is excluded from backups:
 * a backup restored on another machine must not stop that machine's own
 * import.
 */

import type { ISql, SqlParameter } from '@bible/core';

/** The extension's manifest id; its database directory is named after it. */
export { LEGACY_EXTENSION_ID } from '../manifest';
import { LEGACY_EXTENSION_ID } from '../manifest';
/** The database name the extension passed to `storage.openDatabase`. */
export const LEGACY_DB_NAME = 'memory';
/** The `memory_import.source` key for this import. Stable: it is stored. */
export const LEGACY_SOURCE_KEY = `extension:${LEGACY_EXTENSION_ID}/${LEGACY_DB_NAME}`;
/** The newest extension schema this code can read. */
export const LEGACY_MAX_VERSION = 7;

type Row = Record<string, unknown>;

/** One legacy table: its name in the old file, its target, and its columns with the defaults older versions imply. */
export interface TableMap {
  readonly from: string;
  readonly to: string;
  /** Column -> value used when the source table lacks the column (`undefined`: required, the row is unusable without it). */
  readonly columns: Readonly<Record<string, SqlParameter | undefined>>;
}

/** Parents before children. Defaults are what each migration's `ADD COLUMN` gave existing rows. */
export const LEGACY_TABLES: readonly TableMap[] = [
  { from: 'collection', to: 'memory_collection', columns: { id: undefined, name: undefined, created_at: undefined } },
  {
    from: 'passage',
    to: 'memory_passage',
    columns: {
      id: undefined,
      collection_id: undefined,
      module_id: undefined,
      start_verse_id: undefined,
      end_verse_id: undefined,
      reference: undefined,
      verse_count: undefined,
      added_at: undefined,
      answer_mode: null, // v2
      deleted_at: null, // v5
      recite_on: 0, // v6
    },
  },
  {
    from: 'card',
    to: 'memory_card',
    columns: {
      id: undefined,
      passage_id: undefined,
      rung: undefined,
      state: 'new',
      interval_step: -1,
      due_at: null,
      streak: 0,
      last_score: null,
      progress_reset_at: null, // v3
    },
  },
  {
    from: 'attempt',
    to: 'memory_attempt',
    columns: {
      id: undefined,
      card_id: undefined,
      at: undefined,
      score: undefined,
      correct_first: undefined,
      total_steps: undefined,
      replay: 0,
      duration_ms: null, // v2
      tier: 0, // v3
    },
  },
  { from: 'setting', to: 'memory_setting', columns: { key: undefined, value: undefined } }, // v2
  {
    from: 'resume_state', // v2
    to: 'memory_resume_state',
    columns: {
      card_id: undefined,
      cursor: undefined,
      correct_first: undefined,
      graded_units: undefined,
      updated_at: undefined,
      tier: 0, // v4
    },
  },
  {
    from: 'recite_detail', // v6
    to: 'memory_recite_detail',
    columns: {
      attempt_id: undefined,
      card_id: undefined,
      at: undefined,
      verdicts: undefined,
      credits: undefined,
      verse_scores: undefined,
      extras: undefined,
      strictness: undefined,
      engine_id: null,
      model_id: null,
    },
  },
  {
    from: 'push_card', // v7
    to: 'memory_push_card',
    columns: { key: undefined, passage_id: undefined, fire_at: undefined, origin: undefined, state: undefined, updated_at: undefined },
  },
];

/** Tables whose rows are "real data": a target holding any of them is not overwritten. */
const SUBSTANTIVE = [
  'memory_passage',
  'memory_card',
  'memory_attempt',
  'memory_resume_state',
  'memory_recite_detail',
  'memory_push_card',
] as const;

export type LegacyCounts = Record<string, number>;

export type LegacyImportResult =
  /** Already imported or skipped earlier on this machine; the source was not opened. */
  | { readonly status: 'already-recorded'; readonly recorded: string }
  /** No old database here. Nothing recorded; looked for again next time. */
  | { readonly status: 'no-source' }
  /** The file is not a Scripture Memory database (no version). Nothing recorded. */
  | { readonly status: 'not-a-memory-db' }
  /** Written by a newer extension than this code reads. Nothing recorded. */
  | { readonly status: 'unsupported-version'; readonly sourceVersion: number }
  /** The store already held real data; nothing imported. Recorded. */
  | { readonly status: 'skipped-not-empty'; readonly sourceVersion: number; readonly counts: LegacyCounts }
  /** Imported. `dropped` counts source rows whose parent row was missing (should be none). Recorded. */
  | { readonly status: 'imported'; readonly sourceVersion: number; readonly counts: LegacyCounts; readonly dropped: LegacyCounts };

export interface LegacyImportOptions {
  /** Opens the old database read-only, or returns null when there is none. The importer closes it. */
  readonly openSource: () => ISql | null;
  readonly now: number;
}

/** The status recorded for this source, if any. */
export function legacyImportRecord(target: ISql): { status: string; recordedAt: number; counts: LegacyCounts | null } | undefined {
  const row = target.queryOne<{ status: string; recorded_at: number; counts: string | null }>(
    'SELECT status, recorded_at, counts FROM memory_import WHERE source = ?',
    [LEGACY_SOURCE_KEY],
  );
  if (!row) return undefined;
  let counts: LegacyCounts | null = null;
  try {
    counts = row.counts ? (JSON.parse(row.counts) as LegacyCounts) : null;
  } catch {
    counts = null;
  }
  return { status: row.status, recordedAt: row.recorded_at, counts };
}

/**
 * Import the old extension database into `target` if that has not happened on
 * this machine yet. Synchronous; run it before the memory store is first used.
 * Throws only for an unexpected failure (unreadable file, a write error), in
 * which case nothing was written.
 */
export function importLegacyMemory(target: ISql, opts: LegacyImportOptions): LegacyImportResult {
  const recorded = legacyImportRecord(target);
  if (recorded) return { status: 'already-recorded', recorded: recorded.status };

  const source = opts.openSource();
  if (!source) return { status: 'no-source' };

  let snapshot: Snapshot | 'not-a-memory-db' | { unsupported: number };
  try {
    snapshot = readSnapshot(source);
  } finally {
    try {
      source.close();
    } catch {
      /* closing a read-only handle cannot lose data */
    }
  }
  if (snapshot === 'not-a-memory-db') return { status: 'not-a-memory-db' };
  if ('unsupported' in snapshot) return { status: 'unsupported-version', sourceVersion: snapshot.unsupported };

  return writeSnapshot(target, snapshot, opts.now);
}

// --- reading ------------------------------------------------------------------

interface Snapshot {
  readonly version: number;
  /** Target table -> rows in target column names, parents' rows first. */
  readonly rows: ReadonlyMap<string, Row[]>;
  readonly dropped: LegacyCounts;
}

function readSnapshot(source: ISql): Snapshot | 'not-a-memory-db' | { unsupported: number } {
  // One read transaction: every table is read from the same instant.
  source.execute('BEGIN');
  try {
    const version = readVersion(source);
    if (version === null) return 'not-a-memory-db';
    if (version > LEGACY_MAX_VERSION) return { unsupported: version };

    const raw = new Map<string, Row[]>();
    for (const t of LEGACY_TABLES) raw.set(t.to, readTable(source, t));
    const { rows, dropped } = dropOrphans(raw);
    return { version, rows, dropped };
  } finally {
    try {
      source.execute('COMMIT');
    } catch {
      /* a read-only transaction has nothing to commit */
    }
  }
}

function readVersion(source: ISql): number | null {
  if (!tableExists(source, 'meta')) return null;
  const row = source.queryOne<{ value: unknown }>('SELECT value FROM meta WHERE key = ?', ['schema_version']);
  const v = row ? Number(row.value) : NaN;
  return Number.isInteger(v) && v >= 1 ? v : null;
}

function tableExists(source: ISql, name: string): boolean {
  return !!source.queryOne("SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);
}

function readTable(source: ISql, t: TableMap): Row[] {
  if (!tableExists(source, t.from)) return [];
  // Table and column names come from the constant map above, never from the file.
  const present = new Set(source.queryAll<{ name: string }>(`PRAGMA table_info(${t.from})`).map((c) => c.name));
  const wanted = Object.keys(t.columns);
  for (const c of wanted) {
    if (!present.has(c) && t.columns[c] === undefined) {
      throw new Error(`Old memory database: ${t.from}.${c} is missing`);
    }
  }
  const selected = wanted.filter((c) => present.has(c));
  const order = present.has('id') ? 'id' : present.has('card_id') && t.from === 'resume_state' ? 'card_id' : present.has('attempt_id') ? 'attempt_id' : 'rowid';
  const rows = source.queryAll<Row>(`SELECT ${selected.join(', ')} FROM ${t.from} ORDER BY ${order}`);
  return rows.map((r) => {
    const out: Row = {};
    for (const c of wanted) out[c] = present.has(c) ? r[c] : t.columns[c];
    return out;
  });
}

/**
 * Foreign keys were on in the extension's database, so orphans should not
 * exist. If one does (a file edited by hand), the row is left out and counted
 * rather than failing the whole import or writing a dangling reference.
 */
function dropOrphans(raw: Map<string, Row[]>): { rows: Map<string, Row[]>; dropped: LegacyCounts } {
  const dropped: LegacyCounts = {};
  const rows = new Map<string, Row[]>();
  const ids = (table: string, col = 'id'): Set<unknown> => new Set((rows.get(table) ?? []).map((r) => r[col]));
  const keep = (table: string, ok: (r: Row) => boolean): void => {
    const all = raw.get(table) ?? [];
    const kept = all.filter(ok);
    rows.set(table, kept);
    if (kept.length !== all.length) dropped[table] = all.length - kept.length;
  };

  keep('memory_collection', () => true);
  const collections = ids('memory_collection');
  keep('memory_passage', (r) => collections.has(r.collection_id));
  const passages = ids('memory_passage');
  keep('memory_card', (r) => passages.has(r.passage_id));
  const cards = ids('memory_card');
  keep('memory_attempt', (r) => cards.has(r.card_id));
  const attempts = ids('memory_attempt');
  keep('memory_setting', () => true);
  keep('memory_resume_state', (r) => cards.has(r.card_id));
  keep('memory_recite_detail', (r) => attempts.has(r.attempt_id) && cards.has(r.card_id));
  keep('memory_push_card', (r) => passages.has(r.passage_id));
  return { rows, dropped };
}

// --- writing ------------------------------------------------------------------

function countOf(target: ISql, table: string): number {
  return target.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;
}

function countsOf(snapshot: Snapshot): LegacyCounts {
  const out: LegacyCounts = {};
  for (const t of LEGACY_TABLES) out[t.to] = snapshot.rows.get(t.to)?.length ?? 0;
  return out;
}

function record(target: ISql, status: string, version: number, now: number, counts: LegacyCounts, detail: unknown): void {
  target.execute(
    'INSERT INTO memory_import (source, status, source_version, recorded_at, counts, detail) VALUES (?, ?, ?, ?, ?, ?)',
    [LEGACY_SOURCE_KEY, status, version, now, JSON.stringify(counts), detail === undefined ? null : JSON.stringify(detail)],
  );
}

function writeSnapshot(target: ISql, snapshot: Snapshot, now: number): LegacyImportResult {
  const counts = countsOf(snapshot);
  return target.transaction((): LegacyImportResult => {
    // Re-checked inside the write transaction: nothing can change between check and write.
    const again = legacyImportRecord(target);
    if (again) return { status: 'already-recorded', recorded: again.status };

    const existing: LegacyCounts = {};
    let substantive = 0;
    for (const t of SUBSTANTIVE) {
      existing[t] = countOf(target, t);
      substantive += existing[t];
    }
    // Lists other than one Default, or any setting, are the user's own work in the module: keep them.
    const lists = target.queryAll<{ name: string }>('SELECT name FROM memory_collection');
    const shellOnly = lists.length === 0 || (lists.length === 1 && lists[0]?.name === 'Default');
    existing.memory_collection = lists.length;
    existing.memory_setting = countOf(target, 'memory_setting');
    if (substantive > 0 || !shellOnly || existing.memory_setting > 0) {
      record(target, 'skipped-not-empty', snapshot.version, now, counts, { existing });
      return { status: 'skipped-not-empty', sourceVersion: snapshot.version, counts };
    }

    // At most the empty Default list the module creates on first start: the imported lists replace it.
    target.execute('DELETE FROM memory_collection');

    for (const t of LEGACY_TABLES) {
      const rows = snapshot.rows.get(t.to) ?? [];
      const cols = Object.keys(t.columns);
      const sql = `INSERT INTO ${t.to} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      for (const r of rows) target.execute(sql, cols.map((c) => r[c] as SqlParameter));
    }

    for (const t of LEGACY_TABLES) {
      const n = countOf(target, t.to);
      if (n !== counts[t.to]) throw new Error(`Memory import: ${t.to} has ${n} rows, expected ${counts[t.to]}`);
    }
    for (const t of LEGACY_TABLES) {
      const bad = target.queryAll(`PRAGMA foreign_key_check(${t.to})`);
      if (bad.length > 0) throw new Error(`Memory import: ${bad.length} broken references in ${t.to}`);
    }

    // The import keeps ids, so each imported list maps to itself. Recorded so a later merge can find a
    // list again after the user renamed it (matching by name alone would duplicate it).
    const collections: Record<string, number> = {};
    for (const c of snapshot.rows.get('memory_collection') ?? []) collections[String(c.id)] = Number(c.id);
    record(target, 'imported', snapshot.version, now, counts, {
      collections,
      ...(Object.keys(snapshot.dropped).length > 0 ? { dropped: snapshot.dropped } : {}),
    });
    return { status: 'imported', sourceVersion: snapshot.version, counts, dropped: snapshot.dropped };
  });
}

// --- manual merge ---------------------------------------------------------------

export type LegacyMergeResult =
  | { readonly status: 'no-source' }
  | { readonly status: 'not-a-memory-db' }
  | { readonly status: 'unsupported-version'; readonly sourceVersion: number }
  | {
      readonly status: 'merged';
      readonly sourceVersion: number;
      /** Rows written, per table. */
      readonly added: LegacyCounts;
      /** Source rows that matched a row already here (not written again). */
      readonly matched: LegacyCounts;
      /** Local passages that were soft-deleted and came back because the old database still has them. */
      readonly revived: number;
      /** Matched cards that took the old database's schedule because it was practised there more recently. */
      readonly advanced: LegacyCounts;
    };

/**
 * Merge the old extension database into a store that already has data: the
 * user's "Import data from the old Scripture Memory extension" action, for
 * when the automatic import was skipped (`skipped-not-empty`) or an old file
 * came back later.
 *
 * Same matching rules as merging a backup (the registry's identities), so it
 * is idempotent: lists by the id recorded at import (renames survive) or name, passages by list + translation + range, cards
 * by passage + activity, attempts by all their values. Local rows are never
 * changed, except that a card keeps the later progress reset and a local
 * passage that was soft-deleted is restored when the old database has it
 * live AND practised it after the local removal, and a matched card takes the old schedule when the
 * old database holds practice newer than anything here. New rows get new ids; the saved list scope is translated. Push-card
 * schedules are not copied (they are rebuilt from the plan). One transaction,
 * checked with `foreign_key_check`; the source is only read.
 */
export function mergeLegacyMemory(target: ISql, opts: LegacyImportOptions): LegacyMergeResult {
  const source = opts.openSource();
  if (!source) return { status: 'no-source' };
  let snapshot: Snapshot | 'not-a-memory-db' | { unsupported: number };
  try {
    snapshot = readSnapshot(source);
  } finally {
    try {
      source.close();
    } catch {
      /* read-only */
    }
  }
  if (snapshot === 'not-a-memory-db') return { status: 'not-a-memory-db' };
  if ('unsupported' in snapshot) return { status: 'unsupported-version', sourceVersion: snapshot.unsupported };
  const snap = snapshot;
  return target.transaction(() => mergeSnapshot(target, snap, opts.now));
}

/** Old-database list id -> local list id, from the import and earlier merges (later records win). */
function recordedCollectionMap(target: ISql): Map<number, number> {
  const map = new Map<number, number>();
  const records = target.queryAll<{ detail: string | null }>(
    "SELECT detail FROM memory_import WHERE source = ? OR source LIKE ? ORDER BY recorded_at, rowid",
    [LEGACY_SOURCE_KEY, `${LEGACY_SOURCE_KEY}#merge@%`],
  );
  for (const r of records) {
    if (!r.detail) continue;
    try {
      const parsed = JSON.parse(r.detail) as { collections?: Record<string, unknown> };
      for (const [from, to] of Object.entries(parsed.collections ?? {})) {
        if (typeof to === 'number') map.set(Number(from), to);
      }
    } catch {
      /* an unreadable record is ignored; name matching still applies */
    }
  }
  return map;
}

function mergeSnapshot(target: ISql, snap: Snapshot, now: number): LegacyMergeResult {
  const rows = (t: string): Row[] => snap.rows.get(t) ?? [];
  const added: LegacyCounts = {};
  const matched: LegacyCounts = {};
  /** Matched rows whose values moved forward to the old database's. */
  const advanced: LegacyCounts = {};
  const bump = (m: LegacyCounts, t: string) => (m[t] = (m[t] ?? 0) + 1);
  const insert = (table: string, row: Row, cols: string[]): number => {
    const r = target.execute(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => row[c] as SqlParameter),
    );
    bump(added, table);
    return r.lastInsertRowId ?? 0;
  };
  const colsOf = (table: string, without: string[] = []): string[] =>
    Object.keys(LEGACY_TABLES.find((t) => t.to === table)!.columns).filter((c) => !without.includes(c));

  // Lists match by the id recorded when they were first brought over (a rename here must not make
  // the old database's list look new), and by name otherwise.
  const knownLists = recordedCollectionMap(target);
  const collections = new Map<unknown, number>();
  const collectionMap: Record<string, number> = {};
  for (const c of rows('memory_collection')) {
    const known = knownLists.get(Number(c.id));
    const byId = known !== undefined ? target.queryOne<{ id: number }>('SELECT id FROM memory_collection WHERE id = ?', [known]) : undefined;
    const local =
      byId ??
      target.queryOne<{ id: number }>('SELECT id FROM memory_collection WHERE name = ? ORDER BY id LIMIT 1', [c.name as SqlParameter]);
    if (local) {
      collections.set(c.id, local.id);
      bump(matched, 'memory_collection');
    } else {
      collections.set(c.id, insert('memory_collection', c, colsOf('memory_collection', ['id'])));
    }
    collectionMap[String(c.id)] = collections.get(c.id)!;
  }

  let revived = 0;
  const reviveCandidates: number[] = [];
  const passages = new Map<unknown, number>();
  for (const p of rows('memory_passage')) {
    const collectionId = collections.get(p.collection_id);
    if (collectionId === undefined) continue;
    const mapped = { ...p, collection_id: collectionId };
    const local = target.queryOne<{ id: number; deleted_at: number | null }>(
      `SELECT id, deleted_at FROM memory_passage
        WHERE collection_id = ? AND module_id = ? AND start_verse_id = ? AND end_verse_id = ?`,
      [collectionId, p.module_id as SqlParameter, p.start_verse_id as SqlParameter, p.end_verse_id as SqlParameter],
    );
    if (local) {
      passages.set(p.id, local.id);
      bump(matched, 'memory_passage');
      // Removed here, live there: decided after the attempts are in (see below).
      if (local.deleted_at !== null && p.deleted_at === null) reviveCandidates.push(local.id);
    } else {
      passages.set(p.id, insert('memory_passage', mapped, colsOf('memory_passage', ['id'])));
    }
  }

  const cards = new Map<unknown, number>();
  const newCards = new Set<number>();
  /** Local card id -> the old database's row, for cards both sides have. */
  const matchedCards = new Map<number, Row>();
  const localLatest = new Map<number, number>();
  for (const c of rows('memory_card')) {
    const passageId = passages.get(c.passage_id);
    if (passageId === undefined) continue;
    const local = target.queryOne<{ id: number; progress_reset_at: number | null }>(
      'SELECT id, progress_reset_at FROM memory_card WHERE passage_id = ? AND rung = ?',
      [passageId, c.rung as SqlParameter],
    );
    if (local) {
      cards.set(c.id, local.id);
      bump(matched, 'memory_card');
      matchedCards.set(local.id, c);
      const latest = target.queryOne<{ at: number | null }>('SELECT MAX(at) AS at FROM memory_attempt WHERE card_id = ?', [local.id]);
      if (latest?.at != null) localLatest.set(local.id, latest.at);
      const theirs = typeof c.progress_reset_at === 'number' ? c.progress_reset_at : null;
      if (theirs !== null && (local.progress_reset_at === null || theirs > local.progress_reset_at)) {
        target.execute('UPDATE memory_card SET progress_reset_at = ? WHERE id = ?', [theirs, local.id]);
      }
    } else {
      const id = insert('memory_card', { ...c, passage_id: passageId }, colsOf('memory_card', ['id']));
      cards.set(c.id, id);
      newCards.add(id);
    }
  }

  const attempts = new Map<unknown, number>();
  const newAttempts = new Set<number>();
  for (const a of rows('memory_attempt')) {
    const cardId = cards.get(a.card_id);
    if (cardId === undefined) continue;
    const local = target.queryOne<{ id: number }>(
      `SELECT id FROM memory_attempt
        WHERE card_id = ? AND at = ? AND score = ? AND correct_first = ? AND total_steps = ? AND tier = ?`,
      [cardId, a.at, a.score, a.correct_first, a.total_steps, a.tier] as SqlParameter[],
    );
    if (local) {
      attempts.set(a.id, local.id);
      bump(matched, 'memory_attempt');
    } else {
      const id = insert('memory_attempt', { ...a, card_id: cardId }, colsOf('memory_attempt', ['id']));
      attempts.set(a.id, id);
      newAttempts.add(id);
    }
  }

  // A matched card whose old copy was practised after anything here takes the old schedule: the
  // attempts alone would leave it due when it is not (or not due when it is). Local progress that is
  // newer, or a reset newer than the old practice, wins.
  const schedule = ['state', 'interval_step', 'due_at', 'streak', 'last_score'] as const;
  for (const [localId, theirs] of matchedCards) {
    const newest = target.queryOne<{ at: number | null }>(
      `SELECT MAX(a.at) AS at FROM memory_attempt a WHERE a.card_id = ? AND a.id IN (${[...newAttempts].join(',') || 'NULL'})`,
      [localId],
    );
    const theirLatest = newest?.at;
    if (theirLatest == null || theirs.state === 'new') continue; // practised but never scheduled: nothing to take
    if (theirLatest <= (localLatest.get(localId) ?? -Infinity)) continue;
    const reset = target.queryOne<{ progress_reset_at: number | null }>('SELECT progress_reset_at FROM memory_card WHERE id = ?', [localId]);
    if (reset?.progress_reset_at != null && theirLatest <= reset.progress_reset_at) continue;
    target.execute(
      `UPDATE memory_card SET ${schedule.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...schedule.map((c) => theirs[c] as SqlParameter), localId],
    );
    bump(advanced, 'memory_card');
  }

  // A passage the user removed here comes back only if it was practised after the removal (the
  // old extension kept being used). Older history alone does not undo a deliberate removal.
  // Only attempts THIS merge inserted count: local ones after the removal (a session that finished
  // late) are no reason to undo it.
  for (const id of reviveCandidates) {
    const passage = target.queryOne<{ deleted_at: number }>('SELECT deleted_at FROM memory_passage WHERE id = ?', [id]);
    if (!passage) continue;
    const merged = target.queryAll<{ id: number; at: number }>(
      'SELECT a.id AS id, a.at AS at FROM memory_attempt a JOIN memory_card c ON c.id = a.card_id WHERE c.passage_id = ?',
      [id],
    );
    if (merged.some((a) => newAttempts.has(a.id) && a.at > passage.deleted_at)) {
      revived += target.execute('UPDATE memory_passage SET deleted_at = NULL WHERE id = ?', [id]).changes;
    }
  }

  for (const d of rows('memory_recite_detail')) {
    const attemptId = attempts.get(d.attempt_id);
    const cardId = cards.get(d.card_id);
    if (attemptId === undefined || cardId === undefined || !newAttempts.has(attemptId)) {
      if (attemptId !== undefined) bump(matched, 'memory_recite_detail');
      continue;
    }
    insert('memory_recite_detail', { ...d, attempt_id: attemptId, card_id: cardId }, colsOf('memory_recite_detail'));
  }

  for (const r of rows('memory_resume_state')) {
    const cardId = cards.get(r.card_id);
    if (cardId === undefined || !newCards.has(cardId)) continue;
    insert('memory_resume_state', { ...r, card_id: cardId }, colsOf('memory_resume_state'));
  }

  for (const s of rows('memory_setting')) {
    if (target.queryOne('SELECT 1 AS one FROM memory_setting WHERE key = ?', [s.key as SqlParameter])) {
      bump(matched, 'memory_setting');
      continue;
    }
    let value = s.value;
    if (s.key === 'pushCards') {
      // Pinned passages are ids in the old database: translate them, drop the ones not brought over.
      try {
        const settings = JSON.parse(String(s.value)) as { pinnedPassageIds?: unknown };
        if (Array.isArray(settings.pinnedPassageIds)) {
          settings.pinnedPassageIds = settings.pinnedPassageIds
            .map((id) => passages.get(id))
            .filter((id): id is number => typeof id === 'number');
          value = JSON.stringify(settings);
        }
      } catch {
        continue;
      }
    }
    if (s.key === 'practiceScope') {
      try {
        const scope = JSON.parse(String(s.value)) as { kind?: string; id?: unknown };
        if (scope.kind === 'list') {
          const mapped = collections.get(scope.id);
          if (mapped === undefined) continue;
          value = JSON.stringify({ kind: 'list', id: mapped });
        }
      } catch {
        continue;
      }
    }
    insert('memory_setting', { key: s.key, value }, ['key', 'value']);
  }

  for (const t of LEGACY_TABLES) {
    const bad = target.queryAll(`PRAGMA foreign_key_check(${t.to})`);
    if (bad.length > 0) throw new Error(`Memory import: ${bad.length} broken references in ${t.to}`);
  }

  const detail = { added, matched, revived, advanced, collections: collectionMap };
  target.execute(
    'INSERT INTO memory_import (source, status, source_version, recorded_at, counts, detail) VALUES (?, ?, ?, ?, ?, ?)',
    [`${LEGACY_SOURCE_KEY}#merge@${now}`, 'merged', snap.version, now, JSON.stringify(added), JSON.stringify(detail)],
  );
  // The automatic import must not run over the merged data later; a skipped one now reads as merged.
  target.execute(
    "UPDATE memory_import SET status = 'merged' WHERE source = ? AND status = 'skipped-not-empty'",
    [LEGACY_SOURCE_KEY],
  );
  target.execute(
    'INSERT OR IGNORE INTO memory_import (source, status, source_version, recorded_at, counts, detail) VALUES (?, ?, ?, ?, ?, ?)',
    [LEGACY_SOURCE_KEY, 'merged', snap.version, now, JSON.stringify(added), null],
  );
  return { status: 'merged', sourceVersion: snap.version, added, matched, revived, advanced };
}
