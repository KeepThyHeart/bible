import Database from 'better-sqlite3-multiple-ciphers';
import { copyFileSync, existsSync, statSync } from 'fs';
import { ISql, SqlParameter, SqlRow, SqlResult } from '@bible/core';
import log from 'electron-log';

/**
 * PBKDF2 iterations used to derive the page key.
 *
 * SQLCipher v4 defaults to 256,000, which costs roughly 185ms on every single
 * launch — measurably the largest fixed cost in main-process startup. That
 * stretching exists to make a *low-entropy passphrase* expensive to
 * brute-force. This key is not a passphrase: `encryptionKeyManager` generates
 * 32 bytes from `crypto.randomBytes` and stores them in an Electron
 * safeStorage-encrypted blob, so an attacker has 256 bits of entropy to search
 * and the iteration count buys nothing against them. An attacker who can read
 * the key file does not need to brute-force anything at all.
 *
 * Databases written before this change used the v4 default and are migrated on
 * first open — see `openWithKdfMigration`.
 */
const KDF_ITER = 4000;

/** The SQLCipher v4 default this codebase used previously. */
const LEGACY_KDF_ITER = 256000;

/** Suffix of the copy taken before an in-place rekey. */
const MIGRATION_BACKUP_SUFFIX = '.pre-kdf-migration.bak';

/**
 * Apply the cipher configuration and key, then force a real page read.
 *
 * The read matters: `PRAGMA key` itself never fails, so without touching a page
 * a wrong key (or wrong `kdf_iter`) looks exactly like success.
 */
function keyAndProbe(db: Database.Database, encryptionKey: string, kdfIter: number): boolean {
  // Order is critical: cipher, then its parameters, then the key.
  db.pragma('cipher=sqlcipher');
  db.pragma(`kdf_iter=${kdfIter}`);
  db.pragma(`key='${encryptionKey}'`);
  try {
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    return true;
  } catch {
    return false;
  }
}

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

    assertSafeKeyLiteral(encryptionKey, 'encryption key');
    this.db = this.openWithKdfMigration(databasePath, encryptionKey, options);

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
   * Open the database at `KDF_ITER`, migrating it from `LEGACY_KDF_ITER` if
   * that is how it was written.
   *
   * A SQLCipher file stores its salt but not its iteration count, so a reader
   * configured with the wrong count cannot tell "different KDF" from "corrupt
   * file" — both surface as `file is not a database`. That is why this probes
   * rather than inspects: try the current setting, and only if that fails fall
   * back to the legacy one and rewrite the file.
   *
   * The rewrite is `PRAGMA rekey` with the SAME key after changing `kdf_iter`,
   * which re-encrypts every page under the new parameters. (`sqlcipher_export`,
   * the usual SQLCipher migration route, is not compiled into sqlite3mc.)
   * Because that rewrites the whole file in place, a copy is taken first and
   * left behind on failure — this database holds notes, journals and prayers.
   */
  private openWithKdfMigration(
    databasePath: string,
    encryptionKey: string,
    options?: Database.Options
  ): Database.Database {
    let db = new Database(databasePath, options);
    if (keyAndProbe(db, encryptionKey, KDF_ITER)) return db;

    // A brand-new (zero-length) file is not a legacy database — there is
    // nothing to migrate and nothing that could have failed but the key.
    const isExistingFile = existsSync(databasePath) && statSync(databasePath).size > 0;
    if (!isExistingFile) return db;

    db.close();
    db = new Database(databasePath, options);
    if (!keyAndProbe(db, encryptionKey, LEGACY_KDF_ITER)) {
      // Neither setting works: this is a genuinely wrong key or a damaged
      // file, not a migration. Leave it untouched and let the caller fail.
      db.close();
      throw new Error('Failed to decrypt database - incorrect key or corrupted database');
    }

    if (options?.readonly) {
      // Nothing can be rewritten through a read-only handle. Reading at the
      // legacy setting is correct and costs only the slower key derivation.
      log.info('[EncryptedSqliteProvider] Read-only handle on a legacy-KDF database; not migrating');
      return db;
    }

    log.info('[EncryptedSqliteProvider] Migrating database to kdf_iter=%d', KDF_ITER);
    const backupPath = `${databasePath}${MIGRATION_BACKUP_SUFFIX}`;
    try {
      copyFileSync(databasePath, backupPath);
    } catch (error) {
      db.close();
      log.error('[EncryptedSqliteProvider] Could not back up before KDF migration:', error);
      throw new Error('Failed to back up the user database before migrating its encryption settings');
    }

    try {
      db.pragma(`kdf_iter=${KDF_ITER}`);
      db.pragma(`rekey='${encryptionKey}'`);
      db.close();
    } catch (error) {
      try { db.close(); } catch { /* already closed */ }
      log.error('[EncryptedSqliteProvider] KDF migration failed; backup kept at', backupPath, error);
      throw new Error('Failed to migrate the user database encryption settings');
    }

    // Prove the migration took before handing the connection out. A rekey that
    // reported success but produced an unreadable file must not look like a
    // clean start — the backup beside it is the recovery path.
    const migrated = new Database(databasePath, options);
    if (!keyAndProbe(migrated, encryptionKey, KDF_ITER)) {
      migrated.close();
      log.error('[EncryptedSqliteProvider] Database unreadable after KDF migration; backup at', backupPath);
      throw new Error('User database is unreadable after migrating its encryption settings');
    }

    log.info('[EncryptedSqliteProvider] KDF migration complete; backup at', backupPath);
    return migrated;
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
