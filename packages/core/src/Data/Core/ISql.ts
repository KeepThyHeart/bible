/**
 * SQL parameter types supported by the ISql interface
 */
export type SqlParameter = string | number | boolean | null | Buffer | Uint8Array;

/**
 * Result of a SQL query operation
 */
export interface SqlRow {
  [key: string]: SqlParameter;
}

/**
 * Options for SQL query execution
 */
export interface QueryOptions {
  /** If true, returns all matching rows; if false, returns first row only */
  all?: boolean;
  /** Bind parameters for the query */
  params?: SqlParameter[] | { [key: string]: SqlParameter };
}

/**
 * Result of an INSERT, UPDATE, or DELETE operation
 */
export interface SqlResult {
  /** Number of rows affected by the operation */
  changes: number;
  /** Last inserted row ID (for INSERT operations) */
  lastInsertRowId?: number;
}

/**
 * Abstraction layer for SQL database operations.
 *
 * This interface provides a clean abstraction over SQLite (or potentially other SQL databases)
 * allowing repositories to execute queries without directly depending on the database implementation.
 *
 * Implementations:
 * - SqliteProvider in @bible/desktop (better-sqlite3, compiled for Electron)
 * - SqliteProvider in @bible/web (better-sqlite3, for Express server)
 * - Custom implementations for other platforms or testing
 *
 * Example usage:
 * ```typescript
 * // Obtain an ISql instance from your platform's provider
 * const sql: ISql = createYourSqlProvider('path/to/database.db');
 * const user = sql.queryOne<User>('SELECT * FROM users WHERE id = ?', [userId]);
 * const users = sql.queryAll<User>('SELECT * FROM users WHERE age > ?', [18]);
 * const result = sql.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['John', 'john@example.com']);
 * ```
 */
export interface ISql {
  /**
   * Execute a SQL query and return a single row
   * @param sql SQL query string
   * @param params Optional bind parameters
   * @returns Single row result, or undefined if no rows match
   */
  queryOne<T = SqlRow>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T | undefined;

  /**
   * Execute a SQL query and return all matching rows
   * @param sql SQL query string
   * @param params Optional bind parameters
   * @returns Array of result rows
   */
  queryAll<T = SqlRow>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T[];

  /**
   * Execute a SQL statement (INSERT, UPDATE, DELETE) that doesn't return rows
   * @param sql SQL statement string
   * @param params Optional bind parameters
   * @returns Result containing number of affected rows and last insert ID
   */
  execute(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): SqlResult;

  /**
   * Execute multiple SQL statements within a transaction
   * @param callback Function containing the operations to execute within the transaction
   * @returns Result of the callback function
   */
  transaction<T>(callback: () => T): T;

  /**
   * Close the database connection
   */
  close(): void;

  /**
   * Check if the database connection is open
   */
  isOpen(): boolean;

  /**
   * Get the file path of the database
   */
  getDatabasePath(): string;
}
