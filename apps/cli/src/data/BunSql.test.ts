/**
 * The SQLite layer.
 *
 * The interesting tests here are not "does a SELECT work" — they are the four
 * places `bun:sqlite` and `better-sqlite3` disagree, because core's
 * repositories were written against the latter and would fail silently against
 * the former. Each has a test that would pass on a naive pass-through adapter
 * and fail on the real difference.
 *
 * Run: bun test
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BibleBookRepository,
  BibleRepository,
  BookRepository,
  CommentaryRepository,
  CrossReferenceRepository,
  DictionaryRepository,
  ModuleMetadataRepository,
  TopicalIndexRepository,
  isReadOnlyDatabaseError,
} from '@bible/core';

import { BunSql } from './BunSql';

const MODULES = join(import.meta.dir, '..', '..', '..', '..', 'data', 'modules');
const modulePath = (name: string) => join(MODULES, name);
const has = (name: string) => existsSync(modulePath(name));

const KJV = 'bible_kjv.db';
const JOHN_3_16 = 43003016;

const scratch = mkdtempSync(join(tmpdir(), 'bunsql-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A writable database, for the paths a read-only module cannot exercise. */
function writable(name: string): BunSql {
  return new BunSql(join(scratch, name), { create: true });
}

describe('divergences from better-sqlite3', () => {
  test('queryOne returns undefined, not null, when there is no row', () => {
    const sql = writable('empty.db');
    sql.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)');

    const row = sql.queryOne<{ id: number }>('SELECT * FROM t WHERE id = ?', [999]);

    // bun:sqlite hands back null here. ISql promises undefined and callers
    // written against core may test for it exactly.
    expect(row).toBeUndefined();
    expect(row).not.toBeNull();
    sql.close();
  });

  test('queryAll returns an empty array when there is no row', () => {
    const sql = writable('empty-all.db');
    sql.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    expect(sql.queryAll('SELECT * FROM t')).toEqual([]);
    sql.close();
  });

  test('$name object parameters bind with either key spelling', () => {
    const sql = writable('named.db');
    sql.execute('CREATE TABLE t (name TEXT)');
    sql.execute('INSERT INTO t VALUES (?)', ['found']);

    expect(sql.queryOne<{ name: string }>('SELECT name FROM t WHERE name = $name', { name: 'found' })).toEqual({
      name: 'found',
    });
    expect(sql.queryOne<{ name: string }>('SELECT name FROM t WHERE name = $name', { $name: 'found' })).toEqual({
      name: 'found',
    });
    sql.close();
  });

  test(':name and @name object parameters throw rather than silently matching nothing', () => {
    const sql = writable('named-bad.db');
    sql.execute('CREATE TABLE t (name TEXT)');
    sql.execute('INSERT INTO t VALUES (?)', ['found']);

    // This is the dangerous case: bun:sqlite binds nothing and returns no row,
    // so without the guard the caller sees "not found" instead of an error.
    expect(() => sql.queryOne('SELECT * FROM t WHERE name = :name', { name: 'found' })).toThrow(
      /only the `\$name` placeholder/,
    );
    expect(() => sql.queryOne('SELECT * FROM t WHERE name = @name', { name: 'found' })).toThrow(
      /only the `\$name` placeholder/,
    );
    sql.close();
  });

  test('a colon inside a string literal is not mistaken for a placeholder', () => {
    const sql = writable('colon.db');
    sql.execute('CREATE TABLE t (name TEXT)');
    sql.execute('INSERT INTO t VALUES (?)', ['a:b']);

    expect(
      sql.queryOne<{ name: string }>("SELECT name FROM t WHERE name = 'a:b' AND name = $name", { name: 'a:b' }),
    ).toEqual({ name: 'a:b' });
    sql.close();
  });
});

describe('read-only behaviour', () => {
  test.skipIf(!has(KJV))(
    'a refused write is recognised by core isReadOnlyDatabaseError',
    () => {
      // Load-bearing: BibleRepository.buildBookIndex() writes an index
      // into the module file and degrades quietly when this returns true. If
      // the error wrapper lost the message or code, the CLI would throw on
      // every proximity search instead.
      const sql = new BunSql(modulePath(KJV), { readonly: true });
      let caught: unknown;
      try {
        sql.execute('CREATE TABLE should_not_exist (x)');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      expect(isReadOnlyDatabaseError(caught)).toBe(true);
      sql.close();
    },
  );

  test.skipIf(!has(KJV))('immutable=1 opens a WAL-mode module', () => {
    // Shipped modules are in WAL mode, so a plain read-only open wants the
    // -wal sidecar.
    const journal = new BunSql(modulePath(KJV), { readonly: true });
    expect(journal.queryOne<{ journal_mode: string }>('PRAGMA journal_mode')?.journal_mode).toBe(
      'wal',
    );
    journal.close();

    const sql = new BunSql(modulePath(KJV), { readonly: true, immutable: true });
    const count = sql.queryOne<{ n: number }>('SELECT count(*) AS n FROM sqlite_master');
    expect(count?.n).toBeGreaterThan(0);
    sql.close();
  });
});

describe('transactions', () => {
  test('commits, returns the callback value, and rolls back on throw', () => {
    const sql = writable('tx.db');
    sql.execute('CREATE TABLE t (name TEXT)');

    expect(
      sql.transaction(() => {
        sql.execute('INSERT INTO t VALUES (?)', ['kept']);
        return 42;
      }),
    ).toBe(42);

    expect(() =>
      sql.transaction(() => {
        sql.execute('INSERT INTO t VALUES (?)', ['dropped']);
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(sql.queryAll<{ name: string }>('SELECT name FROM t').map((r) => r.name)).toEqual([
      'kept',
    ]);
    sql.close();
  });
});

describe('lifecycle', () => {
  test('a constructor that fails does not leak an open handle', () => {
    // `new Database` succeeds on a non-database file; the failure surfaces at
    // the first PRAGMA. If the handle leaked, the file would stay locked and
    // could not even be renamed out of the way — which is precisely what
    // state.db corruption recovery has to do.
    const path = join(scratch, 'not-a-database.db');
    writeFileSync(path, 'this is definitely not SQLite');

    expect(() => new BunSql(path, { create: true })).toThrow();

    // Proof the handle was released: on Windows a rename fails while a handle
    // is open, and unlink fails on POSIX-with-a-lock in the same situation.
    const moved = `${path}.moved`;
    expect(() => renameSync(path, moved)).not.toThrow();
    rmSync(moved, { force: true });
  });


  test('execute reports changes and lastInsertRowId', () => {
    const sql = writable('exec.db');
    sql.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');

    const result = sql.execute('INSERT INTO t (name) VALUES (?)', ['x']);
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowId).toBe(1);
    expect(typeof result.lastInsertRowId).toBe('number');
    sql.close();
  });

  test('isOpen, close, and getDatabasePath', () => {
    const path = join(scratch, 'lifecycle.db');
    const sql = new BunSql(path, { create: true });
    expect(sql.isOpen()).toBe(true);
    expect(sql.getDatabasePath()).toBe(path);
    sql.close();
    expect(sql.isOpen()).toBe(false);
    sql.close(); // idempotent
  });

  test('the statement cache stays correct past its eviction limit', () => {
    const sql = writable('cache.db');
    sql.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    sql.execute('INSERT INTO t (id) VALUES (1)');

    // Distinct SQL text each time, to push well past STATEMENT_CACHE_LIMIT.
    for (let i = 0; i < 400; i += 1) {
      const row = sql.queryOne<{ n: number }>(`SELECT ${i} AS n, id FROM t WHERE id = ?`, [1]);
      expect(row?.n).toBe(i);
    }
    // A statement prepared before eviction still works afterwards.
    expect(sql.queryOne<{ id: number }>('SELECT id FROM t WHERE id = ?', [1])?.id).toBe(1);
    sql.close();
  });
});

describe('core repositories round-trip against a real module', () => {
  test.skipIf(!has(KJV))('BibleRepository reads John 3:16', () => {
    const sql = new BunSql(modulePath(KJV), { readonly: true });
    const repo = new BibleRepository(sql);

    const verse = repo.getVerse(JOHN_3_16);
    expect(verse).toBeDefined();
    expect(verse?.verseId).toBe(JOHN_3_16);
    expect(String(verse?.text ?? '')).toMatch(/everlasting life/i);

    expect(repo.getModuleInfo()).toBeDefined();
    sql.close();
  });

  test.skipIf(!has(KJV))('BibleRepository returns a chapter', () => {
    const sql = new BunSql(modulePath(KJV), { readonly: true });
    const verses = new BibleRepository(sql).getChapter(43, 3);
    expect(verses.length).toBeGreaterThan(30);
    expect(verses[0]?.verseId).toBe(43003001);
    sql.close();
  });

  // Constructing each repository is the acceptance criterion: it proves the
  // ISql surface is complete enough for every consumer, not just the one the
  // reader happens to use first.
  const modules: ReadonlyArray<readonly [string, string, (sql: BunSql) => unknown]> = [
    ['BibleRepository', KJV, (s) => new BibleRepository(s).getModuleInfo()],
    ['CommentaryRepository', 'commentary_abbott.db', (s) => new CommentaryRepository(s).getModuleInfo()],
    ['DictionaryRepository', 'dictionary_2babdict.db', (s) => new DictionaryRepository(s).getModuleInfo()],
    ['CrossReferenceRepository', 'xref_tsk.db', (s) => new CrossReferenceRepository(s).getModuleInfo()],
    ['TopicalIndexRepository', 'topical_nave.db', (s) => new TopicalIndexRepository(s).getModuleInfo()],
    ['BookRepository', 'book_baptistconfession1689.db', (s) => new BookRepository(s).getModuleInfo()],
  ];

  for (const [label, file, exercise] of modules) {
    test.skipIf(!has(file))(`${label} constructs and reads module_info`, () => {
      const sql = new BunSql(modulePath(file), { readonly: true });
      expect(exercise(sql)).toBeDefined();
      sql.close();
    });
  }

  test('BibleBookRepository and ModuleMetadataRepository construct against a fresh database', () => {
    const sql = writable('main.db');
    expect(new BibleBookRepository(sql)).toBeDefined();
    expect(new ModuleMetadataRepository(sql)).toBeDefined();
    sql.close();
  });
});
