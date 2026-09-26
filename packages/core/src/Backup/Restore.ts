/**
 * Restore: inspect a verified backup, then apply it in `replace` or `merge` mode.
 *
 * Two steps, so nothing is written before the user has seen what would happen:
 *
 *  1. `inspectBackup(archive, target)` maps the backup onto this database and
 *     returns a `RestorePlan` with per-section counts, warnings and a dry-run
 *     preview of both modes (the dry run really executes, inside a transaction that
 *     is rolled back).
 *  2. `applyRestore(plan, target, options)` does it: all database work in ONE
 *     transaction (any row error rolls back everything), then the files (notes,
 *     extension databases), which cannot be part of that transaction.
 *
 * **replace** clears the selected tables (and any table that points into them,
 * even when the backup has nothing for it, so no row is left pointing at a note
 * that no longer exists) and inserts the backup's rows with their original ids.
 *
 * **merge** adds a backup to a database in use. Rows get new local ids, foreign keys
 * are remapped, and rows the database already has are recognised through each table's
 * identity rule and reused instead of duplicated, so merging the same backup twice
 * changes nothing.
 *
 * Everything runs on `ISql` alone, so it works on any provider.
 */
import type { ISql, SqlParameter } from '../Data/Core/ISql';
import { b64urlEncode } from '../Crypto';
import { DamagedError, NewerFormatError } from './errors';
import { sectionRows } from './Payload';
import type { BackupArchive, ManifestSection } from './Payload';
import { EXTENSION_DB_NAME_PATTERN, EXTENSION_ID_PATTERN } from './ExtensionData';
import { USER_SCHEMA_VERSION, orderedTables, parentTables, tableSpec, upgradeRow } from './Registry';
import type { FkSpec, Row, TableSpec } from './Registry';
import { checkEntryName } from './Zip';

export type RestoreMode = 'replace' | 'merge';

// --- targets ---------------------------------------------------------------------

/** Where note files live. Paths are POSIX, relative to the notes directory. */
export interface FileSink {
  /** Every file currently present. */
  list(): Promise<string[]>;
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, data: Uint8Array): Promise<void>;
  /** Move everything that is there now aside (not deleted); returns where to, or undefined if there was nothing. */
  moveAside(label: string): Promise<string | undefined>;
}

export interface ExtensionDataSink {
  dbExists(id: string, name: string): Promise<boolean>;
  writeDb(id: string, name: string, data: Uint8Array): Promise<void>;
}

export interface RestoreTarget {
  sql: ISql;
  notes?: FileSink;
  extensions?: ExtensionDataSink;
  /** Injectable clock (names of conflict copies and the move-aside folder). */
  now?: () => Date;
}

// --- plan and report ------------------------------------------------------------------

export interface RestoreWarning {
  code: string;
  params: Record<string, string | number>;
}

export interface SectionPlan {
  id: string;
  kind: string;
  class: string;
  count: number;
  table?: string;
  ext?: string;
  db?: string;
  /** False when this database has no such table (the section is skipped). */
  targetExists: boolean;
  /** Rows now in the target table, when it exists. */
  targetRows?: number;
  /** Selected by default in each mode. */
  defaultOn: { replace: boolean; merge: boolean };
  /** Columns in the backup this database does not have (dropped). */
  droppedColumns: string[];
  /** Columns this database has that the backup does not (their defaults apply). */
  missingColumns: string[];
}

export interface RestorePlan {
  /** The verified backup; opaque to callers. */
  archive: BackupArchive;
  source: { app: { name: string; version: string; platform: string }; createdAt: string; userSchemaVersion: number };
  sections: SectionPlan[];
  unknownSections: Array<{ id: string; reason: string }>;
  extensions: Array<{ id: string; kvRows: number; databases: string[] }>;
  noteFiles: number;
  historyNoteFiles: number;
  warnings: RestoreWarning[];
  /** What each mode would do with the default selection. Present when requested. */
  preview?: { replace: RestoreReport; merge: RestoreReport };
}

export interface TableReport {
  table: string;
  cleared: number;
  inserted: number;
  /** Backup rows that matched a row already there (merge). */
  matched: number;
  /** Matched rows whose values were updated (merge, newer wins). */
  updated: number;
  dropped: Partial<Record<'danglingFk' | 'skipped' | 'otherType' | 'cycle' | 'keptLocal' | 'extMismatch', number>>;
  /** Foreign keys set to NULL because the parent is not in the restored data. */
  nulled: number;
}

export interface RestoreReport {
  mode: RestoreMode;
  ok: boolean;
  perTable: TableReport[];
  droppedColumns: Array<{ table: string; column: string; rows: number }>;
  skippedSections: Array<{ id: string; reason: string }>;
  notes: { written: number; identical: number; conflictCopies: Array<{ original: string; copy: string }>; movedAsideTo?: string; historyWritten: number; skippedExisting: number };
  extDbs: Array<{ id: string; name: string; action: 'written' | 'keptLocal' }>;
  preferences?: Record<string, unknown>;
  fileErrors: Array<{ path: string; message: string }>;
  warnings: RestoreWarning[];
}

/** A row could not be restored; the whole database transaction was rolled back. */
export class RestoreError extends Error {
  constructor(message: string, readonly detail: { table?: string; sectionId?: string; row?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'RestoreError';
    Object.setPrototypeOf(this, RestoreError.prototype);
  }
}

class DryRunRollback extends Error {
  constructor(readonly report: RestoreReport) {
    super('dry run');
  }
}

// --- small helpers ---------------------------------------------------------------------

const q = (name: string): string => `"${name.replace(/"/g, '""')}"`;

function tableExists(sql: ISql, name: string): boolean {
  return sql.queryOne("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]) !== undefined;
}

function liveColumns(sql: ISql, table: string): string[] {
  return sql.queryAll<{ name: string }>(`PRAGMA table_info(${q(table)})`).map((c) => c.name);
}

function normKey(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Uint8Array) return { $b64: b64urlEncode(v) };
  return v;
}

function keyOf(cols: string[], row: Row): string {
  return JSON.stringify(cols.map((c) => normKey(row[c])));
}

/** Milliseconds for an ISO timestamp, SQLite's `YYYY-MM-DD HH:MM:SS` (UTC) or a number; NaN when unknown. */
export function stampMs(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return Number.NaN;
  if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?$/.test(v)) return Date.parse(v.replace(' ', 'T') + 'Z');
  return Date.parse(v);
}

const HISTORY_CLASSES = new Set(['history']);

function defaultOn(cls: string, kind: string): { replace: boolean; merge: boolean } {
  if (kind === 'info') return { replace: false, merge: false };
  if (cls === 'content' || cls === 'extension') return { replace: true, merge: true };
  if (HISTORY_CLASSES.has(cls) || cls === 'workspace') return { replace: true, merge: false };
  return { replace: false, merge: false };
}

function dateLabel(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// --- inspect ------------------------------------------------------------------------------

export interface InspectOptions {
  /** Run both modes as rolled-back dry runs to fill `preview`. Default true. */
  preview?: boolean;
}

/** Map a verified backup onto this database. Writes nothing (the preview is rolled back). */
export function inspectBackup(archive: BackupArchive, target: RestoreTarget, opts: InspectOptions = {}): RestorePlan {
  const { manifest } = archive;
  if (manifest.userSchemaVersion > USER_SCHEMA_VERSION) {
    throw new NewerFormatError('This backup was made by a newer version of Keep Thy Heart. Update the app to restore it.');
  }
  const sql = target.sql;
  const warnings: RestoreWarning[] = [];
  const sections: SectionPlan[] = [];
  let noteFiles = 0;
  let historyNoteFiles = 0;
  const exts = new Map<string, { id: string; kvRows: number; databases: string[] }>();

  for (const s of archive.sections) {
    const plan: SectionPlan = {
      id: s.id, kind: s.kind, class: s.class, count: s.count, table: s.table, ext: s.ext, db: s.db,
      targetExists: true, defaultOn: defaultOn(s.class, s.kind), droppedColumns: [], missingColumns: [],
    };
    if (s.kind === 'table' || s.kind === 'extKv') {
      const name = s.kind === 'table' ? (s.table as string) : 'extension_storage';
      plan.targetExists = tableExists(sql, name);
      if (plan.targetExists) {
        const live = liveColumns(sql, name);
        const spec = tableSpec(name) as TableSpec;
        const known = new Set(spec.columns);
        const backupCols = s.columns ?? [];
        plan.droppedColumns = backupCols.filter((c) => !live.includes(c) || !known.has(c));
        plan.missingColumns = live.filter((c) => !backupCols.includes(c));
        plan.targetRows = sql.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${q(name)}`)?.n ?? 0;
      }
    }
    if (s.kind === 'files') {
      if (s.id === 'notes') noteFiles = s.count;
      else historyNoteFiles = s.count;
      plan.targetExists = target.notes !== undefined;
    }
    if (s.kind === 'extKv' || s.kind === 'extDb') {
      const id = s.ext as string;
      let e = exts.get(id);
      if (!e) exts.set(id, (e = { id, kvRows: 0, databases: [] }));
      if (s.kind === 'extKv') e.kvRows = s.count;
      else {
        e.databases.push(s.db as string);
        plan.targetExists = target.extensions !== undefined;
      }
    }
    if (plan.droppedColumns.length > 0) warnings.push({ code: 'columnsDropped', params: { section: s.id, columns: plan.droppedColumns.join(', ') } });
    sections.push(plan);
  }

  const withModuleIds = sections.filter((s) => s.count > 0 && ['user_text_markup', 'pinned_item', 'module_display_option', 'user_search_history', 'navigation_history'].includes(s.table ?? ''));
  if (withModuleIds.length > 0) warnings.push({ code: 'moduleIds', params: { sections: withModuleIds.map((s) => s.id).join(', ') } });
  if (manifest.userSchemaVersion < USER_SCHEMA_VERSION) warnings.push({ code: 'olderSchema', params: { from: manifest.userSchemaVersion, to: USER_SCHEMA_VERSION } });

  const plan: RestorePlan = {
    archive,
    source: { app: manifest.app, createdAt: manifest.createdAt, userSchemaVersion: manifest.userSchemaVersion },
    sections,
    unknownSections: archive.unknownSections.map((s) => ({ id: s.id, reason: 'unknown' })),
    extensions: [...exts.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    noteFiles,
    historyNoteFiles,
    warnings,
  };

  if (opts.preview !== false) {
    plan.preview = {
      replace: dryRun(plan, target, 'replace'),
      merge: dryRun(plan, target, 'merge'),
    };
  }
  return plan;
}

/** Section ids selected by default in a mode (present in this database). */
export function defaultSections(plan: RestorePlan, mode: RestoreMode): string[] {
  return plan.sections.filter((s) => s.defaultOn[mode]).map((s) => s.id);
}

function dryRun(plan: RestorePlan, target: RestoreTarget, mode: RestoreMode): RestoreReport {
  try {
    target.sql.transaction(() => {
      throw new DryRunRollback(runDatabase(plan, target, { mode, sections: defaultSections(plan, mode) }));
    });
  } catch (e) {
    if (e instanceof DryRunRollback) return e.report;
    return emptyReport(mode, false, [{ code: 'previewFailed', params: { message: e instanceof Error ? e.message : String(e) } }]);
  }
  return emptyReport(mode, false, []);
}

function emptyReport(mode: RestoreMode, ok: boolean, warnings: RestoreWarning[]): RestoreReport {
  return {
    mode, ok, perTable: [], droppedColumns: [], skippedSections: [], warnings,
    notes: { written: 0, identical: 0, conflictCopies: [], historyWritten: 0, skippedExisting: 0 },
    extDbs: [], fileErrors: [],
  };
}

// --- apply ----------------------------------------------------------------------------------

export interface RestoreOptions {
  mode: RestoreMode;
  /** Section ids to restore (see `defaultSections`). */
  sections: string[];
}

/**
 * Restore the selected sections. The database part is one transaction: on any
 * error nothing is changed and the error is thrown. After it commits, note files and
 * extension databases are written; failures there are collected in `fileErrors`
 * (and `ok` is false) because the database change cannot be undone by then.
 */
export async function applyRestore(plan: RestorePlan, target: RestoreTarget, opts: RestoreOptions): Promise<RestoreReport> {
  const known = new Set(plan.sections.map((s) => s.id));
  for (const id of opts.sections) if (!known.has(id)) throw new RangeError(`Unknown section: ${id}`);
  const report = target.sql.transaction(() => runDatabase(plan, target, opts));
  await applyFiles(plan, target, opts, report);
  report.ok = report.fileErrors.length === 0;
  return report;
}

interface Selected {
  tables: Map<string, ManifestSection>;
  kv: ManifestSection[];
  clear: Set<string>;
}

/** Turn selected section ids into the tables to fill and the tables to empty. */
function selection(plan: RestorePlan, target: RestoreTarget, opts: RestoreOptions, report: RestoreReport): Selected {
  const chosen = new Set(opts.sections);
  const tables = new Map<string, ManifestSection>();
  const kv: ManifestSection[] = [];
  for (const s of plan.archive.sections) {
    if (!chosen.has(s.id)) continue;
    if (s.kind === 'table') {
      const name = s.table as string;
      if (!tableExists(target.sql, name)) report.skippedSections.push({ id: s.id, reason: 'noTargetTable' });
      else tables.set(name, s);
    } else if (s.kind === 'extKv') {
      if (!tableExists(target.sql, 'extension_storage')) report.skippedSections.push({ id: s.id, reason: 'noTargetTable' });
      else kv.push(s);
    }
  }

  const clear = new Set<string>();
  if (opts.mode === 'replace') {
    for (const name of tables.keys()) clear.add(name);
    // Anything that points into a cleared table must be emptied too, or it would dangle.
    let grew = true;
    while (grew) {
      grew = false;
      for (const spec of orderedTables()) {
        if (clear.has(spec.name) || !tableExists(target.sql, spec.name)) continue;
        if (parentTables(spec).some((p) => clear.has(p))) {
          clear.add(spec.name);
          grew = true;
          if (!tables.has(spec.name)) {
            const inBackup = plan.archive.sections.find((s) => s.kind === 'table' && s.table === spec.name);
            report.warnings.push({ code: inBackup ? 'dependentPulledIn' : 'dependentEmptied', params: { table: spec.name } });
            if (inBackup) tables.set(spec.name, inBackup);
          }
        }
      }
    }
  }
  return { tables, kv, clear };
}

interface Ctx {
  sql: ISql;
  archive: BackupArchive;
  mode: RestoreMode;
  /** replace: ids present after the insert, per table. merge: backup id -> local id. */
  ids: Map<string, Map<unknown, unknown>>;
  /** replace: ids in tables that are not being cleared (checked lazily). */
  existing: Map<string, Set<unknown>>;
  cleared: Set<string>;
}

function lookupParent(ctx: Ctx, table: string, value: unknown): { found: boolean; mapped?: unknown } {
  if (ctx.ids.has(table) || ctx.cleared.has(table)) {
    const m = ctx.ids.get(table)?.get(value);
    return m === undefined ? { found: false } : { found: true, mapped: m };
  }
  if (ctx.mode === 'merge') return { found: false }; // parent not part of this restore: backup ids mean nothing here
  let set = ctx.existing.get(table);
  if (!set) {
    const spec = tableSpec(table);
    set = new Set();
    if (spec && tableExists(ctx.sql, table)) {
      for (const r of ctx.sql.queryAll<Row>(`SELECT ${q(spec.pk[0])} AS id FROM ${q(table)}`)) set.add(r.id);
    }
    ctx.existing.set(table, set);
  }
  return set.has(value) ? { found: true, mapped: value } : { found: false };
}

type RowVerdict = { row: Row; nulled: number } | { drop: 'danglingFk' | 'otherType' };

function remapRow(spec: TableSpec, row: Row, ctx: Ctx): RowVerdict {
  const out: Row = { ...row };
  let nulled = 0;
  for (const fk of spec.fks as FkSpec[]) {
    const value = out[fk.column];
    if (value === null || value === undefined) continue;
    let table: string | undefined;
    if ('table' in fk) table = fk.table;
    else {
      table = fk.targets[String(out[fk.typeColumn])];
      if (!table) {
        if (fk.otherTypes === 'drop') return { drop: 'otherType' };
        continue;
      }
    }
    const hit = lookupParent(ctx, table, value);
    if (hit.found) out[fk.column] = hit.mapped;
    else if (fk.onMissing === 'null') {
      out[fk.column] = null;
      nulled++;
    } else return { drop: 'danglingFk' };
  }
  return { row: out, nulled };
}

/** Rows of a self-referencing table, parents first; a cycle is broken by clearing that row's parent. */
function parentsFirst(spec: TableSpec, rows: Row[], report: TableReport): Row[] {
  const self = spec.fks.find((f): f is Extract<FkSpec, { table: string }> => 'table' in f && f.table === spec.name);
  if (!self) return rows;
  const pk = spec.pk[0];
  const byId = new Map<unknown, Row>(rows.map((r) => [r[pk], r]));
  const state = new Map<unknown, 1 | 2>();
  const out: Row[] = [];
  const visit = (r: Row): void => {
    const id = r[pk];
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) return;
    state.set(id, 1);
    const parentId = r[self.column];
    if (parentId !== null && parentId !== undefined) {
      const parent = byId.get(parentId);
      if (parent) {
        if (state.get(parentId) === 1) {
          r = { ...r, [self.column]: null };
          byId.set(id, r);
          report.dropped.cycle = (report.dropped.cycle ?? 0) + 1;
        } else visit(parent);
      }
    }
    state.set(id, 2);
    out.push(r);
  };
  for (const r of rows) visit(byId.get(r[pk]) as Row);
  return out;
}

function runDatabase(plan: RestorePlan, target: RestoreTarget, opts: RestoreOptions): RestoreReport {
  const sql = target.sql;
  const mode = opts.mode;
  const report = emptyReport(mode, true, [...plan.warnings]);
  const fromVersion = plan.archive.manifest.userSchemaVersion;
  const sel = selection(plan, target, opts, report);

  const chosen = new Set(opts.sections);
  const prefs = plan.archive.sections.find((s) => s.kind === 'prefs' && chosen.has(s.id));
  if (prefs) {
    const data = plan.archive.entries.get(prefs.paths[0]);
    try {
      report.preferences = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
    } catch {
      throw new DamagedError('The preferences in the backup are malformed');
    }
  }

  if (sel.tables.size === 0 && sel.kv.length === 0) return report;
  if (mode === 'replace') sql.execute('PRAGMA defer_foreign_keys = ON');

  const ctx: Ctx = { sql, archive: plan.archive, mode, ids: new Map(), existing: new Map(), cleared: sel.clear };
  const reports = new Map<string, TableReport>();
  const reportFor = (table: string): TableReport => {
    let r = reports.get(table);
    if (!r) {
      r = { table, cleared: 0, inserted: 0, matched: 0, updated: 0, dropped: {}, nulled: 0 };
      reports.set(table, r);
      report.perTable.push(r);
    }
    return r;
  };

  // 1. replace: empty everything that is being replaced, children first.
  if (mode === 'replace') {
    for (const spec of [...orderedTables()].reverse()) {
      if (!sel.clear.has(spec.name)) continue;
      const r = reportFor(spec.name);
      r.cleared = sql.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${q(spec.name)}`)?.n ?? 0;
      sql.execute(`DELETE FROM ${q(spec.name)}`);
    }
    // Extension key-value data is replaced per extension, so other extensions are untouched.
    for (const s of sel.kv) {
      const r = reportFor('extension_storage');
      const del = sql.execute('DELETE FROM extension_storage WHERE extension_id = ?', [s.ext as string]);
      r.cleared += del.changes;
    }
  }

  // 2. fill, parents first.
  const work: Array<{ spec: TableSpec; sections: ManifestSection[] }> = [];
  for (const spec of orderedTables()) {
    if (spec.name === 'extension_storage') continue;
    const s = sel.tables.get(spec.name);
    if (s) work.push({ spec, sections: [s] });
  }
  if (sel.kv.length > 0) work.push({ spec: tableSpec('extension_storage') as TableSpec, sections: sel.kv });

  for (const { spec, sections } of work) {
    for (const section of sections) {
      fillSection(spec, section, ctx, reportFor(spec.name), report, fromVersion);
    }
  }

  // 3. derived data and integrity.
  if (sel.tables.has('user_note') && tableExists(sql, 'user_note_fts')) {
    sql.execute("INSERT INTO user_note_fts(user_note_fts) VALUES('rebuild')");
  }
  for (const r of report.perTable) {
    if (r.inserted === 0 && r.updated === 0) continue;
    const bad = sql.queryAll<Row>(`PRAGMA foreign_key_check(${q(r.table)})`);
    if (bad.length > 0) throw new RestoreError(`The restored data left ${bad.length} broken reference(s) in ${r.table}`, { table: r.table });
  }
  const logical = checkRegistryIntegrity(sql, report.perTable.filter((r) => r.inserted > 0 || r.updated > 0).map((r) => r.table));
  if (logical.length > 0) throw new RestoreError(`The restored data left broken references: ${logical[0]}`, { table: logical[0].split('.')[0] });
  return report;
}

function fillSection(spec: TableSpec, section: ManifestSection, ctx: Ctx, tr: TableReport, report: RestoreReport, fromVersion: number): void {
  const sql = ctx.sql;
  const rowsRaw = sectionRows(ctx.archive, section);
  const live = liveColumns(sql, spec.name);
  const known = new Set(spec.columns);
  const backupCols = section.columns ?? [];
  const insertCols = spec.columns.filter((c) => backupCols.includes(c) && live.includes(c) && known.has(c));
  for (const c of backupCols) {
    if (!insertCols.includes(c)) {
      const d = report.droppedColumns.find((x) => x.table === spec.name && x.column === c);
      if (d) d.rows += rowsRaw.length;
      else report.droppedColumns.push({ table: spec.name, column: c, rows: rowsRaw.length });
    }
  }

  // Upgrade, then project to the columns that will be written.
  let rows: Row[] = rowsRaw.map((raw) => {
    const up = upgradeRow(spec, raw, fromVersion);
    const r: Row = {};
    for (const c of insertCols) r[c] = up[c] === undefined ? null : up[c];
    return r;
  });

  // extension key-value sections must only carry their own extension's rows
  if (spec.name === 'extension_storage') {
    const before = rows.length;
    rows = rows.filter((r) => r.extension_id === section.ext);
    if (rows.length !== before) tr.dropped.extMismatch = (tr.dropped.extMismatch ?? 0) + (before - rows.length);
  }

  rows = parentsFirst(spec, rows, tr);

  const pk = spec.pk;
  const idMap = ctx.ids.get(spec.name) ?? new Map<unknown, unknown>();
  ctx.ids.set(spec.name, idMap);

  if (ctx.mode === 'replace') {
    rows.forEach((row, i) => {
      const verdict = remapRow(spec, row, ctx);
      if ('drop' in verdict) {
        tr.dropped[verdict.drop] = (tr.dropped[verdict.drop] ?? 0) + 1;
        return;
      }
      tr.nulled += verdict.nulled;
      insertRow(sql, spec.name, insertCols, verdict.row, section.id, i);
      if (spec.autoId) idMap.set(row[pk[0]], row[pk[0]]);
      tr.inserted++;
    });
    return;
  }

  mergeRows(spec, section, rows, insertCols, ctx, tr, idMap);
}

function insertRow(sql: ISql, table: string, cols: string[], row: Row, sectionId: string, index: number): { id: number } {
  try {
    const res = sql.execute(
      `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => row[c] as SqlParameter)
    );
    return { id: res.lastInsertRowId ?? 0 };
  } catch (cause) {
    throw new RestoreError(`Could not restore row ${index + 1} of ${table}: ${cause instanceof Error ? cause.message : String(cause)}`, { table, sectionId, row: index, cause });
  }
}

function mergeRows(spec: TableSpec, section: ManifestSection, rows: Row[], insertCols: string[], ctx: Ctx, tr: TableReport, idMap: Map<unknown, unknown>): void {
  const sql = ctx.sql;
  if (spec.mergeKeepsLocal) {
    tr.dropped.keptLocal = (tr.dropped.keptLocal ?? 0) + rows.length;
    return;
  }
  const pk = spec.pk;
  const writeCols = spec.autoId ? insertCols.filter((c) => c !== pk[0]) : insertCols;
  const identity = spec.identity;
  const keyCols = identity.kind === 'content'
    ? writeCols.filter((c) => !identity.exclude.includes(c))
    : identity.columns.filter((c) => insertCols.includes(c));

  // Existing local rows, indexed by identity key (in primary-key order, for pairing).
  const selectCols = [...new Set([...pk, ...keyCols, ...(identity.kind === 'unique' ? [identity.stamp, ...(identity.maxColumns ?? [])].filter((c): c is string => !!c && insertCols.includes(c)) : [])])];
  const local = new Map<string, Row[]>();
  for (const r of sql.queryAll<Row>(`SELECT ${selectCols.map(q).join(', ')} FROM ${q(spec.name)} ORDER BY ${pk.map(q).join(', ')}`)) {
    const k = keyOf(keyCols, r);
    const list = local.get(k);
    if (list) list.push(r);
    else local.set(k, [r]);
  }
  const used = new Map<string, number>();
  let haveDefault = false;
  if (spec.defaultFlag && insertCols.includes(spec.defaultFlag)) {
    haveDefault = sql.queryOne(`SELECT 1 AS x FROM ${q(spec.name)} WHERE ${q(spec.defaultFlag)} = 1 LIMIT 1`) !== undefined;
  }

  rows.forEach((raw, i) => {
    if (spec.skipInMerge?.(raw)) {
      tr.dropped.skipped = (tr.dropped.skipped ?? 0) + 1;
      return;
    }
    const verdict = remapRow(spec, raw, ctx);
    if ('drop' in verdict) {
      tr.dropped[verdict.drop] = (tr.dropped[verdict.drop] ?? 0) + 1;
      return;
    }
    tr.nulled += verdict.nulled;
    const row = verdict.row;
    const key = keyOf(keyCols, row);
    const pool = local.get(key);
    const backupId = raw[pk[0]];

    if (identity.kind === 'content') {
      const n = used.get(key) ?? 0;
      if (pool && n < pool.length) {
        used.set(key, n + 1);
        if (spec.autoId) idMap.set(backupId, pool[n][pk[0]]);
        tr.matched++;
        return;
      }
      used.set(key, n + 1);
    } else if (pool && pool.length > 0) {
      const existing = pool[0];
      if (spec.autoId) idMap.set(backupId, existing[pk[0]]);
      tr.matched++;
      const changes = uniqueUpdate(identity, insertCols, existing, row, pk);
      if (Object.keys(changes).length > 0) {
        const cols = Object.keys(changes);
        sql.execute(
          `UPDATE ${q(spec.name)} SET ${cols.map((c) => `${q(c)} = ?`).join(', ')} WHERE ${pk.map((c) => `${q(c)} = ?`).join(' AND ')}`,
          [...cols.map((c) => changes[c] as SqlParameter), ...pk.map((c) => existing[c] as SqlParameter)]
        );
        tr.updated++;
        for (const c of cols) existing[c] = changes[c];
      }
      return;
    }

    if (spec.defaultFlag && row[spec.defaultFlag] === 1) {
      if (haveDefault) row[spec.defaultFlag] = 0;
      else haveDefault = true;
    }
    const { id } = insertRow(sql, spec.name, writeCols, row, section.id, i);
    if (spec.autoId) idMap.set(backupId, id);
    tr.inserted++;
    // A later backup row with the same unique key (which the source database would not allow) maps to this one.
    if (identity.kind === 'unique') {
      const fresh: Row = { ...row };
      if (spec.autoId) fresh[pk[0]] = id;
      local.set(key, [fresh]);
    }
  });
}

function uniqueUpdate(identity: Extract<TableSpec['identity'], { kind: 'unique' }>, insertCols: string[], existing: Row, incoming: Row, pk: string[]): Row {
  const changes: Row = {};
  if (identity.conflict === 'newerWins' && identity.stamp) {
    const theirs = stampMs(incoming[identity.stamp]);
    const mine = stampMs(existing[identity.stamp]);
    if (Number.isFinite(theirs) && Number.isFinite(mine) && theirs > mine) {
      for (const c of insertCols) if (!pk.includes(c) && !identity.columns.includes(c)) changes[c] = incoming[c];
      if (identity.stamp) changes[identity.stamp] = incoming[identity.stamp];
    }
  } else if (identity.conflict === 'max') {
    for (const c of identity.maxColumns ?? []) {
      const a = Number(incoming[c]);
      const b = Number(existing[c]);
      if (Number.isFinite(a) && (!Number.isFinite(b) || a > b)) changes[c] = incoming[c];
    }
  }
  return changes;
}

// --- integrity (also used by tests) -----------------------------------------------------------

/**
 * Check the logical foreign keys the registry knows about, including the ones SQLite
 * has no constraint for. Returns a description of each violated relation (empty when
 * consistent). `tables` limits the check to the child tables given.
 */
export function checkRegistryIntegrity(sql: ISql, tables?: string[]): string[] {
  const bad: string[] = [];
  const only = tables ? new Set(tables) : undefined;
  for (const spec of orderedTables()) {
    if (only && !only.has(spec.name)) continue;
    if (!tableExists(sql, spec.name)) continue;
    for (const fk of spec.fks) {
      const pairs: Array<{ table: string; where: string; params: SqlParameter[] }> = [];
      if ('table' in fk) pairs.push({ table: fk.table, where: '', params: [] });
      else for (const [type, table] of Object.entries(fk.targets)) pairs.push({ table, where: ` AND ${q(fk.typeColumn)} = ?`, params: [type] });
      for (const p of pairs) {
        if (!tableExists(sql, p.table)) continue;
        const parent = tableSpec(p.table);
        if (!parent) continue;
        const n = sql.queryOne<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${q(spec.name)} WHERE ${q(fk.column)} IS NOT NULL${p.where} AND ${q(fk.column)} NOT IN (SELECT ${q(parent.pk[0])} FROM ${q(p.table)})`,
          p.params
        )?.n ?? 0;
        if (n > 0) bad.push(`${spec.name}.${fk.column} -> ${p.table} (${n} row(s))`);
      }
    }
  }
  return bad;
}

// --- files -------------------------------------------------------------------------------------

async function applyFiles(plan: RestorePlan, target: RestoreTarget, opts: RestoreOptions, report: RestoreReport): Promise<void> {
  const chosen = new Set(opts.sections);
  const now = (target.now ?? (() => new Date()))();
  const archive = plan.archive;

  for (const section of archive.sections.filter((s) => s.kind === 'files' && chosen.has(s.id))) {
    if (!target.notes) {
      report.skippedSections.push({ id: section.id, reason: 'noNotesStore' });
      continue;
    }
    const prefix = section.id === 'notes' ? 'notes/' : 'notes-history/';
    const suffix = section.id === 'notes' ? '.bn' : '.bak';
    const sink = target.notes;
    try {
      let existing = new Set(await sink.list());
      if (opts.mode === 'replace' && section.id === 'notes' && existing.size > 0) {
        report.notes.movedAsideTo = await sink.moveAside(dateLabel(now));
        existing = new Set();
      }
      for (const path of section.paths) {
        const rel = path.slice(prefix.length);
        if (!path.startsWith(prefix) || !rel.endsWith(suffix) || checkEntryName(rel)) {
          report.fileErrors.push({ path, message: 'unsafe path' });
          continue;
        }
        const data = archive.entries.get(path) as Uint8Array;
        try {
          if (section.id === 'notes.history') {
            if (opts.mode === 'merge' && existing.has(rel)) report.notes.skippedExisting++;
            else {
              await sink.write(rel, data);
              existing.add(rel);
              report.notes.historyWritten++;
            }
            continue;
          }
          if (!existing.has(rel)) {
            await sink.write(rel, data);
            existing.add(rel);
            report.notes.written++;
            continue;
          }
          const current = await sink.read(rel);
          if (current && sameBytes(current, data)) {
            report.notes.identical++;
            continue;
          }
          // In replace the old files were moved aside, so this is merge: keep both.
          const copy = await conflictCopy(sink, rel, data, existing, now);
          report.notes.conflictCopies.push({ original: rel, copy });
        } catch (e) {
          report.fileErrors.push({ path: rel, message: e instanceof Error ? e.message : String(e) });
        }
      }
    } catch (e) {
      report.fileErrors.push({ path: section.id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  for (const section of archive.sections.filter((s) => s.kind === 'extDb' && chosen.has(s.id))) {
    if (!target.extensions) {
      report.skippedSections.push({ id: section.id, reason: 'noExtensionStore' });
      continue;
    }
    const id = section.ext as string;
    const name = section.db as string;
    if (!EXTENSION_ID_PATTERN.test(id) || !EXTENSION_DB_NAME_PATTERN.test(name)) continue;
    try {
      if (opts.mode === 'merge' && (await target.extensions.dbExists(id, name))) {
        report.extDbs.push({ id, name, action: 'keptLocal' });
        continue;
      }
      await target.extensions.writeDb(id, name, archive.entries.get(section.paths[0]) as Uint8Array);
      report.extDbs.push({ id, name, action: 'written' });
    } catch (e) {
      report.fileErrors.push({ path: `${id}/${name}`, message: e instanceof Error ? e.message : String(e) });
    }
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Keep both versions of a note that exists locally and differs: write the backup's
 * as `<name> (restored YYYY-MM-DD).bn` (numbered when that name is taken). If a
 * copy with the same content is already there from an earlier merge, reuse it, so
 * merging the same backup twice adds nothing.
 */
async function conflictCopy(sink: FileSink, rel: string, data: Uint8Array, existing: Set<string>, now: Date): Promise<string> {
  const dot = rel.lastIndexOf('.');
  const stem = rel.slice(0, dot);
  const ext = rel.slice(dot);
  const pattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(restored \\d{4}-\\d{2}-\\d{2}( \\d+)?\\)${ext.replace('.', '\\.')}$`);
  for (const other of existing) {
    if (!pattern.test(other)) continue;
    const bytes = await sink.read(other);
    if (bytes && sameBytes(bytes, data)) return other;
  }
  const base = `${stem} (restored ${dateLabel(now)})`;
  let candidate = `${base}${ext}`;
  for (let n = 2; existing.has(candidate); n++) candidate = `${base} ${n}${ext}`;
  await sink.write(candidate, data);
  existing.add(candidate);
  return candidate;
}
