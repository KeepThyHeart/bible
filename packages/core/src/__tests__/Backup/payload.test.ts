import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { UserTestHelper } from '../helpers/UserTestHelper';
import type { ISql } from '../../Data/Core/ISql';
import {
  createBackupPayload, readBackupPayload, sectionRows, parseManifest, encodeNdjson, decodeNdjson, writeBackup, FORMAT_VERSION,
} from '../../Backup/Payload';
import { resolveExtensionBackup } from '../../Backup/ExtensionData';
import { readBackupFile, openBackupFile } from '../../Backup/BackupFile';
import { sealStream } from '../../Backup/Envelope';
import { DamagedError, NewerFormatError, NotABackupError, PasswordRequiredError, WrongPasswordError } from '../../Backup/errors';
import { chunked, collect, once } from '../../Backup/Streams';
import { deterministicRandom } from '../../Crypto';
import { MemoryExtensions, MemoryFiles } from './memorySources';

let db: ISql;
beforeEach(() => {
  UserTestHelper.initialize();
  db = UserTestHelper.getProvider();
  db.execute("INSERT INTO user_commentary (name, is_default) VALUES ('Default', 1)");
  db.execute("INSERT INTO user_note (user_commentary_id, title, content, note_type) VALUES (1, 'Romans', '<p>x</p>', 'document')");
  db.execute("INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end) VALUES ('note', 1, 45001001, 45001001)");
  db.execute("INSERT INTO user_search_history (query) VALUES ('grace')");
  db.execute("INSERT INTO session (name, session_data, is_autosave) VALUES ('s', '{}', 0)");
  // Desktop-only table; the same shape the desktop creates.
  db.execute('CREATE TABLE extension_storage (extension_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (extension_id, key))');
});
afterEach(() => UserTestHelper.cleanup());

const APP = { name: 'Keep Thy Heart', version: '0.1.0', platform: 'test' };
const NOW = () => new Date('2026-09-26T14:03:11Z');
const opts = (includeHistory = false) => ({ includeHistory, app: APP, now: NOW });

describe('createBackupPayload', () => {
  it('writes the manifest first, lists every entry and section, and skips empty absent tables', async () => {
    const { zip, manifest, warnings } = await createBackupPayload({ sql: db }, opts());
    expect(warnings).toEqual([]);
    expect(manifest.formatVersion).toBe(FORMAT_VERSION);
    expect(manifest.createdAt).toBe('2026-09-26T14:03:11.000Z');
    expect(manifest.userSchemaVersion).toBe(1);
    const ids = manifest.sections.map((s) => s.id);
    expect(ids).toContain('user.user_note');
    expect(ids).toContain('user.verse_link');
    expect(ids).toContain('user.session');
    expect(ids).not.toContain('user.user_search_history'); // history is off
    expect(ids).not.toContain('user.sync_metadata');
    expect(ids).not.toContain('user.schema_version');
    expect(manifest.entries.map((e) => e.path)).toContain('README.txt');
    expect(manifest.sections.find((s) => s.id === 'user.user_note')).toMatchObject({ count: 1, kind: 'table', class: 'content', table: 'user_note' });
    const archive = await readBackupPayload(chunked(zip, 777));
    expect(archive.unknownSections).toEqual([]);
    const notes = sectionRows(archive, archive.sections.find((s) => s.id === 'user.user_note')!);
    expect(notes[0]).toMatchObject({ note_id: 1, title: 'Romans', content: '<p>x</p>' });
  });
  it('includes history tables only when asked', async () => {
    const { manifest } = await createBackupPayload({ sql: db }, opts(true));
    expect(manifest.sections.map((s) => s.id)).toContain('user.user_search_history');
    expect(manifest.options.includeHistory).toBe(true);
  });
  it('is deterministic for a fixed clock', async () => {
    const a = await createBackupPayload({ sql: db }, opts());
    const b = await createBackupPayload({ sql: db }, opts());
    expect(a.zip).toEqual(b.zip);
  });
  it('bundles .bn notes always and .bak only with history; skips names it cannot store safely', async () => {
    const notes = MemoryFiles.of({
      'Verse Notes/John/3/16.bn': 'note', 'Docs/a.bn': 'a', 'Docs/a.bn.bak': 'old', 'Docs/b.bak': 'hist', 'Docs/other.txt': 'no',
      'Docs/Case.bn': 'x', 'Docs/case.bn': 'y', 'bad\\name.bn': 'z',
    });
    const off = await createBackupPayload({ sql: db, notes }, opts(false));
    const sec = off.manifest.sections.find((s) => s.id === 'notes')!;
    expect(sec.paths.sort()).toEqual(['notes/Docs/Case.bn', 'notes/Docs/a.bn', 'notes/Verse Notes/John/3/16.bn']);
    expect(off.warnings.map((w) => w.params.path).sort()).toEqual(['Docs/case.bn', 'bad\\name.bn']);
    expect(off.manifest.sections.find((s) => s.id === 'notes.history')).toBeUndefined();
    const on = await createBackupPayload({ sql: db, notes }, opts(true));
    expect(on.manifest.sections.find((s) => s.id === 'notes.history')!.paths.sort()).toEqual(['notes-history/Docs/a.bn.bak', 'notes-history/Docs/b.bak']);
  });
  it('splits extension key-value data per extension; opted-out extensions stay out; unknown ones stay in', async () => {
    db.execute("INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES ('ext.a.mem', 'k1', '1', 5), ('ext.a.mem', 'k2', '\"x\"', 6), ('ext.b.skip', 'k', '1', 7), ('ext.c.gone', 'k', '2', 8)");
    const extensions = new MemoryExtensions([
      { id: 'ext.a.mem', backupKv: true, databases: ['progress'] },
      { id: 'ext.b.skip', backupKv: false, databases: [] },
    ], { 'ext.a.mem/progress': new Uint8Array([1, 2, 3]) });
    const { manifest, zip } = await createBackupPayload({ sql: db, extensions }, opts());
    const ids = manifest.sections.map((s) => s.id);
    expect(ids).toContain('ext.ext.a.mem.kv');
    expect(ids).toContain('ext.ext.c.gone.kv');
    expect(ids).not.toContain('ext.ext.b.skip.kv');
    expect(ids).toContain('ext.ext.a.mem.db.progress');
    const archive = await readBackupPayload(once(zip));
    const kv = sectionRows(archive, archive.sections.find((s) => s.id === 'ext.ext.a.mem.kv')!);
    expect(kv).toEqual([
      { extension_id: 'ext.a.mem', key: 'k1', value: '1', updated_at: 5 },
      { extension_id: 'ext.a.mem', key: 'k2', value: '"x"', updated_at: 6 },
    ]);
    expect(archive.entries.get('extensions/ext.a.mem/db/progress.sqlite')).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('skips extension ids that are not safe path segments', async () => {
    db.execute("INSERT INTO extension_storage VALUES ('../evil', 'k', '1', 1)");
    const { manifest, warnings } = await createBackupPayload({ sql: db }, opts());
    expect(manifest.sections.some((s) => s.id.includes('evil'))).toBe(false);
    expect(warnings).toContainEqual({ code: 'extensionSkipped', params: { id: '../evil' } });
  });
  it('stores preferences and the module list when provided', async () => {
    const { manifest } = await createBackupPayload({
      sql: db, preferences: async () => ({ theme: 'dark' }), modules: async () => [{ id: 'kjv', version: '1' }],
    }, opts());
    expect(manifest.sections.find((s) => s.id === 'prefs')).toMatchObject({ class: 'workspace', count: 1 });
    expect(manifest.sections.find((s) => s.id === 'modules')).toMatchObject({ kind: 'info' });
  });
  it('streams the same bytes through writeBackup', async () => {
    const direct = await createBackupPayload({ sql: db }, opts());
    expect(await collect(writeBackup({ sql: db }, opts()))).toEqual(direct.zip);
  });
});

describe('extension userData resolution', () => {
  it('defaults: key-value in, databases out', () => {
    expect(resolveExtensionBackup('e')).toEqual({ id: 'e', backupKv: true, databases: [] });
    expect(resolveExtensionBackup('e', {})).toEqual({ id: 'e', backupKv: true, databases: [] });
  });
  it('honours opt-outs and per-database opt-ins', () => {
    expect(resolveExtensionBackup('e', { backup: false, databases: { b: { backup: true }, a: { backup: true }, c: { backup: false }, d: {} } }))
      .toEqual({ id: 'e', backupKv: false, databases: ['a', 'b'] });
  });
});

describe('row encoding', () => {
  it('round-trips strings, numbers, nulls and binary values', () => {
    const rows = [{ a: 1, b: 'x\ny', c: null, d: new Uint8Array([0, 255, 7]), e: 1.5 }];
    const back = decodeNdjson(encodeNdjson(rows, ['a', 'b', 'c', 'd', 'e']));
    expect(back).toEqual(rows);
  });
  it('escapes newlines so one row is one line', () => {
    expect(new TextDecoder().decode(encodeNdjson([{ a: 'l1\nl2' }], ['a'])).split('\n').length).toBe(2);
  });
  it('rejects nested values, bad lines and truncated sections', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(() => decodeNdjson(enc('{"a":{"x":1}}\n'))).toThrow(DamagedError);
    expect(() => decodeNdjson(enc('{"a":[1]}\n'))).toThrow(DamagedError);
    expect(() => decodeNdjson(enc('nope\n'))).toThrow(DamagedError);
    expect(() => decodeNdjson(enc('[1]\n'))).toThrow(DamagedError);
    expect(() => decodeNdjson(enc('{"a":1}'))).toThrow(DamagedError);
    expect(decodeNdjson(enc(''))).toEqual([]);
  });
});

describe('readBackupPayload rejects anything the manifest does not vouch for', () => {
  async function good() {
    return createBackupPayload({ sql: db, notes: MemoryFiles.of({ 'a.bn': 'hello' }) }, opts());
  }
  const rezip = (entries: Record<string, Uint8Array>) => zipSync(entries, { level: 0 });
  async function entriesOf(zip: Uint8Array) {
    const { unzipSync } = await import('fflate');
    return unzipSync(zip);
  }

  it('a modified entry', async () => {
    const { zip } = await good();
    const e = await entriesOf(zip);
    e['notes/a.bn'] = strToU8('HELLO');
    await expect(readBackupPayload(once(rezip(e)))).rejects.toThrow(/checksum/);
  });
  it('a missing entry and an unlisted entry', async () => {
    const { zip } = await good();
    const e = await entriesOf(zip);
    const withoutNote = { ...e };
    delete withoutNote['notes/a.bn'];
    await expect(readBackupPayload(once(rezip(withoutNote)))).rejects.toThrow(/missing/);
    await expect(readBackupPayload(once(rezip({ ...e, 'extra.txt': strToU8('x') })))).rejects.toThrow(/unlisted/);
  });
  it('manifest not first', async () => {
    const { zip } = await good();
    const e = await entriesOf(zip);
    const { 'manifest.json': m, ...rest } = e;
    await expect(readBackupPayload(once(rezip({ ...rest, 'manifest.json': m })))).rejects.toThrow(DamagedError);
  });
  it('not a zip, an empty zip, and a zip without a manifest', async () => {
    await expect(readBackupPayload(once(strToU8('hello')))).rejects.toThrow(DamagedError);
    await expect(readBackupPayload(once(rezip({ 'a.txt': strToU8('x') })))).rejects.toThrow(DamagedError);
  });
  it('hostile entry names and oversize content, via the ZIP guards', async () => {
    await expect(readBackupPayload(once(rezip({ '../manifest.json': strToU8('{}') })))).rejects.toThrow(DamagedError);
    const { zip } = await good();
    await expect(readBackupPayload(once(zip), { zipLimits: { maxTotalBytes: 100 } })).rejects.toThrow(DamagedError);
  });
});

describe('manifest validation', () => {
  const base = () => ({
    format: 'kth-backup', formatVersion: '1.0', minReaderVersion: '1.0', createdAt: '2026-09-26T00:00:00Z',
    app: APP, userSchemaVersion: 1, options: { includeHistory: false }, entries: [], sections: [],
  });
  const parse = (o: unknown, max?: number) => parseManifest(new TextEncoder().encode(JSON.stringify(o)), max);
  it('accepts a minimal manifest and a later minor version', () => {
    expect(() => parse(base())).not.toThrow();
    expect(() => parse({ ...base(), formatVersion: '1.7', futureField: { any: 1 } })).not.toThrow();
  });
  it('refuses newer majors, newer minimum reader versions and newer schema versions', () => {
    expect(() => parse({ ...base(), formatVersion: '2.0', minReaderVersion: '2.0' })).toThrow(NewerFormatError);
    expect(() => parse({ ...base(), minReaderVersion: '1.1' })).toThrow(NewerFormatError);
    expect(() => parse({ ...base(), userSchemaVersion: 2 })).toThrow(NewerFormatError);
    expect(() => parse({ ...base(), userSchemaVersion: 2 }, 2)).not.toThrow();
  });
  it.each([
    ['wrong format', { format: 'x' }], ['bad version', { formatVersion: 'one' }], ['bad date', { createdAt: 'x' }],
    ['no app', { app: null }], ['negative schema', { userSchemaVersion: -1 }], ['no options', { options: {} }],
    ['entries not array', { entries: {} }], ['bad entry', { entries: [{ path: 'a', size: 1, sha256: 'zz' }] }],
    ['entry path unsafe', { entries: [{ path: '../a', size: 1, sha256: 'a'.repeat(64) }] }],
    ['section refers to unknown path', { sections: [{ id: 's', kind: 'table', class: 'content', required: false, count: 0, paths: ['nope'] }] }],
    ['bad column name', { sections: [{ id: 's', kind: 'table', class: 'content', required: false, count: 0, paths: [], columns: ['a;drop'] }] }],
    ['duplicate section ids', { sections: [
      { id: 's', kind: 'x', class: 'c', required: false, count: 0, paths: [] }, { id: 's', kind: 'x', class: 'c', required: false, count: 0, paths: [] }] }],
  ])('rejects %s', (_n, patch) => {
    expect(() => parse({ ...base(), ...patch })).toThrow(DamagedError);
  });
  it('rejects duplicate keys and non-JSON', () => {
    expect(() => parseManifest(new TextEncoder().encode('{"format":"kth-backup","format":"kth-backup"}'))).toThrow(DamagedError);
    expect(() => parseManifest(new TextEncoder().encode('nope'))).toThrow(DamagedError);
  });
});

describe('forward compatibility: unknown sections', () => {
  async function withSections(extra: unknown[]) {
    const { zip, manifest } = await createBackupPayload({ sql: db }, opts());
    const { unzipSync } = await import('fflate');
    const e = unzipSync(zip);
    const m = { ...manifest, sections: [...manifest.sections, ...extra] };
    e['manifest.json'] = strToU8(JSON.stringify(m));
    const ordered: Record<string, Uint8Array> = { 'manifest.json': e['manifest.json'] };
    for (const [k, v] of Object.entries(e)) if (k !== 'manifest.json') ordered[k] = v;
    return zipSync(ordered, { level: 0 });
  }
  it('skips optional sections it does not know and reports them', async () => {
    const zip = await withSections([
      { id: 'user.future_table', kind: 'table', class: 'content', required: false, count: 0, table: 'future_table', paths: [] },
      { id: 'thing', kind: 'hologram', class: 'content', required: false, count: 0, paths: [] },
      { id: 'user.sync_metadata', kind: 'table', class: 'content', required: false, count: 0, table: 'sync_metadata', paths: [] },
    ]);
    const a = await readBackupPayload(once(zip));
    expect(a.unknownSections.map((s) => s.id)).toEqual(['user.future_table', 'thing', 'user.sync_metadata']);
    expect(a.sections.length).toBeGreaterThan(0);
  });
  it('refuses when an unknown section is marked required', async () => {
    const zip = await withSections([{ id: 'thing', kind: 'hologram', class: 'content', required: true, count: 0, paths: [] }]);
    await expect(readBackupPayload(once(zip))).rejects.toBeInstanceOf(NewerFormatError);
  });
});

describe('opening files: encrypted and plain', () => {
  const fast = async () => new Uint8Array(32).fill(3);
  async function encrypted() {
    const { zip } = await createBackupPayload({ sql: db }, opts());
    const file = await collect(sealStream(chunked(zip, 5000), [{ type: 'password', password: 'pw' }], { random: deterministicRandom(1), kdf: fast }));
    return { zip, file };
  }
  it('reads an encrypted backup with the password and a plain export without one', async () => {
    const { zip, file } = await encrypted();
    const a = await readBackupFile(chunked(file, 4000), { password: 'pw' }, { kdf: fast });
    expect(a.encrypted).toBe(true);
    const b = await readBackupFile(chunked(zip, 4000));
    expect(b.encrypted).toBe(false);
    expect(b.manifest).toEqual(a.manifest);
  });
  it('asks for a password, rejects a wrong one, and rejects other files', async () => {
    const { file } = await encrypted();
    await expect(openBackupFile(once(file))).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(readBackupFile(once(file), { password: 'no' }, { kdf: async () => new Uint8Array(32).fill(4) })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(openBackupFile(once(strToU8('{"json": true}')))).rejects.toBeInstanceOf(NotABackupError);
  });
  it('a truncated encrypted backup is rejected before anything can be applied', async () => {
    const { file } = await encrypted();
    await expect(readBackupFile(once(file.subarray(0, file.length - 100)), { password: 'pw' }, { kdf: fast })).rejects.toBeInstanceOf(DamagedError);
  });
});
