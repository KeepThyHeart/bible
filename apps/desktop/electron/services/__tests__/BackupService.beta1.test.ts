// @vitest-environment node
/**
 * A backup written by 0.1.0-beta.1 (formatVersion 1.0, userSchemaVersion 1,
 * produced by beta.1's own BackupService) must inspect and restore in this
 * build in both Merge and Replace modes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Backup } from '@bible/core';
import type { ISql } from '@bible/core';
import { initializeUserSchema } from '../../schema/userSchema';
import { initializeExtensionSchema } from '../../extensions/extensionSchema';
import { ensureContentVerseLinkTable } from '../../utils/verseIndexing';
import { makeSql } from './helpers/testSql';
import { beta1Path, loadBeta1UserDb } from './helpers/beta1Fixture';
import { inspectBackupFile, applyInspection } from '../BackupService';
import type { BackupContext } from '../BackupService';

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, dialog: {} }));
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const APP = { name: 'Keep Thy Heart', version: '1.0.0-rc.1', platform: 'test' };
const BACKUP = beta1Path('beta1-backup.zip');

let dir: string;
const dbs: Database.Database[] = [];

function headDb(): { db: Database.Database; sql: ISql } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  dbs.push(db);
  const sql = makeSql(db);
  initializeUserSchema(sql);
  initializeExtensionSchema(sql);
  ensureContentVerseLinkTable(sql);
  return { db, sql };
}

function ctxFor(sql: ISql, name: string): BackupContext {
  const notesDir = join(dir, name, 'notes');
  mkdirSync(notesDir, { recursive: true });
  return { sql, appInfo: APP, notesDir, snapshot: { root: join(dir, name, 'pre-restore'), userDbPath: join(dir, name, 'user.db') } };
}

const rows = (db: Database.Database, t: string) => db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all();
const count = (db: Database.Database, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kth-beta1-backup-')); });
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('restoring a beta.1 backup', () => {
  it('the fixture is a beta.1 backup', () => {
    const manifest = JSON.parse(readFileSync(beta1Path('beta1-backup.manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ formatVersion: '1.0', userSchemaVersion: 1, app: { version: '0.1.0-beta.1' } });
  });

  it('inspects without error and reports an older schema, not a refusal', async () => {
    const { sql } = headDb();
    const ins = await inspectBackupFile(ctxFor(sql, 'a'), { backupPath: BACKUP });
    expect(ins.encrypted).toBe(false);
    expect(ins.noteFiles).toBe(1);
    expect(ins.sections.find((s) => s.id === 'user.user_note')!.count).toBe(3);
    expect(ins.warnings.map((w) => w.code)).toContain('olderSchema');
    expect(ins.warnings.map((w) => w.code)).not.toContain('columnsDropped');
    expect(Backup.USER_SCHEMA_VERSION).toBeGreaterThan(1);
  });

  it('Replace restores every beta.1 row into a current-schema profile and leaves memory_* alone', async () => {
    const { db, sql } = headDb();
    db.exec(`
      INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 1);
      INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
        VALUES (1, 1, 'KJV', 19023001, 19023001, 'Psalm 23:1', 1, 1);
    `);
    const memoryBefore = rows(db, 'memory_passage');
    const ctx = ctxFor(sql, 'a');
    const ins = await inspectBackupFile(ctx, { backupPath: BACKUP });
    const result = await applyInspection(ctx, { token: ins.token, mode: 'replace', sections: ins.defaults.replace });
    expect(result.report.ok).toBe(true);

    const expected = new Database(':memory:');
    dbs.push(expected);
    loadBeta1UserDb(makeSql(expected));
    for (const t of ['user_commentary', 'user_note', 'note_verse_link', 'content_verse_link', 'user_text_markup', 'collection', 'pinned_item', 'user_keybindings', 'extension_storage']) {
      expect(rows(db, t), t).toEqual(rows(expected, t));
    }
    // Both sessions, including the autosave, came across.
    expect(count(db, 'session')).toBe(2);
    const auto = db.prepare('SELECT session_data FROM session WHERE is_autosave = 1').get() as { session_data: string };
    expect(JSON.parse(auto.session_data).ui.preferences.theme).toBe('midnight');
    expect(rows(db, 'memory_passage')).toEqual(memoryBefore);
    expect(readFileSync(join(dir, 'a', 'notes', 'Docs/sermon.bn'), 'utf8')).toContain('Sermon');
    expect(Backup.readUserSchemaVersion(sql)).toBe(Backup.USER_SCHEMA_VERSION);
    expect(db.prepare("SELECT rowid FROM user_note_fts WHERE user_note_fts MATCH 'grace'").all()).toHaveLength(1);
  });

  it('Merge adds the beta.1 rows to a profile that already has its own, keeping both', async () => {
    const { db, sql } = headDb();
    sql.execute("INSERT INTO user_note (title, content, note_type) VALUES ('Mine', 'already here', 'document')");
    const ctx = ctxFor(sql, 'b');
    const ins = await inspectBackupFile(ctx, { backupPath: BACKUP });
    const result = await applyInspection(ctx, { token: ins.token, mode: 'merge', sections: ins.defaults.merge });
    expect(result.report.ok).toBe(true);
    const titles = (db.prepare('SELECT title FROM user_note ORDER BY note_id').all() as { title: string }[]).map((r) => r.title);
    expect(titles).toEqual(expect.arrayContaining(['Mine', 'John 3:16', 'Sermon on grace', 'Outline']));
    expect(count(db, 'user_note')).toBe(4);
    expect(count(db, 'user_text_markup')).toBe(2);
    expect(existsSync(join(dir, 'b', 'notes', 'Docs/sermon.bn'))).toBe(true);
    expect(Backup.readUserSchemaVersion(sql)).toBe(Backup.USER_SCHEMA_VERSION);
  });
});
