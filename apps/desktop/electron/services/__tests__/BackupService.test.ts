// @vitest-environment node
/**
 * The desktop side of backups against a real SQLite database created with the
 * app's own DDL (`initializeUserSchema`, `initializeExtensionSchema`,
 * `ensureContentVerseLinkTable`), real files in a temp directory, and the core
 * format code. The format itself is tested in `packages/core`; this pins what the
 * desktop adds: the notes folder, extension data, files, snapshots and error mapping.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Backup } from '@bible/core';
import type { ISql } from '@bible/core';
import { initializeUserSchema } from '../../schema/userSchema';
import { initializeExtensionSchema } from '../../extensions/extensionSchema';
import { ensureContentVerseLinkTable } from '../../utils/verseIndexing';
import { makeSql } from './helpers/testSql';
import {
  createEncryptedBackup, createPlainExport, inspectBackupFile, applyInspection, discardInspection, NoActiveInspectionError,
} from '../BackupService';
import type { BackupContext } from '../BackupService';
import { NotesDirStore, createPreRestoreSnapshot, notesSink } from '../backup/nodeAdapters';
import type { ExtensionPort } from '../backup/nodeAdapters';
import { createWorkerKdf } from '../backup/workerKdf';
import { IpcKnownError } from '../../ipc/result';

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, dialog: {} }));
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const PASSWORD = 'correct horse battery staple';
// A fast stand-in for Argon2id; the real one is exercised once below.
const fastKdf: Backup.KdfFunction = async (pw) => new Uint8Array(32).fill(pw.length);
const APP = { name: 'Keep Thy Heart', version: '0.1.0', platform: 'test' };

let dir: string;
const dbs: Database.Database[] = [];

function newDb(): { db: Database.Database; sql: ISql } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  dbs.push(db);
  const sql = makeSql(db);
  initializeUserSchema(sql);
  initializeExtensionSchema(sql);
  ensureContentVerseLinkTable(sql);
  return { db, sql };
}

function ctxFor(sql: ISql, name: string, extra: Partial<BackupContext> = {}): BackupContext {
  const notesDir = join(dir, name, 'notes');
  mkdirSync(notesDir, { recursive: true });
  return { sql, appInfo: APP, notesDir, kdf: fastKdf, snapshot: { root: join(dir, name, 'pre-restore'), userDbPath: join(dir, name, 'user.db') }, ...extra };
}

function seed(sql: ISql): void {
  sql.execute("INSERT INTO user_commentary (name, is_default) VALUES ('Default', 1)");
  sql.execute("INSERT INTO user_note (user_commentary_id, title, content, note_type) VALUES (1, 'Romans', '<p>grace</p>', 'document')");
  sql.execute("INSERT INTO user_note (title, content, parent_note_id) VALUES ('Child', 'x', 1)");
  sql.execute("INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (1, 45001001, 45001001)");
  sql.execute("INSERT INTO content_verse_link (content_type, content_id, verse_id_start, verse_id_end) VALUES ('note', 2, 43003016, 43003016)");
  sql.execute("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color, note_id) VALUES (1, 43003016, 43003016, '#FFF3A3', 1)");
  sql.execute("INSERT INTO collection (name) VALUES ('Favourites')");
  sql.execute("INSERT INTO pinned_item (collection_id, item_type, reference_id) VALUES (1, 'note', 1)");
  sql.execute("INSERT INTO session (name, session_data) VALUES ('Saved', '{\"prefs\":{}}')");
  sql.execute("INSERT INTO user_keybindings VALUES ('cmd.a', 'ctrl+k', NULL, NULL)");
  sql.execute("INSERT INTO extension_storage VALUES ('ext.pub.memory', 'progress', '{\"n\":3}', 100), ('ext.pub.off', 'secret', '1', 50)");
  sql.execute("INSERT INTO extensions (id, version, install_path, granted_permissions, installed_at, updated_at) VALUES ('ext.pub.memory', '1', '/x', '[]', 1, 1)");
}

function writeNotes(name: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, name, 'notes', rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
  }
}

const tableRows = (db: Database.Database, t: string) => db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all();

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kth-backup-test-')); });
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('encrypted backup round trip', () => {
  it('writes a .bbk, and inspecting + replacing restores tables, notes and extension data on a fresh install', async () => {
    const a = newDb();
    seed(a.sql);
    writeNotes('a', { 'Verse Notes/John/3/16.bn': '{"bn":1}', 'Docs/sermon.bn': 'sermon' });
    const ctxA = ctxFor(a.sql, 'a');
    const out = join(dir, 'my.bbk');
    const summary = await createEncryptedBackup(ctxA, { destinationPath: out, includeHistory: false, password: PASSWORD });
    expect(summary.path).toBe(out);
    expect(existsSync(`${out}.partial`)).toBe(false);
    const head = readFileSync(out).subarray(0, 8);
    expect(Backup.sniff(head)).toBe('bbk');

    const b = newDb();
    const ctxB = ctxFor(b.sql, 'b');
    const inspection = await inspectBackupFile(ctxB, { backupPath: out, password: PASSWORD });
    expect(inspection.encrypted).toBe(true);
    expect(inspection.noteFiles).toBe(2);
    expect(inspection.sections.find((s) => s.id === 'user.user_note')!.count).toBe(2);
    const result = await applyInspection(ctxB, { token: inspection.token, mode: 'replace', sections: inspection.defaults.replace });
    expect(result.report.ok).toBe(true);
    for (const t of ['user_commentary', 'user_note', 'note_verse_link', 'content_verse_link', 'user_text_markup', 'collection', 'pinned_item', 'session', 'user_keybindings', 'extension_storage']) {
      expect(tableRows(b.db, t), t).toEqual(tableRows(a.db, t));
    }
    // install state is deliberately not part of a backup
    expect(tableRows(b.db, 'extensions')).toEqual([]);
    expect(readFileSync(join(dir, 'b', 'notes', 'Docs/sermon.bn'), 'utf8')).toBe('sermon');
    expect(b.db.prepare("SELECT rowid FROM user_note_fts WHERE user_note_fts MATCH 'grace'").all()).toHaveLength(1);
    expect(Backup.readUserSchemaVersion(b.sql)).toBe(1);
  });

  it('honours an extension that opts out of key-value backup, and includes its opted-in database', async () => {
    const a = newDb();
    seed(a.sql);
    // a real extension database with data
    const extRoot = join(dir, 'extroot');
    mkdirSync(join(extRoot, 'ext.pub.memory', 'db'), { recursive: true });
    const extDb = new Database(join(extRoot, 'ext.pub.memory', 'db', 'progress.db'));
    extDb.exec("CREATE TABLE t (a TEXT); INSERT INTO t VALUES ('kept'); PRAGMA journal_mode = WAL;");
    extDb.exec("INSERT INTO t VALUES ('wal-row')");
    const closed: string[] = [];
    const port: ExtensionPort = {
      listEntries: () => [
        { id: 'ext.pub.memory', manifest: { userData: { databases: { progress: { backup: true }, cache: { backup: false } } } } },
        { id: 'ext.pub.off', manifest: { userData: { backup: false } } },
      ],
      dbRoot: extRoot,
      openReadonly: (p) => { const d = new Database(p, { readonly: true }); const s = makeSql(d) as ISql & { close(): void }; s.close = () => d.close(); return s; },
      closeDatabases: (id) => { closed.push(id); },
    };
    const out = join(dir, 'ext.bbk');
    await createEncryptedBackup(ctxFor(a.sql, 'a', { extensions: port }), { destinationPath: out, includeHistory: false, password: PASSWORD });
    extDb.close();

    const b = newDb();
    const ctxB = ctxFor(b.sql, 'b', { extensions: { ...port, dbRoot: join(dir, 'extroot-b') } });
    const ins = await inspectBackupFile(ctxB, { backupPath: out, password: PASSWORD });
    expect(ins.extensions).toEqual([{ id: 'ext.pub.memory', kvRows: 1, databases: ['progress'] }]);
    await applyInspection(ctxB, { token: ins.token, mode: 'replace', sections: ins.defaults.replace });
    expect(b.db.prepare('SELECT extension_id FROM extension_storage').all()).toEqual([{ extension_id: 'ext.pub.memory' }]);
    const restored = new Database(join(dir, 'extroot-b', 'ext.pub.memory', 'db', 'progress.db'), { readonly: true });
    expect(restored.prepare('SELECT a FROM t ORDER BY rowid').all()).toEqual([{ a: 'kept' }, { a: 'wal-row' }]);
    restored.close();
    expect(closed).toEqual(['ext.pub.memory']);
  });

  it('works with the real Argon2id key derivation (in-thread fallback when no worker file exists)', async () => {
    const a = newDb();
    seed(a.sql);
    const kdf = createWorkerKdf(join(dir, 'no-worker-here'));
    const ctx = ctxFor(a.sql, 'a', { kdf });
    const out = join(dir, 'real.bbk');
    await createEncryptedBackup(ctx, { destinationPath: out, includeHistory: false, password: PASSWORD });
    const ins = await inspectBackupFile(ctx, { backupPath: out, password: PASSWORD });
    expect(ins.sections.length).toBeGreaterThan(0);
    discardInspection(ins.token);
    const header = JSON.parse(readFileSync(out).subarray(16, 16 + new DataView(readFileSync(out).buffer).getUint32(12, false)).toString());
    expect(header.slots[0].kdf).toMatchObject({ id: 'argon2id', m: 65536, t: 3, p: 1 });
  }, 30000);
});

describe('plain export', () => {
  it('is a ZIP that opens without a password and restores', async () => {
    const a = newDb();
    seed(a.sql);
    const out = join(dir, 'export.zip');
    await createPlainExport(ctxFor(a.sql, 'a'), { destinationPath: out, includeHistory: false });
    expect(Backup.sniff(readFileSync(out).subarray(0, 4))).toBe('zip');
    const b = newDb();
    const ctxB = ctxFor(b.sql, 'b');
    const ins = await inspectBackupFile(ctxB, { backupPath: out });
    expect(ins.encrypted).toBe(false);
    await applyInspection(ctxB, { token: ins.token, mode: 'merge', sections: ins.defaults.merge });
    expect(tableRows(b.db, 'user_note')).toHaveLength(2);
  });
});

describe('errors reach the caller as typed errors', () => {
  it('password required, wrong password, not a backup, damaged, newer format', async () => {
    const a = newDb();
    seed(a.sql);
    const ctx = ctxFor(a.sql, 'a');
    const out = join(dir, 'e.bbk');
    await createEncryptedBackup(ctx, { destinationPath: out, includeHistory: false, password: PASSWORD });
    await expect(inspectBackupFile(ctx, { backupPath: out })).rejects.toBeInstanceOf(Backup.PasswordRequiredError);
    await expect(inspectBackupFile({ ...ctx, kdf: async () => new Uint8Array(32) }, { backupPath: out, password: 'wrong wrong wrong' })).rejects.toBeInstanceOf(Backup.WrongPasswordError);
    const junk = join(dir, 'junk.bbk');
    writeFileSync(junk, '{"magic":"not ours"}');
    await expect(inspectBackupFile(ctx, { backupPath: junk })).rejects.toBeInstanceOf(Backup.NotABackupError);
    const bytes = readFileSync(out);
    bytes[bytes.length - 5] ^= 1;
    const damaged = join(dir, 'damaged.bbk');
    writeFileSync(damaged, bytes);
    await expect(inspectBackupFile(ctx, { backupPath: damaged, password: PASSWORD })).rejects.toBeInstanceOf(Backup.DamagedError);
    const newer = readFileSync(out);
    newer[9] = 2; // major version 2
    const newerPath = join(dir, 'newer.bbk');
    writeFileSync(newerPath, newer);
    await expect(inspectBackupFile(ctx, { backupPath: newerPath, password: PASSWORD })).rejects.toBeInstanceOf(Backup.NewerFormatError);
  });

  it('applying without a current inspection fails cleanly', async () => {
    const a = newDb();
    await expect(applyInspection(ctxFor(a.sql, 'a'), { token: 'nope', mode: 'merge', sections: [] })).rejects.toBeInstanceOf(NoActiveInspectionError);
  });

  it('a failed restore changes nothing and reports the failing row', async () => {
    const a = newDb();
    seed(a.sql);
    const out = join(dir, 'x.zip');
    await createPlainExport(ctxFor(a.sql, 'a'), { destinationPath: out, includeHistory: false });
    const b = newDb();
    b.sql.execute("INSERT INTO user_note (title, content) VALUES ('mine', 'local')");
    // A target whose user_note has a CHECK the backup rows violate: note_type must be one of the allowed values.
    const ctxB = ctxFor(b.sql, 'b');
    const ins = await inspectBackupFile(ctxB, { backupPath: out });
    b.db.exec('DROP TABLE user_text_markup; CREATE TABLE user_text_markup (markup_id INTEGER PRIMARY KEY, module_id INTEGER NOT NULL, verse_id_start INTEGER NOT NULL, verse_id_end INTEGER NOT NULL, text_start INTEGER, text_end INTEGER, color TEXT NOT NULL CHECK (color = \'nope\'), note_id INTEGER, created_date TEXT, metadata TEXT)');
    const before = tableRows(b.db, 'user_note');
    await expect(applyInspection(ctxB, { token: ins.token, mode: 'replace', sections: ins.defaults.replace })).rejects.toBeInstanceOf(Backup.RestoreError);
    expect(tableRows(b.db, 'user_note')).toEqual(before);
  });
});

describe('safety snapshot', () => {
  it('copies the database file and notes folder before restoring, and keeps the newest three', async () => {
    const a = newDb();
    seed(a.sql);
    const out = join(dir, 's.zip');
    await createPlainExport(ctxFor(a.sql, 'a'), { destinationPath: out, includeHistory: false });
    const b = newDb();
    const ctxB = ctxFor(b.sql, 'b');
    writeFileSync(ctxB.snapshot!.userDbPath, 'ENCRYPTED-DB-BYTES');
    writeNotes('b', { 'old.bn': 'local note' });
    const dirs: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ins = await inspectBackupFile({ ...ctxB, now: () => new Date(Date.UTC(2026, 0, 1 + i)) }, { backupPath: out });
      const r = await applyInspection({ ...ctxB, now: () => new Date(Date.UTC(2026, 0, 1 + i)) }, { token: ins.token, mode: 'merge', sections: ins.defaults.merge });
      dirs.push(r.snapshotDir!);
    }
    expect(readFileSync(join(dirs[4], 'user_default.db'), 'utf8')).toBe('ENCRYPTED-DB-BYTES');
    expect(readFileSync(join(dirs[4], 'notes', 'old.bn'), 'utf8')).toBe('local note');
    expect(readdirSync(join(dir, 'b', 'pre-restore'))).toHaveLength(3);
    expect(existsSync(dirs[0])).toBe(false);
  });

  it('keeps everything when asked to keep more', () => {
    for (let i = 0; i < 4; i++) createPreRestoreSnapshot({ userDbPath: join(dir, 'none'), root: join(dir, 'snaps'), keep: 10, now: () => new Date(Date.UTC(2026, 0, 1 + i)) });
    expect(readdirSync(join(dir, 'snaps'))).toHaveLength(4);
  });
});

describe('notes folder adapter', () => {
  it('lists, reads and writes inside the folder and refuses paths that escape it', async () => {
    const store = new NotesDirStore(join(dir, 'n'));
    await store.write('a/b.bn', new TextEncoder().encode('x'));
    expect(await store.listPaths()).toEqual(['a/b.bn']);
    expect(new TextDecoder().decode(await store.read('a/b.bn'))).toBe('x');
    await expect(store.write('../evil.bn', new Uint8Array())).rejects.toThrow(/escapes/);
    await expect(store.read('../../etc/passwd')).rejects.toThrow(/escapes/);
    expect(await store.readIfPresent('missing.bn')).toBeUndefined();
  });
  it('moves the folder aside without deleting it, with numbered names when needed', async () => {
    const store = new NotesDirStore(join(dir, 'n'));
    await store.write('keep.bn', new TextEncoder().encode('mine'));
    const first = await store.moveAside('2026-01-01');
    expect(readFileSync(join(first!, 'keep.bn'), 'utf8')).toBe('mine');
    expect(await store.listPaths()).toEqual([]);
    await store.write('again.bn', new TextEncoder().encode('2'));
    const second = await store.moveAside('2026-01-01');
    expect(second).not.toBe(first);
    expect(existsSync(join(second!, 'again.bn'))).toBe(true);
    expect(await notesSink(store).list()).toEqual([]);
  });
});

describe('hardening', () => {
  it('a second apply with the same token while the first is running is refused', async () => {
    const a = newDb();
    seed(a.sql);
    const out = join(dir, 'c.zip');
    await createPlainExport(ctxFor(a.sql, 'a'), { destinationPath: out, includeHistory: false });
    const b = newDb();
    const ctxB = ctxFor(b.sql, 'b');
    const ins = await inspectBackupFile(ctxB, { backupPath: out });
    const opts = { token: ins.token, mode: 'replace' as const, sections: ins.defaults.replace };
    const [first, second] = await Promise.allSettled([applyInspection(ctxB, opts), applyInspection(ctxB, opts)]);
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(NoActiveInspectionError);
    expect(tableRows(b.db, 'user_note')).toHaveLength(2);
  });

  it('a failed restore leaves the backup open so the person can try again', async () => {
    const a = newDb();
    seed(a.sql);
    const out = join(dir, 'r.zip');
    await createPlainExport(ctxFor(a.sql, 'a'), { destinationPath: out, includeHistory: false });
    const b = newDb();
    const ctxB = ctxFor(b.sql, 'b', { snapshot: { root: join(dir, 'b', 'snaps'), userDbPath: join(dir, 'b', 'user.db') } });
    const ins = await inspectBackupFile(ctxB, { backupPath: out });
    const original = b.sql.execute.bind(b.sql);
    let failNext = true;
    (b.sql as { execute: unknown }).execute = (sql: string, p?: never[]) => {
      if (failNext && sql.startsWith('INSERT INTO "user_note"')) { failNext = false; throw new Error('disk full'); }
      return original(sql, p);
    };
    await expect(applyInspection(ctxB, { token: ins.token, mode: 'replace', sections: ins.defaults.replace })).rejects.toBeInstanceOf(Backup.RestoreError);
    const again = await applyInspection(ctxB, { token: ins.token, mode: 'replace', sections: ins.defaults.replace });
    expect(again.report.ok).toBe(true);
  });

  it('replacing an extension database keeps the old file beside it and never leaves a partial one', async () => {
    const root = join(dir, 'extroot');
    mkdirSync(join(root, 'ext.a', 'db'), { recursive: true });
    writeFileSync(join(root, 'ext.a', 'db', 'p.db'), 'OLD');
    writeFileSync(join(root, 'ext.a', 'db', 'p.db-wal'), 'OLD-WAL');
    const { DesktopExtensionData } = await import('../backup/nodeAdapters');
    const closed: string[] = [];
    const data = new DesktopExtensionData({ listEntries: () => [], dbRoot: root, openReadonly: () => { throw new Error('unused'); }, closeDatabases: (id) => closed.push(id) });
    await data.writeDb('ext.a', 'p', new TextEncoder().encode('NEW'));
    expect(readFileSync(join(root, 'ext.a', 'db', 'p.db'), 'utf8')).toBe('NEW');
    expect(readFileSync(join(root, 'ext.a', 'db', 'p.db.before-restore'), 'utf8')).toBe('OLD');
    expect(readFileSync(join(root, 'ext.a', 'db', 'p.db.before-restore-wal'), 'utf8')).toBe('OLD-WAL');
    expect(existsSync(join(root, 'ext.a', 'db', 'p.db-wal'))).toBe(false);
    expect(existsSync(join(root, 'ext.a', 'db', 'p.db.restoring'))).toBe(false);
    expect(closed).toEqual(['ext.a']);
    await expect(data.writeDb('../evil', 'p', new Uint8Array())).rejects.toThrow(/Unsafe/);
  });

  it('a declared database that does not exist yet is skipped with a warning, not a failed backup', async () => {
    const a = newDb();
    seed(a.sql);
    const port: ExtensionPort = {
      listEntries: () => [{ id: 'ext.pub.memory', manifest: { userData: { databases: { notyet: { backup: true } } } } }],
      dbRoot: join(dir, 'extroot'),
      openReadonly: (p) => { const d = new Database(p, { readonly: true, fileMustExist: true }); const s = makeSql(d) as ISql & { close(): void }; s.close = () => d.close(); return s; },
      closeDatabases: () => undefined,
    };
    const summary = await createEncryptedBackup(ctxFor(a.sql, 'a', { extensions: port }), { destinationPath: join(dir, 'w.bbk'), includeHistory: false, password: PASSWORD });
    expect(summary.warnings).toEqual([{ code: 'extensionSkipped', params: { id: 'ext.pub.memory', db: 'notyet' } }]);
  });

  it('never prunes the snapshot it just wrote, even if the clock went backwards', () => {
    for (let i = 5; i >= 1; i--) createPreRestoreSnapshot({ userDbPath: join(dir, 'none'), root: join(dir, 'snaps'), keep: 3, now: () => new Date(Date.UTC(2026, i, 1)) });
    expect(readdirSync(join(dir, 'snaps'))).toContain('2026-02-01T00-00-00-000Z');
    expect(readdirSync(join(dir, 'snaps'))).toHaveLength(3);
  });
});

describe('Argon2 worker policy', () => {
  it('refuses to derive an expensive key in the main thread when the worker is missing, but does the default one', async () => {
    const kdf = createWorkerKdf(join(dir, 'no-worker'));
    const salt = new Uint8Array(16).fill(1);
    await expect(kdf('pw', { id: 'argon2id', v: 19, m: 131072, t: 2, p: 1, salt })).rejects.toThrow(/worker/);
    await expect(kdf('pw', { id: 'argon2id', v: 19, m: 19456, t: 2, p: 1, salt })).resolves.toHaveLength(32);
    await expect(kdf('pw', { id: 'argon2id', v: 19, m: 1024, t: 2, p: 1, salt })).rejects.toBeDefined();
  });
});

describe('IPC error mapping', () => {
  it('maps each typed error to its own code', async () => {
    const { mapBackupError } = await import('../../ipc/backupHandlers');
    const code = (e: unknown) => (mapBackupError(e) as IpcKnownError).code;
    expect(code(new Backup.PasswordRequiredError('x'))).toBe('backup_password_required');
    expect(code(new Backup.WrongPasswordError('x'))).toBe('backup_wrong_password');
    expect(code(new Backup.NewerFormatError('x'))).toBe('backup_newer_format');
    expect(code(new Backup.NotABackupError('x'))).toBe('backup_not_a_backup');
    expect(code(new Backup.DamagedError('x'))).toBe('backup_damaged');
    expect(code(new Backup.RestoreError('x'))).toBe('backup_restore_failed');
    expect(code(new NoActiveInspectionError())).toBe('backup_inspection_expired');
    const other = new Error('boom');
    expect(mapBackupError(other)).toBe(other);
  });
  it('enforces the minimum password length', async () => {
    const { validateBackupPassword, MIN_PASSWORD_LENGTH } = await import('../../ipc/backupHandlers');
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(validateBackupPassword('short')).not.toBeNull();
    expect(validateBackupPassword('')).not.toBeNull();
    expect(validateBackupPassword('0123456789')).toBeNull();
  });
});
