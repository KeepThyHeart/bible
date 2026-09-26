/**
 * The backup payload: a plain ZIP whose first entry is `manifest.json`.
 *
 * ```
 * manifest.json                     format, app, schema version, entry list, sections
 * README.txt                        what this is
 * user/<table>.ndjson               one JSON object per row (columns by name)
 * notes/<path>.bn                   file notes, exactly as on disk
 * notes-history/<path>.bak          only with includeHistory
 * extensions/<id>/kv.ndjson         an extension's key-value rows
 * extensions/<id>/db/<name>.sqlite  an extension database it opted in
 * settings/preferences.json         allow-listed preferences
 * modules.json                      installed module ids and versions (informational)
 * ```
 *
 * Unencrypted, this ZIP is the portable export. Encrypted, it is the plaintext
 * that `Envelope.ts` seals into a `.bbk`. Every entry is listed in the manifest
 * with its size and SHA-256, and the reader checks all of them before anything
 * is restored.
 */
import type { ISql } from '../Data/Core/ISql';
import { b64urlDecode, b64urlEncode, hexEncode, sha256, utf8Decode, utf8Encode } from '../Crypto';
import { DamagedError, NewerFormatError } from './errors';
import { EXTENSION_DB_NAME_PATTERN, EXTENSION_ID_PATTERN } from './ExtensionData';
import type { ExtensionBackupDecl } from './ExtensionData';
import { USER_SCHEMA_VERSION, USER_TABLES, orderedTables } from './Registry';
import type { Row, TableClass } from './Registry';
import { chunked } from './Streams';
import type { ByteSource } from './Streams';
import { parseStrictJson } from './StrictJson';
import { checkEntryName, readZip, writeZip, ZipError } from './Zip';
import type { ZipLimits } from './Zip';

export const BACKUP_FORMAT = 'kth-backup';
/** Version of the payload layout. Minor bumps add optional data; a major bump means older readers must refuse. */
export const FORMAT_VERSION = '1.0';
export const MIN_READER_VERSION = '1.0';
const SUPPORTED_MAJOR = 1;

export type SectionKind = 'table' | 'files' | 'extKv' | 'extDb' | 'prefs' | 'info';

export interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface ManifestSection {
  id: string;
  kind: SectionKind | string;
  class: TableClass | string;
  required: boolean;
  count: number;
  /** For `table`: the registry table name. For `extKv`/`extDb`: the extension id. */
  table?: string;
  ext?: string;
  db?: string;
  /** For `table` and `extKv`: column names in each row object. */
  columns?: string[];
  /** Paths of the entries this section owns (see `Manifest.entries`). */
  paths: string[];
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface Manifest {
  format: string;
  formatVersion: string;
  minReaderVersion: string;
  createdAt: string;
  app: AppInfo;
  userSchemaVersion: number;
  options: { includeHistory: boolean };
  entries: ManifestEntry[];
  sections: ManifestSection[];
  [k: string]: unknown;
}

// --- Row encoding -------------------------------------------------------------

/** BLOBs travel as `{"$b64": "..."}` so a row stays plain JSON. */
export function encodeValue(v: unknown): unknown {
  if (v instanceof Uint8Array) return { $b64: b64urlEncode(v) };
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  return v === undefined ? null : v;
}

export function decodeValue(v: unknown): unknown {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === '$b64' && typeof (v as { $b64: unknown }).$b64 === 'string') {
      try {
        return b64urlDecode((v as { $b64: string }).$b64);
      } catch {
        throw new DamagedError('Malformed binary value in a backup row');
      }
    }
    // Nested structures are not valid column values: JSON columns are stored as TEXT.
    throw new DamagedError('Unexpected object value in a backup row');
  }
  if (Array.isArray(v)) throw new DamagedError('Unexpected array value in a backup row');
  return v;
}

export function encodeNdjson(rows: Row[], columns: string[]): Uint8Array {
  const lines: string[] = [];
  for (const row of rows) {
    const o: Record<string, unknown> = {};
    for (const c of columns) o[c] = encodeValue(row[c]);
    lines.push(JSON.stringify(o));
  }
  return utf8Encode(lines.length ? lines.join('\n') + '\n' : '');
}

/** Parse an NDJSON entry into rows. `columns` fixes which keys are read; extra keys are counted by the caller from the manifest. */
export function decodeNdjson(bytes: Uint8Array): Row[] {
  const text = utf8Decode(bytes);
  if (text === '') return [];
  if (!text.endsWith('\n')) throw new DamagedError('A backup section is truncated');
  const rows: Row[] = [];
  const lines = text.slice(0, -1).split('\n');
  for (let i = 0; i < lines.length; i++) {
    let obj: unknown;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      throw new DamagedError(`Malformed row ${i + 1} in a backup section`);
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) throw new DamagedError(`Malformed row ${i + 1} in a backup section`);
    const row: Row = {};
    for (const [k, v] of Object.entries(obj)) row[k] = decodeValue(v);
    rows.push(row);
  }
  return rows;
}

// --- Writing ------------------------------------------------------------------

export interface FileSource {
  /** Every file under the notes directory, as POSIX paths relative to it. */
  list(): AsyncIterable<{ path: string; size: number }> | Iterable<{ path: string; size: number }>;
  read(path: string): Promise<Uint8Array>;
}

export interface ExtensionDataSource {
  list(): Promise<ExtensionBackupDecl[]>;
  /** A consistent copy of one extension database (never the live file). */
  dbSnapshot(id: string, name: string): Promise<Uint8Array>;
}

export interface ModuleRef {
  id: string;
  version?: string;
  name?: string;
  [k: string]: unknown;
}

export interface BackupSources {
  sql: ISql;
  notes?: FileSource;
  extensions?: ExtensionDataSource;
  preferences?: () => Promise<Record<string, unknown>>;
  modules?: () => Promise<ModuleRef[]>;
}

export interface WriteOptions {
  includeHistory: boolean;
  app: AppInfo;
  /** Injectable clock, for reproducible tests. */
  now?: () => Date;
}

export interface BackupWarning {
  code: string;
  params: Record<string, string | number>;
}

export interface BackupPayload {
  /** The plain ZIP. */
  zip: Uint8Array;
  manifest: Manifest;
  warnings: BackupWarning[];
}

const README = `This is a Keep Thy Heart backup.

It is a standard ZIP archive. The first entry, manifest.json, lists every other
entry with its size and SHA-256 and describes the sections it holds.

  user/<table>.ndjson   one JSON object per row
  notes/                note files, exactly as stored on disk
  extensions/           data that extensions asked to have backed up
  settings/             preferences

If you are reading this in an unencrypted export, anyone with this file can read
everything in it. Keep it somewhere safe.
`;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function entryOf(path: string, data: Uint8Array): Promise<ManifestEntry> {
  return { path, size: data.length, sha256: hexEncode(await sha256(data)) };
}

function tableExists(sql: ISql, name: string): boolean {
  return sql.queryOne("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]) !== undefined;
}

function liveColumns(sql: ISql, table: string): string[] {
  return sql.queryAll<{ name: string }>(`PRAGMA table_info("${table}")`).map((c) => c.name);
}

/** Classes exported with the given options. */
export function exportedClasses(includeHistory: boolean): TableClass[] {
  return includeHistory ? ['content', 'workspace', 'history'] : ['content', 'workspace'];
}

/**
 * Read everything selected and build the payload ZIP in memory. The manifest is
 * written first but needs every entry's hash, so the sections are materialised
 * before it is assembled; only the encryption layer streams.
 */
export async function createBackupPayload(src: BackupSources, o: WriteOptions): Promise<BackupPayload> {
  const now = o.now ?? (() => new Date());
  const warnings: BackupWarning[] = [];
  const files: Array<{ name: string; data: Uint8Array; store?: boolean }> = [];
  const sections: ManifestSection[] = [];
  const entries: ManifestEntry[] = [];
  const usedNames = new Set<string>(['manifest.json']);

  const addFile = async (name: string, data: Uint8Array, store = false): Promise<boolean> => {
    const bad = checkEntryName(name);
    const folded = name.toLowerCase();
    if (bad || usedNames.has(folded)) return false;
    usedNames.add(folded);
    files.push({ name, data, store });
    entries.push(await entryOf(name, data));
    return true;
  };

  await addFile('README.txt', utf8Encode(README));

  // --- database tables (registry-driven; extension_storage is split per extension below)
  const classes = new Set(exportedClasses(o.includeHistory));
  for (const spec of orderedTables()) {
    if (!classes.has(spec.cls) || spec.name === 'extension_storage') continue;
    if (!tableExists(src.sql, spec.name)) continue;
    const have = new Set(liveColumns(src.sql, spec.name));
    const columns = spec.columns.filter((c) => have.has(c));
    if (columns.length === 0) continue;
    const order = spec.pk.filter((k) => have.has(k)).map((k) => `"${k}"`).join(', ');
    const rows = src.sql.queryAll<Row>(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${spec.name}"${order ? ` ORDER BY ${order}` : ''}`);
    const path = `user/${spec.name}.ndjson`;
    await addFile(path, encodeNdjson(rows, columns));
    sections.push({ id: `user.${spec.name}`, kind: 'table', class: spec.cls, required: false, count: rows.length, table: spec.name, columns, paths: [path] });
  }

  // --- notes
  if (src.notes) {
    const bn: string[] = [];
    const bak: string[] = [];
    for await (const f of src.notes.list() as AsyncIterable<{ path: string; size: number }>) {
      if (f.path.endsWith('.bn')) bn.push(f.path);
      else if (o.includeHistory && f.path.endsWith('.bak')) bak.push(f.path);
    }
    for (const [id, prefix, list, cls] of [
      ['notes', 'notes/', bn, 'content'],
      ['notes.history', 'notes-history/', bak, 'history'],
    ] as const) {
      if (id === 'notes.history' && !o.includeHistory) continue;
      list.sort();
      const paths: string[] = [];
      for (const rel of list) {
        const data = await src.notes.read(rel);
        if (await addFile(prefix + rel, data)) paths.push(prefix + rel);
        else warnings.push({ code: 'noteSkipped', params: { path: rel } });
      }
      sections.push({ id, kind: 'files', class: cls, required: false, count: paths.length, paths });
    }
  }

  // --- extension data
  const decls = src.extensions ? await src.extensions.list() : [];
  const declById = new Map(decls.map((d) => [d.id, d]));
  if (tableExists(src.sql, 'extension_storage')) {
    const rows = src.sql.queryAll<Row>('SELECT extension_id, key, value, updated_at FROM extension_storage ORDER BY extension_id, key');
    const byExt = new Map<string, Row[]>();
    for (const r of rows) {
      const id = String(r.extension_id);
      let list = byExt.get(id);
      if (!list) byExt.set(id, (list = []));
      list.push(r);
    }
    for (const [id, list] of [...byExt].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      // An extension that is installed and opted out stays out; one we know nothing about keeps its data.
      if (declById.get(id)?.backupKv === false) continue;
      if (!EXTENSION_ID_PATTERN.test(id)) {
        warnings.push({ code: 'extensionSkipped', params: { id } });
        continue;
      }
      const columns = ['extension_id', 'key', 'value', 'updated_at'];
      const path = `extensions/${id}/kv.ndjson`;
      await addFile(path, encodeNdjson(list, columns));
      sections.push({ id: `ext.${id}.kv`, kind: 'extKv', class: 'extension', required: false, count: list.length, ext: id, columns, paths: [path] });
    }
  }
  if (src.extensions) {
    for (const d of [...decls].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      for (const name of d.databases) {
        if (!EXTENSION_ID_PATTERN.test(d.id) || !EXTENSION_DB_NAME_PATTERN.test(name)) {
          warnings.push({ code: 'extensionSkipped', params: { id: d.id } });
          continue;
        }
        const data = await src.extensions.dbSnapshot(d.id, name);
        const path = `extensions/${d.id}/db/${name}.sqlite`;
        await addFile(path, data, false);
        sections.push({ id: `ext.${d.id}.db.${name}`, kind: 'extDb', class: 'extension', required: false, count: 1, ext: d.id, db: name, paths: [path] });
      }
    }
  }

  // --- preferences and module list
  if (src.preferences) {
    const prefs = await src.preferences();
    const path = 'settings/preferences.json';
    await addFile(path, utf8Encode(JSON.stringify(prefs, null, 2) + '\n'));
    sections.push({ id: 'prefs', kind: 'prefs', class: 'workspace', required: false, count: Object.keys(prefs).length, paths: [path] });
  }
  if (src.modules) {
    const mods = await src.modules();
    const path = 'modules.json';
    await addFile(path, utf8Encode(JSON.stringify(mods, null, 2) + '\n'));
    sections.push({ id: 'modules', kind: 'info', class: 'excluded', required: false, count: mods.length, paths: [path] });
  }

  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    formatVersion: FORMAT_VERSION,
    minReaderVersion: MIN_READER_VERSION,
    createdAt: now().toISOString(),
    app: o.app,
    userSchemaVersion: USER_SCHEMA_VERSION,
    options: { includeHistory: o.includeHistory },
    entries,
    sections,
  };
  const manifestBytes = utf8Encode(JSON.stringify(manifest, null, 2) + '\n');
  const zip = writeZip([{ name: 'manifest.json', data: manifestBytes }, ...files]);
  return { zip, manifest, warnings };
}

/** Convenience: the payload as a byte stream (what `sealStream` consumes). */
export async function* writeBackup(src: BackupSources, o: WriteOptions): AsyncGenerator<Uint8Array> {
  const { zip } = await createBackupPayload(src, o);
  yield* chunked(zip, 64 * 1024);
}

// --- Reading ------------------------------------------------------------------

export interface BackupArchive {
  manifest: Manifest;
  /** Verified entry bytes by path (manifest.json excluded). */
  entries: Map<string, Uint8Array>;
  /** Sections this reader understands. */
  sections: ManifestSection[];
  /** Sections it does not (optional ones from a newer minor version); skipped, reported. */
  unknownSections: ManifestSection[];
}

export interface ReadOptions {
  /** Highest user schema version to accept; defaults to this build's. */
  maxSchemaVersion?: number;
  zipLimits?: Partial<ZipLimits>;
}

const KNOWN_KINDS = new Set<string>(['table', 'files', 'extKv', 'extDb', 'prefs', 'info']);
const HEX64 = /^[0-9a-f]{64}$/;
const VERSION = /^(\d{1,4})\.(\d{1,4})$/;

function fail(msg: string): never {
  throw new DamagedError(`Malformed backup manifest: ${msg}`);
}

function parseVersion(v: unknown, what: string): [number, number] {
  const m = typeof v === 'string' ? VERSION.exec(v) : null;
  if (!m) return fail(what);
  return [Number(m[1]), Number(m[2])];
}

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate untrusted manifest JSON. Throws `NewerFormatError` or `DamagedError`. */
export function parseManifest(bytes: Uint8Array, maxSchemaVersion = USER_SCHEMA_VERSION): Manifest {
  let json: unknown;
  try {
    json = parseStrictJson(utf8Decode(bytes));
  } catch {
    return fail('not valid JSON');
  }
  if (!isRec(json)) return fail('not an object');
  if (json.format !== BACKUP_FORMAT) throw new DamagedError('This file is not a Keep Thy Heart backup');
  const [major] = parseVersion(json.formatVersion, 'formatVersion');
  const [minReaderMajor, minReaderMinor] = parseVersion(json.minReaderVersion, 'minReaderVersion');
  if (major > SUPPORTED_MAJOR || minReaderMajor > SUPPORTED_MAJOR || (minReaderMajor === SUPPORTED_MAJOR && minReaderMinor > 0)) {
    throw new NewerFormatError('This backup was made by a newer version of Keep Thy Heart. Update the app to restore it.');
  }
  if (typeof json.createdAt !== 'string' || Number.isNaN(Date.parse(json.createdAt))) fail('createdAt');
  if (!isRec(json.app) || typeof json.app.name !== 'string' || typeof json.app.version !== 'string' || typeof json.app.platform !== 'string') fail('app');
  const v = json.userSchemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) fail('userSchemaVersion');
  if (v > maxSchemaVersion) {
    throw new NewerFormatError('This backup was made by a newer version of Keep Thy Heart. Update the app to restore it.');
  }
  if (!isRec(json.options) || typeof json.options.includeHistory !== 'boolean') fail('options');
  if (!Array.isArray(json.entries)) return fail('entries');
  if (!Array.isArray(json.sections)) return fail('sections');

  const seenPaths = new Set<string>();
  for (const e of json.entries) {
    if (!isRec(e) || typeof e.path !== 'string' || typeof e.size !== 'number' || !Number.isInteger(e.size) || e.size < 0
      || typeof e.sha256 !== 'string' || !HEX64.test(e.sha256)) fail('entries');
    const entry = e as unknown as ManifestEntry;
    if (checkEntryName(entry.path) || entry.path === 'manifest.json' || entry.path.endsWith('/')) fail('entry path');
    const folded = entry.path.toLowerCase();
    if (seenPaths.has(folded)) fail('duplicate entry');
    seenPaths.add(folded);
  }
  const ids = new Set<string>();
  for (const s of json.sections) {
    if (!isRec(s) || typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 300 || typeof s.kind !== 'string'
      || typeof s.class !== 'string' || typeof s.required !== 'boolean' || typeof s.count !== 'number'
      || !Number.isInteger(s.count) || s.count < 0 || !Array.isArray(s.paths)) fail('section');
    if (ids.has(s.id)) fail('duplicate section id');
    ids.add(s.id);
    for (const p of s.paths) if (typeof p !== 'string' || !seenPaths.has(p.toLowerCase())) fail('section path');
    if (s.columns !== undefined && (!Array.isArray(s.columns) || s.columns.some((c) => typeof c !== 'string' || !IDENT.test(c)))) fail('section columns');
    for (const f of ['table', 'ext', 'db'] as const) if (s[f] !== undefined && typeof s[f] !== 'string') fail(`section ${f}`);
  }
  return json as unknown as Manifest;
}

/**
 * Read a plain payload ZIP: check the manifest comes first, verify every entry's
 * size and SHA-256 against it, and sort sections into understood and unknown.
 * Nothing is applied here; this only proves the bytes are what the manifest says.
 */
export async function readBackupPayload(plain: ByteSource, o: ReadOptions = {}): Promise<BackupArchive> {
  let all;
  try {
    all = await readZip(plain, o.zipLimits, (name, index) => {
      if (index === 0 && name !== 'manifest.json') throw new ZipError('manifest.json is not the first entry');
    });
  } catch (e) {
    if (e instanceof ZipError) throw new DamagedError(`This is not a valid backup: ${e.message}`);
    throw e;
  }
  if (all.length === 0 || all[0].name !== 'manifest.json') throw new DamagedError('This is not a valid backup: manifest.json is not the first entry');
  const manifest = parseManifest(all[0].data, o.maxSchemaVersion);

  const byName = new Map<string, Uint8Array>();
  for (const e of all.slice(1)) byName.set(e.name, e.data);
  const listed = new Set(manifest.entries.map((e) => e.path));
  for (const name of byName.keys()) if (!listed.has(name)) throw new DamagedError(`The backup contains an unlisted entry: ${name}`);
  for (const e of manifest.entries) {
    const data = byName.get(e.path);
    if (!data) throw new DamagedError(`The backup is missing an entry: ${e.path}`);
    if (data.length !== e.size || hexEncode(await sha256(data)) !== e.sha256) {
      throw new DamagedError(`The backup is damaged: ${e.path} does not match its checksum`);
    }
  }

  const sections: ManifestSection[] = [];
  const unknownSections: ManifestSection[] = [];
  for (const s of manifest.sections) {
    const known = KNOWN_KINDS.has(s.kind)
      && (s.kind !== 'table' || (typeof s.table === 'string' && USER_TABLES.some((t) => t.name === s.table && t.cls !== 'excluded')))
      && (s.kind !== 'extKv' || (typeof s.ext === 'string' && EXTENSION_ID_PATTERN.test(s.ext)))
      && (s.kind !== 'extDb' || (typeof s.ext === 'string' && EXTENSION_ID_PATTERN.test(s.ext) && typeof s.db === 'string' && EXTENSION_DB_NAME_PATTERN.test(s.db)));
    if (known) sections.push(s);
    else if (s.required) throw new NewerFormatError('This backup needs a newer version of Keep Thy Heart. Update the app to restore it.');
    else unknownSections.push(s);
  }
  return { manifest, entries: byName, sections, unknownSections };
}

/** Rows of a `table` or `extKv` section. */
export function sectionRows(archive: BackupArchive, section: ManifestSection): Row[] {
  const data = archive.entries.get(section.paths[0]);
  if (!data) throw new DamagedError(`Missing entry for section ${section.id}`);
  return decodeNdjson(data);
}

