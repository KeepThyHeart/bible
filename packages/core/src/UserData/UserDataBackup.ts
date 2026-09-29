/**
 * Backup format v1 for a {@link MemoryUserDb}: export to `.zip` / `.bbk` and import from either.
 *
 * Export reuses the real payload writer (`createBackupPayload`) over a read-only
 * `ISql` view of the in-memory tables, so a web export is byte-for-byte the same
 * layout a desktop backup has (`user/user_data_item.ndjson`, `user/verse_link.ndjson`,
 * a manifest with hashes) and the desktop restore planner can read it.
 *
 * Import is deliberately narrower than the desktop restore: the web store holds
 * only `user_data_item` and the `verse_link` rows that hang off those items.
 * Every other section in a backup (notes, collections, ...) is reported in
 * {@link UserDataImportReport.ignoredSections} and left untouched, never
 * silently dropped and never applied to a table the web does not have.
 */
import type { ISql, SqlParameter } from '../Data/Core/ISql';
import { readBackupFile } from '../Backup/BackupFile';
import { sealStream } from '../Backup/Envelope';
import type { OpenOptions, SealOptions } from '../Backup/Envelope';
import { createBackupPayload, sectionRows } from '../Backup/Payload';
import type { AppInfo, BackupPayload } from '../Backup/Payload';
import { USER_SCHEMA_VERSION, tableSpec } from '../Backup/Registry';
import type { Row } from '../Backup/Registry';
import { stampMs } from '../Backup/Restore';
import { chunked, collect } from '../Backup/Streams';
import type { MemoryUserDb, UserDataItemRow, VerseLinkRow } from './MemoryUserDb';

/** Just enough of `ISql` for `createBackupPayload`: table discovery, column lists and `SELECT cols FROM table`. */
class SnapshotSql implements ISql {
  constructor(private readonly tables: Record<string, Row[]>) {}

  queryOne<T>(sql: string, params: SqlParameter[] | Record<string, SqlParameter> = []): T | undefined {
    return this.queryAll<T>(sql, params)[0];
  }

  queryAll<T>(sql: string, params: SqlParameter[] | Record<string, SqlParameter> = []): T[] {
    if (sql.includes('sqlite_master')) {
      const name = (params as SqlParameter[])[0] as string;
      return (name in this.tables ? [{ name }] : []) as T[];
    }
    const pragma = /^PRAGMA table_info\("(\w+)"\)$/.exec(sql);
    if (pragma) return this.columnsOf(pragma[1]).map((name) => ({ name })) as T[];
    const select = /^SELECT (.+) FROM "(\w+)"/.exec(sql);
    if (select && select[2] in this.tables) {
      const cols = select[1].split(',').map((c) => c.trim().replace(/"/g, ''));
      return this.tables[select[2]].map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) as T[];
    }
    throw new Error(`SnapshotSql does not support: ${sql}`);
  }

  private columnsOf(table: string): string[] {
    return tableSpec(table)?.columns ?? [];
  }

  execute(): never {
    throw new Error('SnapshotSql is read-only');
  }
  transaction<T>(cb: () => T): T {
    return cb();
  }
  close(): void {}
  isOpen(): boolean {
    return true;
  }
  getDatabasePath(): string {
    return ':memory:';
  }
}

export interface UserDataExportOptions {
  app: AppInfo;
  /** With a password the result is an encrypted `.bbk`; without one, a plain `.zip` export. */
  password?: string;
  now?: () => Date;
  /** Injection points for tests (cheap KDF, deterministic randomness). */
  seal?: SealOptions;
}

export interface UserDataExport {
  bytes: Uint8Array;
  encrypted: boolean;
  /** Suggested file extension, without the dot. */
  extension: 'zip' | 'bbk';
  payload: BackupPayload;
}

/** Serialize the store as backup format v1. */
export async function exportUserData(db: MemoryUserDb, options: UserDataExportOptions): Promise<UserDataExport> {
  const snap = db.snapshot();
  const payload = await createBackupPayload(
    { sql: new SnapshotSql({ user_data_item: snap.user_data_item as unknown as Row[], verse_link: snap.verse_link as unknown as Row[] }) },
    { includeHistory: false, app: options.app, now: options.now }
  );
  if (!options.password) return { bytes: payload.zip, encrypted: false, extension: 'zip', payload };
  const sealed = sealStream(chunked(payload.zip, 64 * 1024), [{ type: 'password', password: options.password }], options.seal);
  return { bytes: await collect(sealed), encrypted: true, extension: 'bbk', payload };
}

export type UserDataImportMode = 'merge' | 'replace';

export interface UserDataImportOptions {
  /** `merge` (default): newer `modified_date` wins per key, ties keep the local value. `replace`: empty the store first. */
  mode?: UserDataImportMode;
  password?: string;
  open?: OpenOptions;
}

export interface UserDataImportReport {
  mode: UserDataImportMode;
  items: { added: number; updated: number; unchanged: number; invalid: number };
  links: { added: number; unchanged: number; dropped: number };
  /** Section ids in the backup that the web store has no table for; they were not applied. */
  ignoredSections: string[];
}

const VALUE_TYPES = new Set(['string', 'int', 'bool', 'json']);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const strOrNull = (v: unknown): string | null => (v == null ? null : isStr(v) ? v : null);

function toItemRow(r: Row): Omit<UserDataItemRow, 'item_id'> | undefined {
  if (!isStr(r.owner_uuid) || !isStr(r.collection) || !isStr(r.item_key)) return undefined;
  if (r.value != null && !isStr(r.value)) return undefined;
  const valueType = r.value_type ?? 'json';
  if (!isStr(valueType) || !VALUE_TYPES.has(valueType)) return undefined;
  if (r.metadata != null) {
    if (!isStr(r.metadata)) return undefined;
    try {
      JSON.parse(r.metadata);
    } catch {
      return undefined;
    }
  }
  return {
    owner_uuid: r.owner_uuid,
    collection: r.collection,
    item_key: r.item_key,
    value: strOrNull(r.value),
    value_type: valueType,
    sort_order: isInt(r.sort_order) ? r.sort_order : 0,
    created_date: isStr(r.created_date) ? r.created_date : '1970-01-01 00:00:00',
    modified_date: isStr(r.modified_date) ? r.modified_date : isStr(r.created_date) ? r.created_date : '1970-01-01 00:00:00',
    metadata: strOrNull(r.metadata),
  };
}

const linkSignature = (r: Omit<VerseLinkRow, 'link_id'>): string =>
  JSON.stringify([r.source_type, r.source_id, r.verse_id_start, r.verse_id_end, r.link_type, r.sort_order, r.context, r.metadata]);

/** Read a `.zip` or `.bbk` and apply its `user_data_item` and item-anchored `verse_link` rows. Throws on a damaged or wrong-password file before changing anything. */
export async function importUserData(db: MemoryUserDb, file: Uint8Array, options: UserDataImportOptions = {}): Promise<UserDataImportReport> {
  const mode = options.mode ?? 'merge';
  const archive = await readBackupFile([file], options.password ? { password: options.password } : undefined, options.open);
  if (archive.manifest.userSchemaVersion > USER_SCHEMA_VERSION) {
    throw new RangeError('This backup was made by a newer version of the app.');
  }
  const report: UserDataImportReport = {
    mode,
    items: { added: 0, updated: 0, unchanged: 0, invalid: 0 },
    links: { added: 0, unchanged: 0, dropped: 0 },
    ignoredSections: [],
  };
  let itemSection: Row[] = [];
  let linkSection: Row[] = [];
  for (const s of archive.sections) {
    if (s.kind === 'table' && s.table === 'user_data_item') itemSection = sectionRows(archive, s);
    else if (s.kind === 'table' && s.table === 'verse_link') linkSection = sectionRows(archive, s);
    else if (s.kind !== 'info') report.ignoredSections.push(s.id);
  }
  for (const s of archive.unknownSections) report.ignoredSections.push(s.id);

  // Everything is parsed and validated above; from here on we only write.
  if (mode === 'replace') db.clearAll();

  const idMap = new Map<number, number>(); // backup item_id -> local item_id
  for (const raw of itemSection) {
    const row = toItemRow(raw);
    if (!row) {
      report.items.invalid++;
      continue;
    }
    const local = db.findItemRow(row.owner_uuid, row.collection, row.item_key);
    let saved: UserDataItemRow | undefined;
    if (!local) {
      saved = db.putItemRow(row);
      report.items.added++;
    } else if (stampMs(row.modified_date) > stampMs(local.modified_date)) {
      saved = db.putItemRow(row);
      report.items.updated++;
    } else {
      saved = local;
      report.items.unchanged++;
    }
    if (isInt(raw.item_id)) idMap.set(raw.item_id, saved.item_id);
  }

  const have = new Map<string, number>();
  for (const l of db.snapshot().verse_link) {
    const sig = linkSignature(l);
    have.set(sig, (have.get(sig) ?? 0) + 1);
  }
  for (const raw of linkSection) {
    if (raw.source_type !== 'user_data_item' || !isInt(raw.source_id) || !isInt(raw.verse_id_start)) {
      report.links.dropped++;
      continue;
    }
    const sourceId = idMap.get(raw.source_id);
    if (sourceId === undefined) {
      report.links.dropped++;
      continue;
    }
    const link: Omit<VerseLinkRow, 'link_id'> = {
      source_type: 'user_data_item',
      source_id: sourceId,
      verse_id_start: raw.verse_id_start,
      verse_id_end: isInt(raw.verse_id_end) ? raw.verse_id_end : raw.verse_id_start,
      link_type: isStr(raw.link_type) ? raw.link_type : 'reference',
      sort_order: isInt(raw.sort_order) ? raw.sort_order : 0,
      context: strOrNull(raw.context),
      metadata: strOrNull(raw.metadata),
    };
    const sig = linkSignature(link);
    const n = have.get(sig) ?? 0;
    if (n > 0) {
      have.set(sig, n - 1);
      report.links.unchanged++;
    } else {
      db.putLinkRow(link);
      report.links.added++;
    }
  }
  return report;
}
