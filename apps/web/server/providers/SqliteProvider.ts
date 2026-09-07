/**
 * SQLite provider using better-sqlite3 (aliased as 'better-sqlite3-web').
 *
 * The web package uses an npm alias to install its own copy of better-sqlite3,
 * separate from the Electron-compiled copy used by the desktop package.
 * This avoids NODE_MODULE_VERSION conflicts between Electron and system Node.js.
 *
 * To swap to a different driver (e.g. sql.js), replace this file —
 * everything goes through the ISql interface, so no other changes are needed.
 */
import BetterSqlite3 from 'better-sqlite3-web';
import type { ISql, SqlParameter, SqlRow, SqlResult } from '@bible/core';

type Database = BetterSqlite3.Database;
type Statement = BetterSqlite3.Statement;

export class SqliteProvider implements ISql {
  private db: Database;
  private readonly dbPath: string;

  constructor(
    databasePath: string,
    options?: {
      readonly?: boolean;
      fileMustExist?: boolean;
      timeout?: number;
      verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
    }
  ) {
    this.dbPath = databasePath;
    this.db = new BetterSqlite3(databasePath, options);

    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('cache_size = -64000');
    this.db.pragma('busy_timeout = 5000');
  }

  queryOne<T = SqlRow>(
    sql: string,
    params?: SqlParameter[] | { [key: string]: SqlParameter }
  ): T | undefined {
    try {
      const stmt = this.db.prepare(sql);
      const result = params ? stmt.get(params) : stmt.get();
      return result as T | undefined;
    } catch (error) {
      throw new Error(`Query failed: ${error instanceof Error ? error.message : String(error)}\nSQL: ${sql}`);
    }
  }

  queryAll<T = SqlRow>(
    sql: string,
    params?: SqlParameter[] | { [key: string]: SqlParameter }
  ): T[] {
    try {
      const stmt = this.db.prepare(sql);
      const results = params ? stmt.all(params) : stmt.all();
      return results as T[];
    } catch (error) {
      throw new Error(`Query failed: ${error instanceof Error ? error.message : String(error)}\nSQL: ${sql}`);
    }
  }

  execute(
    sql: string,
    params?: SqlParameter[] | { [key: string]: SqlParameter }
  ): SqlResult {
    try {
      const stmt = this.db.prepare(sql);
      const info = params ? stmt.run(params) : stmt.run();
      return {
        changes: info.changes,
        lastInsertRowId: info.lastInsertRowid as number
      };
    } catch (error) {
      throw new Error(`Execute failed: ${error instanceof Error ? error.message : String(error)}\nSQL: ${sql}`);
    }
  }

  transaction<T>(callback: () => T): T {
    const tx = this.db.transaction(callback);
    return tx();
  }

  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  isOpen(): boolean {
    return this.db.open;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): Statement {
    return this.db.prepare(sql);
  }

  getDatabase(): Database {
    return this.db;
  }
}
