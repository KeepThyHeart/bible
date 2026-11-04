/** `ISql` over an in-memory better-sqlite3 database (foreign keys on, as a host would open it). */
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import type { ISql, SqlParameter, SqlResult } from '@bible/core';

type Params = SqlParameter[] | { [key: string]: SqlParameter } | undefined;

function bind(p: Params): unknown[] {
  if (p === undefined) return [];
  return Array.isArray(p) ? p : [p];
}

export class TestSql implements ISql {
  readonly db: Db;
  constructor(file = ':memory:') {
    this.db = new Database(file);
    this.db.pragma('foreign_keys = ON');
  }
  queryOne<T>(sql: string, params?: Params): T | undefined {
    return this.db.prepare(sql).get(...(bind(params) as never[])) as T | undefined;
  }
  queryAll<T>(sql: string, params?: Params): T[] {
    return this.db.prepare(sql).all(...(bind(params) as never[])) as T[];
  }
  execute(sql: string, params?: Params): SqlResult {
    const stmt = this.db.prepare(sql);
    if (!stmt.reader) {
      const info = stmt.run(...(bind(params) as never[]));
      return { changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) };
    }
    stmt.all(...(bind(params) as never[]));
    return { changes: 0, lastInsertRowId: 0 };
  }
  transaction<T>(callback: () => T): T {
    return this.db.transaction(callback)();
  }
  close(): void {
    this.db.close();
  }
  isOpen(): boolean {
    return this.db.open;
  }
  getDatabasePath(): string {
    return this.db.name;
  }
}
