import Database from 'better-sqlite3';
import { ISql, SqlParameter, SqlResult } from '../../Data/Core/ISql';

/**
 * The `ISql` implementation the core test suite runs repositories against.
 *
 * Ten test files carried their own copy of this class, each declaring
 * `implements ISql` while omitting `isOpen()` and `getDatabasePath()` and
 * typing bind parameters as `any[]`. Neither gap could be seen, because core's
 * `tsconfig.json` is the build config and therefore excludes tests; they
 * surfaced the moment `tsconfig.typecheck.json` started covering them.
 *
 * The `any[]` one mattered: `ISql` also allows named parameters
 * (`{ $id: 1 }`), and spreading an object into `stmt.get(...)` throws. A
 * repository that switched to named binds would have passed its unit tests and
 * failed in the app.
 */
export class TestSqliteProvider implements ISql {
  private db: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath: string, options?: Database.Options) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath, options);
    // A read-only fixture (the real KJV module, opened by `KJVTestHelper`)
    // rejects both pragmas, and neither is meaningful for one.
    if (!options?.readonly) {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
    }
  }

  /** Execute raw SQL (multiple statements, DDL). Used for schema setup. */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  queryOne<T = unknown>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T | undefined {
    return this.db.prepare(sql).get(...bind(params)) as T | undefined;
  }

  queryAll<T = unknown>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T[] {
    return this.db.prepare(sql).all(...bind(params)) as T[];
  }

  execute(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): SqlResult {
    const result = this.db.prepare(sql).run(...bind(params));
    return {
      changes: result.changes,
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }

  isOpen(): boolean {
    return this.db.open;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }
}

/**
 * Positional binds spread; a named-bind object is passed as one argument,
 * which is what better-sqlite3 expects for `@name` / `$name` / `:name`.
 */
function bind(params?: SqlParameter[] | { [key: string]: SqlParameter }): unknown[] {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}
