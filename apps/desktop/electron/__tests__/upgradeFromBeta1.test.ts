// @vitest-environment node
/**
 * Upgrading a real 0.1.0-beta.1 profile to this build. The fixtures under
 * test-fixtures/beta1/ were produced by running beta.1's own schema and backup
 * code (see scripts/fixtures/generate-beta1-profile.mjs).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import { Backup } from '@bible/core';
import type { ISql } from '@bible/core';
import { createMockApi } from '@bible/extension-testing/createMockApi';

import { makeSql } from '../services/__tests__/helpers/testSql';
import { BETA1_SEEDED_TABLES, beta1Statements, loadBeta1UserDb, snapshotTables } from '../services/__tests__/helpers/beta1Fixture';
import { initializeUserSchema } from '../schema/userSchema';
import { initializeExtensionSchema } from '../extensions/extensionSchema';
import { EncryptedSqliteProvider } from '../providers/EncryptedSqliteProvider';
import { SqliteProvider } from '../providers/SqliteProvider';
import { legacyMemoryDbPath, startMemoryRuntime } from '../modules/memory/runtime';
import { DEFAULT_APP_ID } from '../notifications/appId';

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const nativeSqliteAvailable = ((): boolean => {
  try {
    new SqliteProvider(':memory:', { readonly: false }).close();
    return true;
  } catch {
    return false;
  }
})();

const NEW_TABLES = ['user_data_item', 'memory_collection', 'memory_passage', 'memory_card', 'memory_attempt'];

const tableExists = (sql: ISql, name: string): boolean =>
  !!sql.queryOne("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);

function upgradeTwiceAndCheck(sql: ISql): void {
  loadBeta1UserDb(sql);
  expect(sql.queryOne<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(1);
  const before = snapshotTables(sql, BETA1_SEEDED_TABLES);
  for (const t of BETA1_SEEDED_TABLES) expect(before[t].length, `fixture seeds ${t}`).toBeGreaterThan(0);
  for (const t of NEW_TABLES) expect(tableExists(sql, t), `${t} is new in this build`).toBe(false);

  for (let launch = 1; launch <= 2; launch++) {
    expect(() => {
      initializeUserSchema(sql);
      initializeExtensionSchema(sql);
    }, `launch ${launch}`).not.toThrow();
  }

  expect(sql.queryOne<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(Backup.USER_SCHEMA_VERSION);
  for (const t of NEW_TABLES) expect(tableExists(sql, t), t).toBe(true);
  // No beta.1 row was lost or altered.
  const after = snapshotTables(sql, BETA1_SEEDED_TABLES);
  for (const t of BETA1_SEEDED_TABLES) {
    if (t === 'extensions') continue; // gains columns; checked below
    expect(after[t], t).toEqual(before[t]);
  }
  const ext = sql.queryOne<Record<string, unknown>>("SELECT * FROM extensions WHERE id = 'ext.bible-app.word-count'");
  expect(ext).toMatchObject({ version: '1.0.0', install_path: '/x/ext.bible-app.word-count', enabled: 1 });
  expect(sql.queryAll('PRAGMA foreign_key_check')).toEqual([]);
  // FTS still finds beta.1 notes (triggers/FTS survived).
  expect(sql.queryAll("SELECT rowid FROM user_note_fts WHERE user_note_fts MATCH 'grace'").length).toBe(1);
  // New writes work on the upgraded tables, including a highlight with a hex colour.
  sql.execute("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (1, 1001001, 1001001, '#112233')");
  sql.execute("INSERT INTO user_data_item (owner_uuid, collection, item_key, value) VALUES ('app:keyword-marks', 'c', 'k', '{}')");
}

describe.skipIf(!nativeSqliteAvailable)('beta.1 user database upgrade', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kth-upgrade-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('fixture really is a beta.1 database (fixture sanity)', () => {
    const stmts = beta1Statements().join('\n');
    expect(stmts).toContain('CREATE TABLE user_note');
    expect(stmts).not.toContain('user_data_item');
    expect(stmts).not.toContain('memory_');
  });

  it('opens and upgrades twice without losing data (plain SQLite)', () => {
    const raw = new Database(join(dir, 'user.db'));
    raw.pragma('foreign_keys = ON');
    upgradeTwiceAndCheck(makeSql(raw));
    raw.close();
  });

  it('opens and upgrades twice through the encrypted provider the app uses', () => {
    const key = 'a'.repeat(64);
    const path = join(dir, 'user_default.db');
    const first = new EncryptedSqliteProvider(path, key);
    loadBeta1UserDb(first);
    first.close();
    // Reopen as a later launch would, then upgrade.
    const reopened = new EncryptedSqliteProvider(path, key);
    try {
      const before = snapshotTables(reopened, BETA1_SEEDED_TABLES);
      initializeUserSchema(reopened);
      initializeExtensionSchema(reopened);
      initializeUserSchema(reopened);
      expect(reopened.queryOne<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(Backup.USER_SCHEMA_VERSION);
      const after = snapshotTables(reopened, BETA1_SEEDED_TABLES);
      for (const t of BETA1_SEEDED_TABLES) if (t !== 'extensions') expect(after[t], t).toEqual(before[t]);
      for (const t of NEW_TABLES) expect(tableExists(reopened, t), t).toBe(true);
    } finally {
      reopened.close();
    }
  });

  it('extension schema adds the columns beta.1 lacked and keeps extension_storage', () => {
    const raw = new Database(join(dir, 'user.db'));
    const sql = makeSql(raw);
    loadBeta1UserDb(sql);
    const cols = () => (sql.queryAll("SELECT name FROM pragma_table_info('extensions')") as { name: string }[]).map((c) => c.name);
    const beforeCols = cols();
    initializeExtensionSchema(sql);
    const afterCols = cols();
    for (const c of beforeCols) expect(afterCols).toContain(c);
    expect(sql.queryOne("SELECT value FROM extension_storage WHERE extension_id = 'ext.bible-app.word-count' AND key = 'lastRun'")).toEqual({ value: '{"n":3}' });
    raw.close();
  });
});

/**
 * The old Scripture Memory EXTENSION was not bundled in beta.1, so there is no
 * real beta.1 memory.db. This uses the synthetic v7 database the importer is
 * specified against (same builder as memory.test.ts), on an upgraded profile.
 */
describe.skipIf(!nativeSqliteAvailable)('memory import-once on an upgraded beta.1 profile', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kth-upgrade-mem-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function legacyV7(path: string): void {
    const db = new Database(path);
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '7');
      CREATE TABLE collection (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE passage (id INTEGER PRIMARY KEY, collection_id INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
        module_id TEXT NOT NULL, start_verse_id INTEGER NOT NULL, end_verse_id INTEGER NOT NULL, reference TEXT NOT NULL,
        verse_count INTEGER NOT NULL, added_at INTEGER NOT NULL, answer_mode TEXT, deleted_at INTEGER, recite_on INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE card (id INTEGER PRIMARY KEY, passage_id INTEGER NOT NULL REFERENCES passage(id) ON DELETE CASCADE, rung TEXT NOT NULL,
        state TEXT NOT NULL, interval_step INTEGER NOT NULL DEFAULT -1, due_at INTEGER, streak INTEGER NOT NULL DEFAULT 0,
        last_score REAL, progress_reset_at INTEGER);
      CREATE TABLE attempt (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE, at INTEGER NOT NULL,
        score REAL NOT NULL, correct_first INTEGER NOT NULL, total_steps INTEGER NOT NULL, replay INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER, tier INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO collection VALUES (1, 'Default', 1);
      INSERT INTO passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
        VALUES (7, 1, 'KJV', 43003016, 43003016, 'John 3:16', 1, 2);
      INSERT INTO card (id, passage_id, rung, state) VALUES (70, 7, 'blanks', 'new');
      INSERT INTO attempt (id, card_id, at, score, correct_first, total_steps) VALUES (700, 70, 3, 1, 1, 1);
    `);
    db.close();
  }

  function upgradedProfile(): { raw: Database.Database; userDb: ISql } {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    const userDb = makeSql(raw);
    loadBeta1UserDb(userDb);
    initializeUserSchema(userDb);
    initializeExtensionSchema(userDb);
    return { raw, userDb };
  }

  const start = (userDb: ISql, extensionsRoot: string) =>
    startMemoryRuntime({
      getUserDb: async () => userDb,
      legacyDbPath: legacyMemoryDbPath(extensionsRoot),
      openReadOnly: (p) => {
        const d = new Database(p, { readonly: true, fileMustExist: true });
        return Object.assign(makeSql(d), { close: () => d.close() }) as ISql;
      },
      bible: createMockApi().bible,
      emit: () => undefined,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

  it('imports an old extension memory.db exactly once and leaves beta.1 data alone', async () => {
    const root = join(dir, 'extensions');
    mkdirSync(join(root, 'ext.bible-app.scripture-memory', 'db'), { recursive: true });
    legacyV7(legacyMemoryDbPath(root));
    const { raw, userDb } = upgradedProfile();
    const notesBefore = snapshotTables(userDb, ['user_note', 'session']);

    const first = await start(userDb, root);
    expect(first.importResult).toMatchObject({ status: 'imported', sourceVersion: 7 });
    expect((await first.service.getPlan()).passages.map((p) => p.passage.reference)).toEqual(['John 3:16']);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM memory_import WHERE source LIKE '%scripture-memory%'").get()).toEqual({ n: 1 });
    first.dispose();

    const second = await start(userDb, root);
    expect(second.importResult).toEqual({ status: 'already-recorded', recorded: 'imported' });
    expect((await second.service.getPlan()).passages).toHaveLength(1);
    second.dispose();
    expect(snapshotTables(userDb, ['user_note', 'session'])).toEqual(notesBefore);
  });

  it('with no old extension database: no-source and nothing recorded', async () => {
    const { raw, userDb } = upgradedProfile();
    const rt = await start(userDb, join(dir, 'none'));
    expect(rt.importResult).toEqual({ status: 'no-source' });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM memory_import').get()).toEqual({ n: 0 });
    rt.dispose();
  });
});

describe('release identity guards', () => {
  const desktopDir = join(__dirname, '..', '..');
  const repoRoot = join(desktopDir, '..', '..');
  const OFFICIAL = 'com.keepthyheart.bible.desktop';
  const BETA1_NSIS_GUID = 'd159dead-52c2-56b9-8a81-6c170917f41d'; // UUID v5 of com.bibledesktopapp.app

  it('keeps the package name, so userData stays where beta.1 put it', () => {
    const pkg = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    // Electron derives userData from productName || name. Adding a productName
    // (or renaming the package) would move every user's profile.
    expect(pkg.name).toBe('@bible/desktop');
    expect(pkg.productName).toBeUndefined();
  });

  function loadBuilderConfig(env: Record<string, string | undefined>): { appId: string; nsis: { guid?: string } } {
    const keys = ['BIBLE_APP_ID', 'BIBLE_PRODUCT_NAME'];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    try {
      const req = createRequire(import.meta.url);
      const path = join(desktopDir, 'electron-builder.branding.cjs');
      delete req.cache[path];
      return req(path);
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }

  it('official build: new appId, installer GUID pinned to the one beta.1 shipped with', () => {
    const cfg = loadBuilderConfig({});
    expect(cfg.appId).toBe(OFFICIAL);
    expect(cfg.nsis.guid).toBe(BETA1_NSIS_GUID);
  });

  it('BIBLE_APP_ID builds (neutral profile, forks) keep their own derived GUID', () => {
    const cfg = loadBuilderConfig({ BIBLE_APP_ID: 'com.example.neutral' });
    expect(cfg.appId).toBe('com.example.neutral');
    expect(cfg.nsis.guid).toBeUndefined();
  });

  it('every copy of the appId agrees with branding.json', () => {
    const branding = JSON.parse(readFileSync(join(repoRoot, 'admin', 'brand', 'branding.json'), 'utf8')) as { appId: string };
    expect(branding.appId).toBe(OFFICIAL);
    expect(DEFAULT_APP_ID).toBe(branding.appId);
    const viteConfig = readFileSync(join(desktopDir, 'electron.vite.config.ts'), 'utf8');
    expect(viteConfig).toContain(`'${branding.appId}'`);
    expect(readFileSync(join(desktopDir, 'electron-builder.branding.cjs'), 'utf8')).toContain(`'${branding.appId}'`);
  });
});
