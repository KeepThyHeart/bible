import BetterSqlite3 from 'better-sqlite3-multiple-ciphers';
import { ISql, SqlParameter, SqlRow, SqlResult } from '@bible/core';

type Database = BetterSqlite3.Database;
type Statement = BetterSqlite3.Statement;

/**
 * SQLite implementation of the ISql interface using better-sqlite3
 *
 * This provider wraps better-sqlite3 and provides a consistent interface
 * for all repositories to use when accessing SQLite databases.
 *
 * Features:
 * - Synchronous API (better-sqlite3 is faster with sync operations)
 * - Transaction support
 * - Named and positional parameter binding
 * - Connection management
 *
 * Example usage:
 * ```typescript
 * const sql = new SqliteProvider('data/main.db');
 * const book = sql.queryOne('SELECT * FROM bible_book WHERE book_id = ?', [1]);
 * sql.close();
 * ```
 */
export class SqliteProvider implements ISql {
  private db: Database;
  private readonly dbPath: string;

  /**
   * Create a new SQLite provider
   * @param databasePath Path to the SQLite database file
   * @param options Optional database options
   */
  constructor(
    databasePath: string,
    options?: {
      readonly?: boolean;
      fileMustExist?: boolean;
      timeout?: number;
      verbose?: (message?: any, ...additionalArgs: any[]) => void;
    }
  ) {
    this.dbPath = databasePath;
    this.db = new BetterSqlite3(databasePath, options);

    // --- Performance & reliability pragmas ---
    this.db.pragma('foreign_keys = ON');

    // journal_mode and synchronous are WRITES to the database header, so they
    // fail outright on a read-only connection. Shipped v2 modules are immutable
    // artifacts distributed in DELETE mode (a single self-contained file, no
    // -wal/-shm sidecars), so this is the normal case for them, not an edge one.
    // A reader gains nothing from WAL anyway - it exists to let readers proceed
    // during writes, and there are none.
    if (!options?.readonly) {
      // WAL (Write-Ahead Logging) allows concurrent readers during writes,
      // critical for UI responsiveness while background indexing or saves occur.
      this.db.pragma('journal_mode = WAL');
      // NORMAL sync is safe with WAL - only risks losing the last transaction on
      // OS crash (not app crash). FULL would halve write throughput for no real
      // benefit since user data is backed up independently.
      this.db.pragma('synchronous = NORMAL');
    }
    // Keep temp tables in memory to avoid disk I/O for sort spills and FTS5
    // intermediate results during search queries.
    this.db.pragma('temp_store = MEMORY');
    // 64MB cache - Bible modules can have 30k+ verses; a generous cache avoids
    // repeated disk reads when scrolling through chapters or running searches.
    this.db.pragma('cache_size = -64000');
    // 5s busy timeout prevents "database is locked" errors when multiple
    // handlers access the same DB (e.g., search + highlight load).
    this.db.pragma('busy_timeout = 5000');
  }

  /**
   * Execute a SQL query and return a single row
   */
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

  /**
   * Execute a SQL query and return all matching rows
   */
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

  /**
   * Execute a SQL statement (INSERT, UPDATE, DELETE)
   */
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

  /**
   * Execute multiple SQL statements within a transaction
   */
  transaction<T>(callback: () => T): T {
    const tx = this.db.transaction(callback);
    return tx();
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  /**
   * Check if the database connection is open
   */
  isOpen(): boolean {
    return this.db.open;
  }

  /**
   * Get the file path of the database
   */
  getDatabasePath(): string {
    return this.dbPath;
  }

  /**
   * Execute raw SQL (for migrations, schema creation, etc.)
   * Use with caution - prefer queryOne/queryAll/execute for normal operations
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Prepare a statement for repeated execution
   * Returns the raw better-sqlite3 statement for advanced use cases
   */
  prepare(sql: string): Statement {
    return this.db.prepare(sql);
  }

  /**
   * Get the underlying better-sqlite3 database instance
   * Use with caution - prefer the ISql interface methods
   */
  getDatabase(): Database {
    return this.db;
  }
}
