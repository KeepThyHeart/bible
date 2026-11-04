/**
 * The generic, registry-driven codec: one `TableSpec` in, one `RecordCodec` out. See `RecordCodec.ts` for the
 * payload shape, scope strings and unknown-module behaviour. Every SQL identifier comes from the registry spec
 * (never from a record), so a hostile record cannot name a column, and `upsert` refuses any column the spec
 * does not list.
 */
import type { FkSpec, Row, TableSpec } from '../../Backup/Registry';
import { tableSpec } from '../../Backup/Registry';
import type { ISql, SqlParameter } from '../../Data/Core/ISql';
import type { CodecContext, DecodeResult, RecordCodec } from './RecordCodec';
import { RecordDecodeError } from './errors';

const US = '\u001f';
const RECORD_ID = /^[0-9a-f]{32}$/;

/** Columns that are deliberately not synced, with the reason. Keyed by table, then column. */
export const LOCAL_ONLY_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  user_commentary: {
    is_default: 'Each device chooses its own default commentary; syncing the flag would let two devices fight over it. '
      + 'Decoded rows never set it (the DDL default 0 applies), so a synced commentary can never become a second default.',
  },
};

/** Local module install id columns, translated through `ctx.modules`. (memory_passage.module_id is already portable.) */
export const MODULE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  user_text_markup: ['module_id'],
  pinned_item: ['module_id'],
};

/** Natural-key record ids (see the scope table in RecordCodec.ts). Parts are decoded-payload values, FKs are record ids. */
const NATURAL_KEYS: Readonly<Record<string, readonly string[]>> = {
  user_reading_progress: ['plan_id', 'start_date'],
  user_data_item: ['owner_uuid', 'collection', 'item_key'],
  memory_setting: ['key'],
  memory_resume_state: ['card_id'],
  memory_recite_detail: ['attempt_id'],
  memory_passage: ['collection_id', 'module_id', 'start_verse_id', 'end_verse_id'],
  memory_card: ['passage_id', 'rung'],
  reading_plan_day: ['plan_id', 'day_number'],
};

/** Tables whose DDL has a real UNIQUE constraint on these columns: an incoming row that collides is adopted, not duplicated. */
const ADOPT_BY: Readonly<Record<string, readonly string[]>> = {
  user_data_item: ['owner_uuid', 'collection', 'item_key'],
  memory_passage: ['collection_id', 'module_id', 'start_verse_id', 'end_verse_id'],
  memory_card: ['passage_id', 'rung'],
  reading_plan_day: ['plan_id', 'day_number'],
};

export type ColumnRole = 'localId' | 'data' | 'fk' | 'module' | 'localOnly';

export interface ColumnPlan {
  name: string;
  role: ColumnRole;
  fk?: FkSpec;
  /** Why a column is `localId` / `localOnly`. */
  reason?: string;
}

/** How each registry column of a table is handled (used by the codec and by the registry-coverage test). */
export function columnPlan(spec: TableSpec): ColumnPlan[] {
  const localOnly = LOCAL_ONLY_COLUMNS[spec.name] ?? {};
  const modules = MODULE_COLUMNS[spec.name] ?? [];
  return spec.columns.map((name): ColumnPlan => {
    if (name in localOnly) return { name, role: 'localOnly', reason: localOnly[name] };
    const fk = spec.fks.find((f) => f.column === name);
    if (fk) return { name, role: 'fk', fk };
    if (spec.autoId && spec.pk.length === 1 && spec.pk[0] === name) {
      return { name, role: 'localId', reason: 'Autoincrement local id; the record id replaces it.' };
    }
    if (modules.includes(name)) return { name, role: 'module' };
    return { name, role: 'data' };
  });
}

const q = (ident: string): string => `"${ident.replace(/"/g, '""')}"`;

function scalar(v: unknown, where: string): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new Error(`${where}: unsupported column value type`);
}

/** Decode-side validation: strings, finite numbers, null (and booleans as 0/1). Anything else is hostile or corrupt. */
function wireScalar(v: unknown, where: string): string | number | null {
  if (v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new RecordDecodeError(`${where}: unsupported value type`);
}

function localValue(key: string): string | number {
  return /^-?\d{1,15}$/.test(key) ? Number(key) : key;
}

function pkWhere(spec: TableSpec): string {
  return spec.pk.map((c) => `${q(c)} = ?`).join(' AND ');
}

function splitKey(spec: TableSpec, localKey: string): string[] | null {
  const parts = spec.pk.length === 1 ? [localKey] : localKey.split(US);
  return parts.length === spec.pk.length ? parts : null;
}

/** Columns that exist in the live table (an older database may lack optional columns such as user_note.sort_order). */
function liveColumns(sql: ISql, table: string): Set<string> {
  return new Set(sql.queryAll<{ name: string }>(`PRAGMA table_info(${q(table)})`).map((r) => r.name));
}

/** Resolve which parent table an FK points at for this row/payload. undefined = pass the raw value through; null = drop the row. */
function fkTarget(fk: FkSpec, typeValue: unknown): string | undefined | null {
  if ('table' in fk) return fk.table;
  const target = typeof typeValue === 'string' && Object.prototype.hasOwnProperty.call(fk.targets, typeValue)
    ? fk.targets[typeValue]
    : undefined;
  if (target !== undefined) return target;
  return fk.otherTypes === 'passThrough' ? undefined : null;
}

export function createTableCodec(spec: TableSpec): RecordCodec {
  const plan = columnPlan(spec);
  const byName = new Map(plan.map((p) => [p.name, p]));
  const where = pkWhere(spec);
  const natural = NATURAL_KEYS[spec.name];
  const adoptBy = ADOPT_BY[spec.name];

  function encode(localKey: string, ctx: CodecContext): Record<string, unknown> | null {
    const parts = splitKey(spec, localKey);
    if (!parts) return null;
    const row = ctx.sql.queryOne<Row>(`SELECT * FROM ${q(spec.name)} WHERE ${where}`, parts);
    if (!row) return null;
    if (spec.skipInMerge?.(row)) return null;
    const d: Record<string, unknown> = {};
    for (const col of plan) {
      if (col.role === 'localId' || col.role === 'localOnly' || !(col.name in row)) continue;
      const v = scalar(row[col.name], `${spec.name}.${col.name}`);
      if (col.role === 'data') {
        d[col.name] = v;
      } else if (col.role === 'module') {
        if (v === null) { d[col.name] = null; continue; }
        const portable = ctx.modules.toPortable(v);
        if (portable === null) {
          d[col.name] = `local:${v}`;
          ctx.report?.({ kind: spec.name, localKey, code: 'unknownModule', column: col.name, value: v });
        } else {
          d[col.name] = portable;
        }
      } else {
        const fk = col.fk!;
        if (v === null) { d[col.name] = null; continue; }
        const target = fkTarget(fk, 'typeColumn' in fk ? row[fk.typeColumn] : undefined);
        if (target === null) return null;                 // unsupported polymorphic type: does not sync
        if (target === undefined) { d[col.name] = v; continue; }
        const parentSpec = tableSpec(target);
        const exists = parentSpec !== undefined && parentSpec.pk.length === 1
          && ctx.sql.queryOne(`SELECT 1 AS x FROM ${q(target)} WHERE ${q(parentSpec.pk[0])} = ?`, [v]) !== undefined;
        if (!exists) {
          if (fk.onMissing === 'null') { d[col.name] = null; continue; }
          return null;                                    // dangling parent: the row cannot be restored anywhere
        }
        d[col.name] = ctx.recordIdFor(target, String(v));
      }
    }
    return d;
  }

  function decode(d: Record<string, unknown>, ctx: CodecContext): DecodeResult {
    const row: Row = {};
    const missing: string[] = [];
    const unknownModules: string[] = [];
    for (const col of plan) {
      if (col.role === 'localId' || col.role === 'localOnly' || !Object.prototype.hasOwnProperty.call(d, col.name)) continue;
      const where_ = `${spec.name}.${col.name}`;
      const raw = d[col.name];
      if (col.role === 'data') {
        row[col.name] = wireScalar(raw, where_);
      } else if (col.role === 'module') {
        const v = wireScalar(raw, where_);
        if (v === null) { row[col.name] = null; continue; }
        const local = ctx.modules.toLocal(String(v));
        if (local === null) { if (!unknownModules.includes(String(v))) unknownModules.push(String(v)); } else row[col.name] = local;
      } else {
        const fk = col.fk!;
        const v = wireScalar(raw, where_);
        if (v === null) { row[col.name] = null; continue; }
        const target = fkTarget(fk, 'typeColumn' in fk ? d[fk.typeColumn] : undefined);
        if (target === null) throw new RecordDecodeError(`${where_}: unsupported reference type`);
        if (target === undefined) { row[col.name] = v; continue; }
        if (typeof v !== 'string' || !RECORD_ID.test(v)) throw new RecordDecodeError(`${where_}: not a record id`);
        const key = ctx.localKeyFor(v, target);              // throws RecordDecodeError for a record of another kind
        if (key === undefined) { if (!missing.includes(v)) missing.push(v); } else row[col.name] = localValue(key);
      }
    }
    if (missing.length > 0 || unknownModules.length > 0) {
      return unknownModules.length > 0 ? { ok: false, missing, unknownModules } : { ok: false, missing };
    }
    return { ok: true, row };
  }

  /** Keep only registry columns that may be written, and only those the live table has. Refuses anything else. */
  function writable(row: Row, ctx: CodecContext, allowLocalId: boolean): string[] {
    const live = liveColumns(ctx.sql, spec.name);
    const cols: string[] = [];
    for (const name of Object.keys(row)) {
      const p = byName.get(name);
      if (!p || p.role === 'localOnly' || (p.role === 'localId' && !allowLocalId)) {
        throw new Error(`${spec.name}: column is not writable by sync`);
      }
      if (live.has(name)) cols.push(name);
    }
    return cols;
  }

  const keyOf = (row: Row, fallback: string[], inserted: number): string => {
    if (spec.autoId) return String(inserted);
    return spec.pk.map((c, i) => String(row[c] ?? fallback[i])).join(US);
  };

  function upsert(row: Row, localKey: string | undefined, ctx: CodecContext): string {
    const sql = ctx.sql;
    const cols = writable(row, ctx, false);
    const params = (names: string[]): SqlParameter[] => names.map((c) => row[c] as SqlParameter);
    const keyParts = localKey === undefined ? undefined : splitKey(spec, localKey);
    if (localKey !== undefined && !keyParts) throw new Error(`${spec.name}: bad local key`);

    if (keyParts) {
      if (cols.length > 0) {
        const r = sql.execute(
          `UPDATE ${q(spec.name)} SET ${cols.map((c) => `${q(c)} = ?`).join(', ')} WHERE ${where}`,
          [...params(cols), ...keyParts]);
        if (r.changes > 0) return keyOf(row, keyParts, Number(localKey));
      } else if (sql.queryOne(`SELECT 1 AS x FROM ${q(spec.name)} WHERE ${where}`, keyParts)) {
        return localKey!;
      }
    }

    if (adoptBy && adoptBy.every((c) => c in row)) {
      const found = sql.queryOne<Row>(
        `SELECT ${spec.pk.map(q).join(', ')} FROM ${q(spec.name)} WHERE ${adoptBy.map((c) => `${q(c)} IS ?`).join(' AND ')}`,
        params([...adoptBy]));
      if (found) {
        const foundParts = spec.pk.map((c) => String(found[c]));
        if (cols.length > 0) {
          sql.execute(`UPDATE ${q(spec.name)} SET ${cols.map((c) => `${q(c)} = ?`).join(', ')} WHERE ${where}`,
            [...params(cols), ...foundParts]);
        }
        return foundParts.join(US);
      }
    }

    // Insert. An update that matched nothing (row deleted locally) re-creates the row under its old local key.
    const insertCols = [...cols];
    const insertParams = params(cols);
    if (spec.autoId && keyParts) { insertCols.push(spec.pk[0]); insertParams.push(localValue(keyParts[0]) as SqlParameter); }
    if (insertCols.length === 0) throw new Error(`${spec.name}: nothing to insert`);
    let statement = `INSERT INTO ${q(spec.name)} (${insertCols.map(q).join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`;
    if (!spec.autoId) {
      const rest = insertCols.filter((c) => !spec.pk.includes(c));
      statement += ` ON CONFLICT (${spec.pk.map(q).join(', ')}) DO ` +
        (rest.length > 0 ? `UPDATE SET ${rest.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}` : 'NOTHING');
    }
    const r = sql.execute(statement, insertParams);
    return keyOf(row, keyParts ?? [], spec.autoId && keyParts ? Number(keyParts[0]) : Number(r.lastInsertRowId));
  }

  function remove(localKey: string, ctx: CodecContext): void {
    const parts = splitKey(spec, localKey);
    if (parts) ctx.sql.execute(`DELETE FROM ${q(spec.name)} WHERE ${where}`, parts);
  }

  const codec: RecordCodec = { type: spec.name, kind: spec.name, version: 1, encode, decode, upsert, remove };
  if (natural) {
    codec.naturalKey = (d) => {
      const parts: string[] = [];
      for (const c of natural) {
        const v = d[c];
        if (typeof v === 'string') parts.push(v);
        else if (typeof v === 'number' && Number.isFinite(v)) parts.push(String(v));
        else if (v === null || v === undefined) {
          if (c === 'owner_uuid') parts.push(''); else return null;
        } else return null;
      }
      return { scope: spec.name, key: parts.join(US) };
    };
  }
  return codec;
}
