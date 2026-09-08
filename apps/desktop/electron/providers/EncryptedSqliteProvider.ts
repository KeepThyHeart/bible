import Database from 'better-sqlite3-multiple-ciphers';
import { ISql, SqlParameter, SqlRow, SqlResult } from '@bible/core';
import log from 'electron-log';

/**
 * SQLite `PRAGMA key`/`rekey` cannot use bound parameters, so the key is
 * interpolated into the pragma string. The key is always app-generated (a hex
 * string from `encryptionKeyManager`), but we defensively reject anything that
 * could break out of the `'...'` literal (quotes, backslashes, control chars)
 * so a malformed or attacker-influenced key can never inject pragma syntax.
 */
function assertSafeKeyLiteral(value: string, label: string): void {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(value)) {
    throw new Error(
      `Refusing to use an unsafe ${label}: it must contain only key-safe characters`
    );
  }
}

/**
 * Encrypted SQLite implementation of the ISql interface using better-sqlite3-multiple-ciphers
 *
 * This provider wraps better-sqlite3-multiple-ciphers and provides database encryption
 * for user databases containing sensitive data (notes, journals, prayers).
 *
 * The encryption key should be obtained from the OS credential store via
 * the encryptionKeyManager utility.
 *
 * Features:
 * - 256-bit AES encryption (SQLCipher compatible)
 * - ChaCha20-Poly1305 encryption (modern default)
 * - Synchronous API (same as better-sqlite3)
 * - Transaction support
 * - Named and positional parameter binding
 * - Connection management
 * - No OpenSSL dependency issues
 *
 * Example usage:
 * ```typescript
 * import { getOrCreateEncryptionKey } from '../utils/encryptionKeyManager';
 * const key = await getOrCreateEncryptionKey();
 * const sql = new EncryptedSqliteProvider('data/users/user_default.db', key);
 * const note = sql.queryOne('SELECT * FROM user_note WHERE note_id = ?', [1]);
 * sql.close();
 * ```
 */
export class EncryptedSqliteProvider implements ISql {
  private db: Database.Database;
  private readonly dbPath: string;

  /**
   * Create a new encrypted SQLite provider
   * @param databasePath Path to the SQLite database file
   * @param encryptionKey Encryption key (should be a 64-character hex string from keytar)
   * @param options Optional database options
   */
  constructor(
    databasePath: string,
    encryptionKey: string,
    options?: {
      readonly?: boolean;
      fileMustExist?: boolean;
      timeout?: number;
      verbose?: (message?: any, ...additionalArgs: any[]) => void;
    }
  ) {
    this.dbPath = databasePath;

    log.info(`[EncryptedSqliteProvider] Opening encrypted database: ${databasePath}`);

    // Open database with better-sqlite3-multiple-ciphers
    this.db = new Database(databasePath, options);

    // Set cipher BEFORE key - order is critical!
    // Using SQLCipher cipher scheme for compatibility with existing databases
    this.db.pragma('cipher=sqlcipher'); // Use SQLCipher encryption scheme

    // Set encryption key IMMEDIATELY after cipher
    assertSafeKeyLiteral(encryptionKey, 'encryption key');
    this.db.pragma(`key='${encryptionKey}'`);

    // Set recommended pragmas for performance and reliability
    this.db.pragma('foreign_keys = ON');
    // Note: WAL mode can cause issues with encrypted databases when multiple connections exist
    // Using DELETE mode (default) instead for better stability with encryption
    this.db.pragma('journal_mode = DELETE');
    this.db.pragma('synchronous = FULL'); // Use FULL for better reliability with DELETE mode
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('busy_timeout = 5000'); // Wait up to 5 seconds for locks

    // Verify that encryption is working by running a simple query
    try {
      this.db.prepare('SELECT 1').get();
      log.info('[EncryptedSqliteProvider] Database encryption verified successfully');
    } catch (error) {
      log.error('[EncryptedSqliteProvider] Failed to verify database encryption:', error);
      throw new Error('Failed to decrypt database - incorrect key or corrupted database');
    }
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
      log.info(`[EncryptedSqliteProvider] Closed encrypted database: ${this.dbPath}`);
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
  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  /**
   * Get the underlying database instance
   * Use with caution - prefer the ISql interface methods
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Rekey the database with a new encryption key
   *
   * WARNING: This is a dangerous operation. If it fails mid-operation,
   * the database may become corrupted. Always backup before rekeying.
   *
   * @param newEncryptionKey The new encryption key
   */
  rekey(newEncryptionKey: string): void {
    try {
      log.warn('[EncryptedSqliteProvider] Rekeying database - this is a dangerous operation');
      assertSafeKeyLiteral(newEncryptionKey, 'rekey value');
      this.db.pragma(`rekey='${newEncryptionKey}'`);
      log.info('[EncryptedSqliteProvider] Database rekeyed successfully');
    } catch (error) {
      log.error('[EncryptedSqliteProvider] Failed to rekey database:', error);
      throw new Error(`Failed to rekey database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
