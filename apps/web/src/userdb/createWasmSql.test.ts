// @vitest-environment node
/**
 * sqlite-wasm initialises under Node (its `node` export), so the real oo1 engine is used here, in memory:
 * no fake over better-sqlite3 is needed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createUserSchema } from '@bible/core/browser';
import { isqlContract } from '../../../../packages/core/src/__tests__/contracts/isqlContract';
import { createWasmSql } from './createWasmSql';
import { toWireError } from './errors';

let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
const make = () => createWasmSql(new sqlite3.oo1.DB(':memory:'), ':memory:');

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

isqlContract({ describe, it, expect, beforeEach, afterEach } as never, 'createWasmSql (sqlite-wasm oo1, memory)', make);

describe('createWasmSql specifics', () => {
  it('coerces booleans and undefined, accepts prefixed named keys', () => {
    const sql = make();
    sql.execute('CREATE TABLE b (x INTEGER, y TEXT)');
    sql.execute('INSERT INTO b VALUES (?, ?)', [true, undefined as never]);
    sql.execute('INSERT INTO b VALUES (:x, $y)', { ':x': false, $y: 'k' });
    expect(sql.queryAll('SELECT x, y FROM b ORDER BY rowid')).toEqual([{ x: 1, y: null }, { x: 0, y: 'k' }]);
  });

  it('reports the path it was given', () => {
    expect(createWasmSql(new sqlite3.oo1.DB(':memory:'), '/user.db').getDatabasePath()).toBe('/user.db');
  });

  it('createUserSchema works, foreign keys can be enabled, and user_note_fts MATCH finds a note', () => {
    const sql = make();
    sql.execute('PRAGMA foreign_keys = ON');
    createUserSchema(sql);
    createUserSchema(sql); // idempotent
    expect(sql.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
    const cols = sql.queryAll<{ name: string }>('PRAGMA table_info(user_note)').map((c) => c.name);
    expect(cols).toContain('content');
    const insertCols = cols.filter((c) => ['id', 'title', 'content', 'created_at', 'updated_at'].includes(c));
    sql.execute(
      `INSERT INTO user_note (${insertCols.join(',')}) VALUES (${insertCols.map(() => '?').join(',')})`,
      insertCols.map((c) => ({ id: 'n1', title: 'Grace', content: 'amazing grace abounds', created_at: 1, updated_at: 1 }[c] as never)),
    );
    const hit = sql.queryAll('SELECT rowid FROM user_note_fts WHERE user_note_fts MATCH ?', ['abounds']);
    expect(hit.length).toBe(1);
  }, 60_000);

  it('maps errors to name/message/code', () => {
    const sql = make();
    sql.execute('CREATE TABLE u (k TEXT PRIMARY KEY)');
    sql.execute('INSERT INTO u VALUES (?)', ['a']);
    let caught: unknown;
    try {
      sql.execute('INSERT INTO u VALUES (?)', ['a']);
    } catch (e) {
      caught = e;
    }
    const wire = toWireError(caught);
    expect(wire.message).toMatch(/constraint/i);
    expect(wire.code).toMatch(/^SQLITE_/);
    expect(toWireError('plain')).toEqual({ name: 'Error', message: 'plain' });
    expect(toWireError(Object.assign(new TypeError('x'), { code: 'E_X' }))).toEqual({ name: 'TypeError', message: 'x', code: 'E_X' });
  });
});
