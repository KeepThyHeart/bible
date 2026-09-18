/**
 * SQL admission control for extension-owned databases.
 *
 * Two layers are exercised here:
 *
 *   1. `assertExtensionSqlAllowed` in isolation, including the evasion
 *      attempts a text-based filter has to survive (comments, quoting,
 *      casing, whitespace, EXPLAIN prefixes).
 *   2. The same guard reached through `ExtensionDatabaseRegistry`, which is
 *      the path an extension's `storage.db.*` calls actually take - proving
 *      the statement never reaches the underlying `ISql`.
 */

import { describe, it, expect } from 'vitest';

import type { ISql, SqlParameter, SqlResult } from '@bible/core';

import { assertExtensionSqlAllowed } from '../ExtensionSqlGuard';
import { ExtensionDatabaseRegistry } from '../ExtensionDatabaseRegistry';

// --- Fake ISql that records everything it is asked to run -----------------

class RecordingSql implements ISql {
  readonly statements: string[] = [];
  private open = true;

  queryOne<T = unknown>(sql: string): T | undefined {
    this.statements.push(sql);
    return undefined;
  }
  queryAll<T = unknown>(sql: string): T[] {
    this.statements.push(sql);
    return [];
  }
  execute(sql: string, _params?: SqlParameter[]): SqlResult {
    this.statements.push(sql);
    return { changes: 0, lastInsertRowId: 0 };
  }
  transaction<T>(callback: () => T): T {
    return callback();
  }
  close(): void {
    this.open = false;
  }
  isOpen(): boolean {
    return this.open;
  }
  getDatabasePath(): string {
    return ':memory:';
  }
}

function makeRegistry(): { registry: ExtensionDatabaseRegistry; sql: RecordingSql } {
  const sql = new RecordingSql();
  const registry = new ExtensionDatabaseRegistry({
    extensionsRoot: process.cwd(),
    factory: { open: () => sql },
  });
  return { registry, sql };
}

// --- 1. The guard in isolation --------------------------------------------

describe('assertExtensionSqlAllowed', () => {
  const banned = [
    "ATTACH DATABASE '/tmp/main.db' AS leak",
    "attach database '/tmp/main.db' as leak",
    'DETACH DATABASE leak',
    'PRAGMA journal_mode = DELETE',
    'pragma table_info(users)',
    'VACUUM',
    "VACUUM INTO '/tmp/exfil.db'",
  ];

  it.each(banned)('rejects %s', (sql) => {
    expect(() => assertExtensionSqlAllowed(sql, 'test')).toThrow(/not permitted/);
  });

  const allowed = [
    'SELECT * FROM notes',
    'SELECT id, body FROM notes WHERE id = ?',
    'INSERT INTO notes (body) VALUES (?)',
    'UPDATE notes SET body = ? WHERE id = ?',
    'DELETE FROM notes WHERE id = ?',
    'CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)',
    'CREATE INDEX idx_notes_body ON notes(body)',
    'WITH recent AS (SELECT * FROM notes LIMIT 10) SELECT * FROM recent',
    // A trigger body's `;` separators split into statements the guard sees
    // individually, and the body ends with a bare `END`. Both must survive -
    // FTS5 external-content indexes are three triggers and nothing else.
    'CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN INSERT INTO fts(rowid, body) VALUES (new.id, new.body); END',
    'CREATE TEMP TRIGGER IF NOT EXISTS t AFTER DELETE ON notes BEGIN DELETE FROM fts WHERE rowid = old.id; END',
  ];

  it.each(allowed)('allows %s', (sql) => {
    expect(() => assertExtensionSqlAllowed(sql, 'test')).not.toThrow();
  });

  it('does not mistake quoted text for a keyword', () => {
    // These are ordinary SELECTs that merely mention the banned words.
    expect(() =>
      assertExtensionSqlAllowed("SELECT 'ATTACH DATABASE x' AS note", 'test'),
    ).not.toThrow();
    expect(() => assertExtensionSqlAllowed('SELECT "pragma" FROM notes', 'test')).not.toThrow();
    expect(() => assertExtensionSqlAllowed('SELECT [vacuum] FROM notes', 'test')).not.toThrow();
    expect(() => assertExtensionSqlAllowed('SELECT `detach` FROM notes', 'test')).not.toThrow();
  });

  it('handles SQLite doubled-quote escaping without losing the closing quote', () => {
    // If the tokenizer mishandled `''` it would fall out of the literal and
    // start reading code, so this must stay allowed...
    expect(() => assertExtensionSqlAllowed("SELECT 'it''s fine' AS t", 'test')).not.toThrow();
    // ...and this must stay banned: the literal closes before ATTACH.
    expect(() => assertExtensionSqlAllowed("SELECT 'a''b'; ATTACH DATABASE x AS y", 'test')).toThrow(
      /not permitted/,
    );
  });

  it('sees through comments used to hide the leading keyword', () => {
    expect(() => assertExtensionSqlAllowed("/* hi */ ATTACH DATABASE x AS y", 'test')).toThrow(
      /not permitted/,
    );
    expect(() =>
      assertExtensionSqlAllowed("-- comment\nATTACH DATABASE x AS y", 'test'),
    ).toThrow(/not permitted/);
    expect(() =>
      assertExtensionSqlAllowed("/*a*/PRAGMA/*b*/ journal_mode = WAL", 'test'),
    ).toThrow(/not permitted/);
  });

  it('checks every statement, not just the first', () => {
    expect(() =>
      assertExtensionSqlAllowed("SELECT 1; ATTACH DATABASE '/tmp/x.db' AS y", 'test'),
    ).toThrow(/not permitted/);
    expect(() => assertExtensionSqlAllowed('SELECT 1; PRAGMA foo', 'test')).toThrow(
      /not permitted/,
    );
  });

  it('resolves through EXPLAIN prefixes', () => {
    expect(() => assertExtensionSqlAllowed('EXPLAIN PRAGMA foo', 'test')).toThrow(/not permitted/);
    expect(() => assertExtensionSqlAllowed('EXPLAIN QUERY PLAN ATTACH DATABASE x AS y', 'test'))
      .toThrow(/not permitted/);
    expect(() => assertExtensionSqlAllowed('EXPLAIN SELECT * FROM notes', 'test')).not.toThrow();
  });

  it('tolerates odd whitespace and leading parens', () => {
    expect(() => assertExtensionSqlAllowed('\n\t  ATTACH   DATABASE x AS y', 'test')).toThrow(
      /not permitted/,
    );
    expect(() => assertExtensionSqlAllowed('(SELECT 1)', 'test')).not.toThrow();
  });

  it('bans load_extension wherever it appears', () => {
    expect(() => assertExtensionSqlAllowed("SELECT load_extension('evil.so')", 'test')).toThrow(
      /not permitted/,
    );
    expect(() =>
      assertExtensionSqlAllowed("SELECT * FROM t WHERE x = LOAD_EXTENSION('a')", 'test'),
    ).toThrow(/not permitted/);
  });

  it('names the offending keyword in the error', () => {
    expect(() => assertExtensionSqlAllowed('ATTACH DATABASE x AS y', 'storage.db.run')).toThrow(
      /storage\.db\.run: ATTACH/,
    );
  });

  /**
   * Raw transaction control desynchronizes `ExtensionDatabaseRegistry`'s
   * per-handle `inTransaction` flag from SQLite. The worst case is silent: an
   * extension issues `BEGIN` through `db.exec`, the registry never learns a
   * transaction is open, and `closeEntry` therefore skips its `ROLLBACK` -
   * discarding the extension's work with no error raised anywhere.
   */
  describe('transaction control', () => {
    const bannedTx = [
      'BEGIN',
      'BEGIN IMMEDIATE',
      'begin deferred transaction',
      'COMMIT',
      'COMMIT TRANSACTION',
      'ROLLBACK',
      'rollback to savepoint sp1',
      'SAVEPOINT sp1',
      'RELEASE sp1',
      'RELEASE SAVEPOINT sp1',
      // `END` is COMMIT's alias when it stands alone.
      'END',
      'END TRANSACTION',
      // ...and hiding it behind a comment or an empty leading statement does
      // not make it a later statement.
      '/* x */ END',
      '; END',
    ];

    it.each(bannedTx)('rejects %s', (sql) => {
      expect(() => assertExtensionSqlAllowed(sql, 'test')).toThrow(/not permitted/);
    });

    it('points the author at the API that does work', () => {
      expect(() => assertExtensionSqlAllowed('BEGIN', 'storage.db.exec')).toThrow(
        /db\.transaction\(\)/,
      );
    });

    it('does not mistake a trigger body terminator for COMMIT', () => {
      expect(() =>
        assertExtensionSqlAllowed(
          'CREATE TRIGGER t AFTER UPDATE ON notes BEGIN UPDATE meta SET n = n + 1; END',
          'test',
        ),
      ).not.toThrow();
    });

    it('still catches a banned statement smuggled after a trigger body', () => {
      expect(() =>
        assertExtensionSqlAllowed(
          'CREATE TRIGGER t AFTER UPDATE ON notes BEGIN UPDATE meta SET n = 1; END; ATTACH DATABASE x AS y',
          'test',
        ),
      ).toThrow(/ATTACH/);
    });

    it('leaves the words alone when they are not the statement', () => {
      // `commit`/`begin` as identifiers or inside expressions are ordinary.
      expect(() => assertExtensionSqlAllowed('SELECT begin_at FROM plans', 'test')).not.toThrow();
      expect(() =>
        assertExtensionSqlAllowed('INSERT INTO t (a) VALUES (?) ON CONFLICT DO NOTHING', 'test'),
      ).not.toThrow();
      expect(() =>
        assertExtensionSqlAllowed("SELECT CASE WHEN a THEN 1 ELSE 2 END FROM t", 'test'),
      ).not.toThrow();
    });
  });
});

// --- 2. The guard as reached through the registry -------------------------

describe('ExtensionDatabaseRegistry — SQL admission control', () => {
  it('blocks ATTACH on every entry point and never touches the connection', () => {
    const { registry, sql } = makeRegistry();
    const handle = registry.open('ext.a', 'data');
    const attack = "ATTACH DATABASE '../../main.db' AS leak";

    expect(() => registry.exec('ext.a', handle, attack)).toThrow(/not permitted/);
    expect(() => registry.query('ext.a', handle, attack, [])).toThrow(/not permitted/);
    expect(() => registry.queryOne('ext.a', handle, attack, [])).toThrow(/not permitted/);
    expect(() => registry.run('ext.a', handle, attack, [])).toThrow(/not permitted/);

    // Nothing reached the underlying connection.
    expect(sql.statements).toHaveLength(0);
  });

  it('blocks PRAGMA and VACUUM INTO', () => {
    const { registry, sql } = makeRegistry();
    const handle = registry.open('ext.a', 'data');

    expect(() => registry.exec('ext.a', handle, 'PRAGMA journal_mode = DELETE')).toThrow(
      /not permitted/,
    );
    expect(() => registry.exec('ext.a', handle, "VACUUM INTO '/tmp/exfil.db'")).toThrow(
      /not permitted/,
    );
    expect(sql.statements).toHaveLength(0);
  });

  it('still lets ordinary parameterized SQL through', () => {
    const { registry, sql } = makeRegistry();
    const handle = registry.open('ext.a', 'data');

    registry.exec('ext.a', handle, 'CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT)');
    registry.run('ext.a', handle, 'INSERT INTO t (body) VALUES (?)', ['hello']);
    registry.query('ext.a', handle, 'SELECT * FROM t WHERE body = ?', ['hello']);
    registry.queryOne('ext.a', handle, 'SELECT * FROM t WHERE id = ?', [1]);

    expect(sql.statements).toHaveLength(4);
  });

  it('keeps one extension out of another extension handle', () => {
    const { registry } = makeRegistry();
    const handle = registry.open('ext.a', 'data');
    expect(() => registry.query('ext.b', handle, 'SELECT 1', [])).toThrow(
      /unknown database handle/,
    );
  });
});
