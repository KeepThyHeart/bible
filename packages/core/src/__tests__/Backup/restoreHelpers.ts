import * as path from 'path';
import { loadSchemaSql } from '../../Data/Schema';
import type { ISql } from '../../Data/Core/ISql';
import { TestSqliteProvider } from '../helpers/TestSqliteProvider';
import { createBackupPayload, readBackupPayload } from '../../Backup/Payload';
import type { BackupSources, BackupArchive, WriteOptions } from '../../Backup/Payload';
import { USER_TABLES, tableSpec } from '../../Backup/Registry';
import type { Row } from '../../Backup/Registry';
import { once } from '../../Backup/Streams';
import type { FileSink } from '../../Backup/Restore';

export function newUserDb(withExtensionStorage = true): TestSqliteProvider {
  const db = new TestSqliteProvider(':memory:');
  const schema = loadSchemaSql(path.resolve(__dirname, '../../../sql/schemas/initial/UserDatabase.sql'))
    .split('\n').map((l) => (/^\s*PRAGMA\s/i.test(l) ? `-- ${l}` : l)).join('\n');
  db.exec(schema);
  if (withExtensionStorage) {
    db.exec('CREATE TABLE extension_storage (extension_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (extension_id, key));');
    db.exec('CREATE TABLE user_keybindings (command_id TEXT NOT NULL, key TEXT NOT NULL, mac TEXT, when_clause TEXT, PRIMARY KEY (command_id, key));');
    db.exec('CREATE TABLE command_history (command_id TEXT PRIMARY KEY, last_used INTEGER NOT NULL, use_count INTEGER NOT NULL DEFAULT 0);');
  }
  return db;
}

export const APP = { name: 'Keep Thy Heart', version: '0.1.0', platform: 'test' };
export const wopts = (includeHistory = true): WriteOptions => ({ includeHistory, app: APP, now: () => new Date('2026-09-26T14:03:11Z') });

export async function archiveOf(src: BackupSources, includeHistory = true): Promise<BackupArchive> {
  const { zip } = await createBackupPayload(src, wopts(includeHistory));
  return readBackupPayload(once(zip));
}

/** Every row of every registry table that exists, ordered by primary key. */
export function snapshot(db: ISql): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const spec of USER_TABLES) {
    const exists = db.queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [spec.name]);
    if (!exists) continue;
    out[spec.name] = db.queryAll<Row>(`SELECT * FROM "${spec.name}" ORDER BY ${spec.pk.map((k) => `"${k}"`).join(', ')}`);
  }
  return out;
}

/**
 * An id-independent rendering of a database: each row becomes the JSON of its
 * non-key columns with every foreign key replaced by the rendering of the row it
 * points at. Two databases holding the same data under different ids render equally.
 */
export function canon(db: ISql): Record<string, string[]> {
  const snap = snapshot(db);
  const memo = new Map<string, string>();
  const byPk = (table: string, id: unknown): Row | undefined => {
    const spec = tableSpec(table);
    return snap[table]?.find((r) => r[spec!.pk[0]] === id);
  };
  const render = (table: string, row: Row, depth = 0): string => {
    const spec = tableSpec(table)!;
    const key = `${table}:${row[spec.pk[0]]}`;
    if (memo.has(key)) return memo.get(key)!;
    if (depth > 20) return '<deep>';
    const o: Record<string, unknown> = {};
    for (const c of spec.columns) {
      if (spec.autoId && spec.pk.includes(c)) continue;
      o[c] = row[c];
    }
    for (const fk of spec.fks) {
      const v = row[fk.column];
      if (v === null || v === undefined) continue;
      const target = 'table' in fk ? fk.table : fk.targets[String(row[fk.typeColumn])];
      if (!target) continue;
      const parent = byPk(target, v);
      o[fk.column] = parent ? render(target, parent, depth + 1) : `<missing ${target}:${v}>`;
    }
    const s = JSON.stringify(o);
    memo.set(key, s);
    return s;
  };
  const out: Record<string, string[]> = {};
  for (const [table, rows] of Object.entries(snap)) out[table] = rows.map((r) => render(table, r)).sort();
  return out;
}

/** A FileSink over a Map, with move-aside. */
export class MemorySink implements FileSink {
  moved: Array<{ label: string; files: Map<string, Uint8Array> }> = [];
  constructor(public files: Map<string, Uint8Array> = new Map()) {}
  static of(obj: Record<string, string>): MemorySink {
    return new MemorySink(new Map(Object.entries(obj).map(([k, v]) => [k, new TextEncoder().encode(v)])));
  }
  async list() { return [...this.files.keys()]; }
  async read(p: string) { return this.files.get(p); }
  async write(p: string, d: Uint8Array) { this.files.set(p, d); }
  async moveAside(label: string) {
    if (this.files.size === 0) return undefined;
    this.moved.push({ label, files: this.files });
    this.files = new Map();
    return `before-restore-${label}`;
  }
  text(p: string) { const d = this.files.get(p); return d ? new TextDecoder().decode(d) : undefined; }
}
