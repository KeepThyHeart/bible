/**
 * The shared contract for `ISql`. Every implementation runs this same suite: better-sqlite3 through
 * `TestSqliteProvider` (core), and sqlite-wasm through `createWasmSql` (web user-DB worker). Named
 * parameters use the `$name` form in SQL with bare keys in the object, which both drivers accept.
 * The test framework is passed in (`Harness`), as in `userDataContract`.
 */
import type { ISql } from '../../Data/Core/ISql';
import type { Harness } from './userDataContract';

export type { Harness };

export function isqlContract(h: Harness, name: string, create: () => ISql | Promise<ISql>): void {
  const { describe, it, expect, beforeEach } = h;

  describe(`ISql contract: ${name}`, () => {
    let sql: ISql;

    beforeEach(async () => {
      sql = await create();
      sql.execute('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER, flag INTEGER, data BLOB)');
    });

    it('binds positional parameters', () => {
      sql.execute('INSERT INTO t (name, n) VALUES (?, ?)', ['a', 1]);
      sql.execute('INSERT INTO t (name, n) VALUES (?, ?)', ['b', 2]);
      expect(sql.queryAll('SELECT name FROM t WHERE n > ? ORDER BY n', [1])).toEqual([{ name: 'b' }]);
      expect(sql.queryOne('SELECT n FROM t WHERE name = ?', ['a'])).toEqual({ n: 1 });
    });

    it('binds named parameters', () => {
      sql.execute('INSERT INTO t (name, n) VALUES ($name, $n)', { name: 'x', n: 7 });
      expect(sql.queryOne('SELECT name, n FROM t WHERE name = $name', { name: 'x' })).toEqual({ name: 'x', n: 7 });
      expect(sql.queryAll('SELECT n FROM t WHERE n = $n AND name = $name', { n: 7, name: 'x' })).toEqual([{ n: 7 }]);
    });

    // Booleans are deliberately not part of the contract: better-sqlite3 refuses to bind them (repositories
    // convert with toBoolInt), so only the wasm adapter's own test covers its 0/1 coercion.
    it('stores null', () => {
      sql.execute('INSERT INTO t (name, flag) VALUES (?, ?)', [null, 0]);
      expect(sql.queryAll('SELECT name, flag FROM t')).toEqual([{ name: null, flag: 0 }]);
    });

    it('round-trips blobs as byte arrays', () => {
      const bytes = new Uint8Array([0, 1, 2, 254, 255]);
      sql.execute('INSERT INTO t (data) VALUES (?)', [bytes]);
      const row = sql.queryOne<{ data: Uint8Array }>('SELECT data FROM t');
      expect(row?.data instanceof Uint8Array).toBe(true);
      expect(Array.from(row?.data as Uint8Array)).toEqual([0, 1, 2, 254, 255]);
      sql.execute('INSERT INTO t (data) VALUES ($d)', { d: new Uint8Array([9]) });
      expect(Array.from(sql.queryOne<{ data: Uint8Array }>('SELECT data FROM t WHERE id = 2')?.data as Uint8Array)).toEqual([9]);
    });

    it('reports lastInsertRowId and changes', () => {
      expect(sql.execute('INSERT INTO t (name) VALUES (?)', ['a']).lastInsertRowId).toBe(1);
      expect(sql.execute('INSERT INTO t (name) VALUES (?)', ['b'])).toMatchObject({ changes: 1, lastInsertRowId: 2 });
      expect(sql.execute('UPDATE t SET n = 5').changes).toBe(2);
      expect(sql.execute('UPDATE t SET n = 5 WHERE name = ?', ['nobody']).changes).toBe(0);
      expect(sql.execute('DELETE FROM t WHERE name = ?', ['a']).changes).toBe(1);
    });

    it('queryOne returns undefined on no row; queryAll returns []', () => {
      expect(sql.queryOne('SELECT * FROM t WHERE id = ?', [99])).toBeUndefined();
      expect(sql.queryAll('SELECT * FROM t')).toEqual([]);
    });

    it('commits a transaction and returns the callback result', () => {
      const out = sql.transaction(() => {
        sql.execute('INSERT INTO t (name) VALUES (?)', ['a']);
        return 42;
      });
      expect(out).toBe(42);
      expect(sql.queryAll('SELECT name FROM t')).toEqual([{ name: 'a' }]);
    });

    it('rolls back a failed transaction and rethrows', () => {
      expect(() =>
        sql.transaction(() => {
          sql.execute('INSERT INTO t (name) VALUES (?)', ['a']);
          throw new Error('boom');
        })).toThrow('boom');
      expect(sql.queryAll('SELECT * FROM t')).toEqual([]);
      // and the connection is usable (no dangling transaction)
      sql.transaction(() => sql.execute('INSERT INTO t (name) VALUES (?)', ['b']));
      expect(sql.queryAll('SELECT name FROM t')).toEqual([{ name: 'b' }]);
    });

    it('rolls back only the inner of a nested transaction that throws and is caught', () => {
      sql.transaction(() => {
        sql.execute('INSERT INTO t (name) VALUES (?)', ['outer']);
        try {
          sql.transaction(() => {
            sql.execute('INSERT INTO t (name) VALUES (?)', ['inner']);
            throw new Error('inner failed');
          });
        } catch {
          // swallowed: the outer transaction carries on
        }
        sql.execute('INSERT INTO t (name) VALUES (?)', ['after']);
      });
      expect(sql.queryAll('SELECT name FROM t ORDER BY id')).toEqual([{ name: 'outer' }, { name: 'after' }]);
    });

    it('rolls back everything when the outer of a nested transaction throws', () => {
      expect(() =>
        sql.transaction(() => {
          sql.execute('INSERT INTO t (name) VALUES (?)', ['outer']);
          sql.transaction(() => sql.execute('INSERT INTO t (name) VALUES (?)', ['inner']));
          throw new Error('outer failed');
        })).toThrow('outer failed');
      expect(sql.queryAll('SELECT * FROM t')).toEqual([]);
    });

    it('supports three levels of nesting', () => {
      sql.transaction(() => {
        sql.transaction(() => {
          sql.transaction(() => sql.execute('INSERT INTO t (name) VALUES (?)', ['deep']));
        });
      });
      expect(sql.queryAll('SELECT name FROM t')).toEqual([{ name: 'deep' }]);
    });

    it('throws on bad SQL', () => {
      expect(() => sql.execute('INSERT INTO nope VALUES (1)')).toThrow();
      expect(() => sql.queryAll('SELEKT')).toThrow();
    });

    it('isOpen / close', () => {
      expect(sql.isOpen()).toBe(true);
      expect(typeof sql.getDatabasePath()).toBe('string');
      sql.close();
      expect(sql.isOpen()).toBe(false);
    });
  });
}
