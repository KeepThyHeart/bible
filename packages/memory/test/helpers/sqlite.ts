/**
 * Real SQLite for tests: a host-style `ISql` over better-sqlite3, and the
 * memory store's `MemorySql` port over it with the memory schema installed.
 *
 * Deliberately not a fake (the extension's rule): cascades, unique indexes and
 * rollbacks are what the store relies on, so tests run the real SQL.
 */

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import type { ISql, SqlParameter, SqlResult } from '@bible/core';

import { installMemorySchema } from '../../src/core/schema';
import { createSqlPort } from '../../src/core/sqlPort';
import type { MemorySql } from '../../src/core/ports';

type Params = SqlParameter[] | { [key: string]: SqlParameter } | undefined;

function bind(p: Params): unknown[] {
  if (p === undefined) return [];
  return Array.isArray(p) ? p : [p];
}

/** `ISql` over a better-sqlite3 handle (foreign keys on, as the host opens it). */
export class TestSql implements ISql {
  readonly db: Db;
  constructor(db?: Db | string) {
    this.db = db instanceof Database ? db : new Database(typeof db === 'string' ? db : ':memory:');
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
      return { changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) } as SqlResult;
    }
    stmt.all(...(bind(params) as never[]));
    return { changes: 0, lastInsertRowId: 0 } as SqlResult;
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

export interface MemoryTestDb {
  /** The async port the store uses. */
  sql: MemorySql;
  /** The synchronous host handle underneath (for assertions and the importer). */
  host: TestSql;
}

/** A fresh in-memory user database with the memory schema installed. */
export function createMemoryTestDb(): MemoryTestDb {
  const host = new TestSql();
  installMemorySchema(host);
  return { sql: createSqlPort(host), host };
}
