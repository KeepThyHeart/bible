import type Database from 'better-sqlite3';
import type { ISql } from '@bible/core';

/** Wrap a plain better-sqlite3 handle (Node ABI, unlike the app's cipher build) as `ISql`. */
export function makeSql(db: Database.Database): ISql {
  const sql = {
    execute: (s: string, p: unknown[] = []) => {
      const r = db.prepare(s).run(...(p as never[]));
      return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
    },
    queryAll: (s: string, p: unknown[] = []) => db.prepare(s).all(...(p as never[])),
    queryOne: (s: string, p: unknown[] = []) => db.prepare(s).get(...(p as never[])),
    transaction: <T>(f: () => T) => db.transaction(f)(),
  };
  return sql as unknown as ISql;
}
