/**
 * `ISql` over an @sqlite.org/sqlite-wasm `oo1.DB` (contracts 0063 section 12). Synchronous, worker-only in
 * production; the same code runs in Node tests against an in-memory database.
 *
 * Differences from better-sqlite3 that this adapter hides:
 *  - named parameters: oo1 wants the prefix (`$name`) on the bind key, better-sqlite3 takes bare keys;
 *  - booleans bind as 0/1, `undefined` as NULL, `Buffer`/`Uint8Array` as blobs (blobs come back as Uint8Array);
 *  - `execute` reports `changes` (0 for statements that changed nothing) and `lastInsertRowId`;
 *  - `transaction` nests like better-sqlite3's: depth 0 is BEGIN/COMMIT/ROLLBACK, deeper levels SAVEPOINTs.
 */
import type { Sync } from '@bible/core/browser';

type ISql = Sync.ISql;
type SqlParameter = Sync.SqlParameter;
type SqlResult = Sync.SqlResult;
type SqlRow = Sync.SqlRow;

/** The slice of oo1.DB this adapter uses. */
export interface Oo1DbLike {
  exec(opts: { sql: string; bind?: unknown; rowMode?: 'object'; returnValue?: 'resultRows' }): unknown;
  exec(sql: string): unknown;
  changes(total?: boolean, sixtyFour?: boolean): number;
  selectValue(sql: string, bind?: unknown): unknown;
  close(): void;
  isOpen(): boolean;
}

type Params = SqlParameter[] | { [key: string]: SqlParameter };

function bindValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function toBind(params?: Params): unknown {
  if (params === undefined) return undefined;
  if (Array.isArray(params)) return params.map(bindValue);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    out[/^[$:@]/.test(key) ? key : `$${key}`] = bindValue(value);
  }
  return out;
}

export function createWasmSql(db: unknown, path: string): ISql {
  const handle = db as Oo1DbLike;
  let depth = 0;
  let closed = false;

  const rows = (sql: string, params?: Params): SqlRow[] =>
    handle.exec({ sql, bind: toBind(params), rowMode: 'object', returnValue: 'resultRows' }) as SqlRow[];

  return {
    queryOne<T = SqlRow>(sql: string, params?: Params): T | undefined {
      return rows(sql, params)[0] as T | undefined;
    },
    queryAll<T = SqlRow>(sql: string, params?: Params): T[] {
      return rows(sql, params) as T[];
    },
    execute(sql: string, params?: Params): SqlResult {
      const before = handle.changes(true);
      handle.exec({ sql, bind: toBind(params) });
      // changes() is stale after a statement that modified nothing (DDL, no-op UPDATE); total_changes is not.
      const changed = handle.changes(true) !== before;
      return {
        changes: changed ? handle.changes() : 0,
        lastInsertRowId: Number(handle.selectValue('SELECT last_insert_rowid()')),
      };
    },
    transaction<T>(callback: () => T): T {
      const level = depth;
      const savepoint = `sp_${level}`;
      handle.exec(level === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
      depth++;
      try {
        const result = callback();
        depth--;
        handle.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        depth = level;
        try {
          if (level === 0) handle.exec('ROLLBACK');
          else handle.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        } catch {
          // The failure that got us here is the one worth reporting.
        }
        throw error;
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      handle.close();
    },
    isOpen(): boolean {
      return !closed && handle.isOpen();
    },
    getDatabasePath(): string {
      return path;
    },
  };
}
