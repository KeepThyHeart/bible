import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SqliteProvider } from '../providers/SqliteProvider';
import { initializeMainDatabase } from './initMainDatabase';

/**
 * These tests drive real SQLite, so they need the native binding compiled for
 * the Node.js ABI vitest runs under. The repo normally keeps it compiled for
 * Electron (via `npx electron-rebuild`, required by `npm run dev` and the e2e
 * suite), so in a default checkout the binding fails to load here. Skip rather
 * than fail - run `npm rebuild better-sqlite3-multiple-ciphers` to exercise
 * these, then `npx electron-rebuild -f -w better-sqlite3-multiple-ciphers` to
 * restore the Electron build.
 */
const nativeSqliteAvailable = ((): boolean => {
  try {
    // The binding is loaded lazily, so requiring the package is not enough to
    // surface an ABI mismatch - actually open a database.
    const probe = new SqliteProvider(':memory:', { readonly: false });
    probe.close();
    return true;
  } catch {
    return false;
  }
})();

/**
 * Regression test for the module_type CHECK constraint bug: a main.db created
 * before `topical_index`/`cross_reference` were recognised module types is
 * left with a stale `CHECK (module_type IN (...))` that `CREATE TABLE IF NOT
 * EXISTS` never widens. Registering a topical_index or cross_reference module
 * against such a database throws SQLITE_CONSTRAINT until migration 005 (the
 * 12-step table rebuild in `applyMigration005`) runs.
 *
 * This builds a fixture that matches what the real shipped
 * `apps/desktop/data/main.db` looked like: schema version 3.0.0, the
 * narrow CHECK, and the columns migrations 002/003 already added.
 */
describe.skipIf(!nativeSqliteAvailable)('initMainDatabase migration 005 (widen module_type CHECK)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bible-mainDb-migration-'));
    dbPath = join(tmpDir, 'main.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createLegacyFixture(): void {
    const db = new SqliteProvider(dbPath, { readonly: false });

    // Old (pre-widen) module_metadata, including the columns migrations
    // 002 (module manager) and 003 (cross-reference flag) already add, since
    // the real shipped main.db had already run those.
    db.execute(`
      CREATE TABLE module_metadata (
        module_id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_type TEXT NOT NULL,
        module_name TEXT NOT NULL,
        abbreviation TEXT,
        version TEXT,
        language_code TEXT,
        installed_date TEXT DEFAULT CURRENT_TIMESTAMP,
        last_updated TEXT,
        database_path TEXT NOT NULL,
        size_bytes INTEGER,
        is_indexed INTEGER DEFAULT 0,
        last_indexed_date TEXT,
        features TEXT,
        sword_metadata TEXT,
        metadata TEXT,
        repository_id INTEGER,
        update_available INTEGER DEFAULT 0,
        last_used_date TEXT,
        usage_count INTEGER DEFAULT 0,
        user_hidden INTEGER DEFAULT 0,
        is_cross_reference_module INTEGER DEFAULT 0,
        CHECK (module_type IN ('bible', 'commentary', 'dictionary', 'book', 'devotional', 'lexicon')),
        CHECK (is_indexed IN (0, 1))
      )
    `);
    db.execute('CREATE INDEX idx_module_type ON module_metadata(module_type)');
    db.execute('CREATE UNIQUE INDEX idx_module_metadata_path_unique ON module_metadata(database_path)');

    // A pre-existing row that must survive the rebuild.
    db.execute(
      `INSERT INTO module_metadata (module_type, module_name, abbreviation, database_path)
       VALUES ('bible', 'King James Version', 'KJV', 'modules/bible_kjv.db')`
    );

    // module_update references module_metadata - the rebuild must not break it.
    db.execute(`
      CREATE TABLE module_update (
        update_id INTEGER PRIMARY KEY AUTOINCREMENT,
        module_id INTEGER NOT NULL,
        current_version TEXT NOT NULL,
        available_version TEXT NOT NULL,
        download_url TEXT NOT NULL,
        FOREIGN KEY (module_id) REFERENCES module_metadata(module_id) ON DELETE CASCADE
      )
    `);

    db.execute(`
      CREATE TABLE setting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        metadata TEXT
      )
    `);
    db.execute(`INSERT INTO setting (key, value) VALUES ('_schema', '3.0.0')`);

    db.execute(`
      CREATE TABLE schema_version (
        version_id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_number TEXT NOT NULL,
        applied_date TEXT DEFAULT CURRENT_TIMESTAMP,
        migration_script_up TEXT,
        migration_script_down TEXT,
        notes TEXT,
        metadata TEXT
      )
    `);

    // module_repository is touched by migration 004; must exist beforehand
    // just like it does on a real database that already ran migration 002.
    db.execute(`
      CREATE TABLE module_repository (
        repository_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        is_enabled INTEGER DEFAULT 1
      )
    `);

    // bible_book is queried elsewhere during init; not required for this
    // migration chain but harmless to omit since ensureSchemaUpToDate only
    // touches setting/module_metadata/module_repository/schema_version.
    db.close();
  }

  it('rebuilds module_metadata so topical_index/cross_reference rows can be inserted', () => {
    createLegacyFixture();

    // Reproduces the real bug: before migration 005 existed, this threw
    // SQLITE_CONSTRAINT the first time a topical_index/cross_reference row
    // was inserted. It must now complete cleanly.
    let initResult: SqliteProvider | undefined;
    expect(() => { initResult = initializeMainDatabase(dbPath); }).not.toThrow();
    initResult?.close();

    const db = new SqliteProvider(dbPath, { readonly: false });
    try {
      const schema = db.queryOne<{ value: string }>(`SELECT value FROM setting WHERE key = '_schema'`);
      expect(schema?.value).toBe('5.0.0');

      const tableSql = db.queryOne<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'module_metadata'`
      );
      expect(tableSql?.sql).toContain("'topical_index'");
      expect(tableSql?.sql).toContain("'cross_reference'");
      expect(tableSql?.sql).toContain("'tag_graph'");

      // Pre-existing row survived the rebuild.
      const kjv = db.queryOne<{ module_name: string }>(
        `SELECT module_name FROM module_metadata WHERE abbreviation = 'KJV'`
      );
      expect(kjv?.module_name).toBe('King James Version');

      // The case that matters: these inserts must not throw SQLITE_CONSTRAINT.
      expect(() =>
        db.execute(
          `INSERT INTO module_metadata (module_type, module_name, abbreviation, database_path)
           VALUES ('topical_index', 'Nave''s Topical Index', 'NAVE', 'modules/topical_nave.db')`
        )
      ).not.toThrow();

      expect(() =>
        db.execute(
          `INSERT INTO module_metadata (module_type, module_name, abbreviation, database_path)
           VALUES ('cross_reference', 'Treasury of Scripture Knowledge', 'TSK', 'modules/xref_tsk.db')`
        )
      ).not.toThrow();

      const registered = db.queryAll<{ module_type: string }>(
        `SELECT module_type FROM module_metadata WHERE module_type IN ('topical_index', 'cross_reference') ORDER BY module_type`
      );
      expect(registered.map(r => r.module_type)).toEqual(['cross_reference', 'topical_index']);

      // An out-of-set value must still be rejected - the CHECK was widened,
      // not dropped.
      expect(() =>
        db.execute(
          `INSERT INTO module_metadata (module_type, module_name, abbreviation, database_path)
           VALUES ('not_a_real_type', 'Bogus', 'BOGUS', 'modules/bogus.db')`
        )
      ).toThrow();

      // Indexes survived the rebuild.
      const indexes = db.queryAll<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'module_metadata'`
      );
      expect(indexes.map(i => i.name)).toEqual(
        expect.arrayContaining(['idx_module_type', 'idx_module_metadata_path_unique'])
      );

      // The child table's foreign key relationship to module_metadata still
      // resolves (the rebuild ran with foreign_keys back on afterwards).
      const fkCheck = db.queryAll('PRAGMA foreign_key_check');
      expect(fkCheck).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('is idempotent: running initializeMainDatabase again does not re-rebuild or error', () => {
    createLegacyFixture();
    initializeMainDatabase(dbPath).close();

    // Second run against the now-migrated database must be a no-op that
    // still succeeds (matches how ensureSchemaUpToDate/applyMigrations
    // guard every other legacy migration).
    expect(() => initializeMainDatabase(dbPath).close()).not.toThrow();

    const db = new SqliteProvider(dbPath, { readonly: false });
    try {
      const schema = db.queryOne<{ value: string }>(`SELECT value FROM setting WHERE key = '_schema'`);
      expect(schema?.value).toBe('5.0.0');

      const versionRows = db.queryAll<{ version_number: string }>(
        `SELECT version_number FROM schema_version WHERE version_number = '5.0.0'`
      );
      // Only recorded once even though init ran twice.
      expect(versionRows.length).toBe(1);
    } finally {
      db.close();
    }
  });
});

/**
 * Regression test for the "Unknown" book list.
 *
 * `resolveMainDbPath()` seeds the bundled `main.db` into user data only when no
 * file is there yet. A user-data `main.db` left behind schema-only by an
 * earlier build therefore defeats the seed forever: the file exists, so the
 * copy is skipped, and `bible_book` stays empty. Every book name then falls
 * through `bibleHandlers`' `book?.bookName ?? 'Unknown'`.
 *
 * `ensureReferenceData()` closes that hole by copying the reference tables into
 * whatever database it is handed - without disturbing the user-owned rows that
 * the stale file may have accumulated by then.
 */
describe.skipIf(!nativeSqliteAvailable)('initMainDatabase reference seeding', () => {
  let tmpDir: string;
  let dbPath: string;
  let seedPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bible-mainDb-seed-'));
    dbPath = join(tmpDir, 'main.db');
    seedPath = join(tmpDir, 'bundled.db');
    createSeedTemplate();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * A miniature stand-in for the shipped template: the same reference tables,
   * a handful of books rather than 66, and none of the user-owned state.
   */
  function createSeedTemplate(): void {
    const seed = initializeMainDatabase(seedPath);
    try {
      seed.execute(
        `INSERT INTO bible_book (book_id, book_number, book_name, book_abbreviation, testament, book_group, chapter_count, verse_count)
         VALUES (1, 1, 'Genesis', 'Gen', 'OT', 'Pentateuch', 50, 1533),
                (2, 43, 'John', 'John', 'NT', 'Gospels', 21, 879),
                (3, 66, 'Revelation', 'Rev', 'NT', 'Apocalyptic', 22, 404)`
      );
      seed.execute(
        `INSERT INTO chapter_info (book_id, chapter, verse_count, first_absolute_id, last_absolute_id)
         VALUES (1, 1, 31, 1, 31), (2, 3, 36, 26050, 26085)`
      );
      seed.execute(
        `INSERT INTO bible_verse_ref (verse_id, absolute_id, book_id, chapter, verse, is_book_start)
         VALUES (1001001, 1, 1, 1, 1, 1), (43003016, 26065, 2, 3, 16, 0)`
      );
    } finally {
      seed.close();
    }
  }

  it('fills an empty reference space from the bundled template', () => {
    // A schema-only database, exactly what an abandoned earlier build leaves.
    initializeMainDatabase(dbPath).close();

    const before = new SqliteProvider(dbPath, { readonly: false });
    try {
      expect(before.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM bible_book')?.count).toBe(0);
    } finally {
      before.close();
    }

    initializeMainDatabase(dbPath, seedPath).close();

    const db = new SqliteProvider(dbPath, { readonly: false });
    try {
      const books = db.queryAll<{ book_number: number; book_name: string }>(
        'SELECT book_number, book_name FROM bible_book ORDER BY book_number'
      );
      expect(books).toEqual([
        { book_number: 1, book_name: 'Genesis' },
        { book_number: 43, book_name: 'John' },
        { book_number: 66, book_name: 'Revelation' }
      ]);

      expect(db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM chapter_info')?.count).toBe(2);
      expect(db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM bible_verse_ref')?.count).toBe(2);

      // The FKs from the child tables to bible_book still resolve.
      expect(db.queryAll('PRAGMA foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('preserves user-owned rows the stale database had accumulated', () => {
    initializeMainDatabase(dbPath).close();

    const stale = new SqliteProvider(dbPath, { readonly: false });
    try {
      stale.execute(
        `INSERT INTO module_repository (repository_id, name, abbreviation, url, type, is_enabled, priority)
         VALUES (1, 'My Repository', 'mine', 'https://example.invalid/', 'third_party', 1, 50)`
      );
      stale.execute(`INSERT INTO setting (key, value) VALUES ('theme', 'sepia')`);
    } finally {
      stale.close();
    }

    initializeMainDatabase(dbPath, seedPath).close();

    const db = new SqliteProvider(dbPath, { readonly: false });
    try {
      // Reference space repaired...
      expect(db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM bible_book')?.count).toBe(3);

      // ...and nothing user-owned was overwritten. The template has neither of
      // these rows, so a wholesale file copy would have dropped both.
      const repo = db.queryOne<{ name: string }>('SELECT name FROM module_repository WHERE repository_id = 1');
      expect(repo?.name).toBe('My Repository');

      const theme = db.queryOne<{ value: string }>(`SELECT value FROM setting WHERE key = 'theme'`);
      expect(theme?.value).toBe('sepia');
    } finally {
      db.close();
    }
  });

  it('leaves an already-populated reference space untouched', () => {
    initializeMainDatabase(dbPath, seedPath).close();

    const edited = new SqliteProvider(dbPath, { readonly: false });
    try {
      edited.execute(`UPDATE bible_book SET book_name = 'Edited' WHERE book_number = 1`);
    } finally {
      edited.close();
    }

    // A second run must not re-copy over the existing rows.
    initializeMainDatabase(dbPath, seedPath).close();

    const db = new SqliteProvider(dbPath, { readonly: false });
    try {
      const book = db.queryOne<{ book_name: string }>('SELECT book_name FROM bible_book WHERE book_number = 1');
      expect(book?.book_name).toBe('Edited');
      expect(db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM bible_book')?.count).toBe(3);
    } finally {
      db.close();
    }
  });

  it('leaves the database usable when no template is available', () => {
    expect(() => initializeMainDatabase(dbPath, join(tmpDir, 'does-not-exist.db')).close()).not.toThrow();

    const db = new SqliteProvider(dbPath, { readonly: false });
    try {
      expect(db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM bible_book')?.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
