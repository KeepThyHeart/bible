/**
 * Backup/Restore Service
 *
 * User data is exported as a single AES-256-GCM-encrypted JSON file. The
 * encryption key is derived from the user-supplied password via scrypt; the
 * envelope on disk carries the KDF parameters, salt, IV, and auth tag.
 *
 * File layout (UTF-8 JSON):
 *   {
 *     "magic": "bible-app-backup",
 *     "version": 1,
 *     "algorithm": "aes-256-gcm",
 *     "kdf": "scrypt",
 *     "kdfParams": { "N": ..., "r": ..., "p": ..., "keyLen": 32 },
 *     "salt": "<base64>",
 *     "iv": "<base64>",
 *     "tag": "<base64>",
 *     "ciphertext": "<base64 of encrypted-JSON-payload>"
 *   }
 *
 * The plaintext payload is a JSON object of the form:
 *   { "metadata": BackupMetadata, "tables": { "<name>": Row[], ... } }
 */

import { join, dirname, relative, resolve, sep } from 'path';
import { randomBytes, scrypt as scryptCb, createCipheriv, createDecipheriv } from 'crypto';
import { promisify } from 'util';
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import log from 'electron-log';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

const VALID_TABLE_NAME = /^[a-z_][a-z0-9_]*$/i;

function validateTableName(name: string): void {
  if (!VALID_TABLE_NAME.test(name)) {
    throw new Error(`Invalid table name in backup: ${name}`);
  }
}

const MAGIC = 'bible-app-backup';
const FORMAT_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const KDF_PARAMS = { N: 16384, r: 8, p: 1, keyLen: 32 } as const;

export interface BackupMetadata {
  version: string;
  appVersion: string;
  createdAt: string;
  username: string;
  tables: Record<string, number>; // table name -> row count
  includeHistory: boolean;
  /**
   * Number of `.bn` note files (documents, sermons, verse notes) bundled into
   * the archive. Undefined on backups taken before file-notes were included.
   */
  noteFiles?: number;
}

export interface BackupOptions {
  password: string;
  destinationPath: string;
  includeHistory?: boolean;
  username?: string;
  /**
   * Root of the `.bn` file-notes store. When provided, every `.bn` note under it
   * is bundled into the (encrypted) archive; `.bak` history is included only
   * when `includeHistory` is set.
   */
  notesDir?: string;
}

export interface RestoreOptions {
  password: string;
  backupPath: string;
  mode: 'merge' | 'replace';
  /** Root of the `.bn` file-notes store to restore bundled note files into. */
  notesDir?: string;
}

export interface BackupResult {
  success: boolean;
  path?: string;
  metadata?: BackupMetadata;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  tablesRestored?: string[];
  rowCounts?: Record<string, number>;
  /** Number of `.bn`/`.bak` note files written back to the notes directory. */
  noteFilesRestored?: number;
  error?: string;
}

interface BackupEnvelope {
  magic: string;
  version: number;
  algorithm: string;
  kdf: string;
  kdfParams: { N: number; r: number; p: number; keyLen: number };
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface BackupPayload {
  metadata: BackupMetadata;
  tables: Record<string, unknown[]>;
  /**
   * File-notes bundled into the archive: map of notes-dir-relative POSIX path
   * (e.g. `Verse Notes/John/3/16.bn`) to the file's UTF-8 contents. Optional so
   * archives created before file-notes support still validate/restore.
   */
  files?: Record<string, string>;
}

// Tables that contain critical user data (always backed up)
const CRITICAL_TABLES = [
  'user_note',
  // The unified verse-link table. Every user link to scripture lands
  // here, so omitting it would silently drop the lot from every backup -- the
  // legacy per-type tables below are retained only for databases not yet
  // migrated. A table missing from a backup is a data-loss path, not a gap.
  'verse_link',
  'note_verse_link',
  'content_verse_link',
  'journal_verse_link',
  'user_text_markup',
  'user_commentary',
  'collection',
  'pinned_item',
];

// Tables that contain important settings (always backed up)
const IMPORTANT_TABLES = [
  'session',
];

// Tables that contain optional history (backed up only when includeHistory is true)
const HISTORY_TABLES = [
  // Renamed in v2: main.db owns the name `search_history` and the two tables had
  // incompatible columns, so the user-database one became `user_search_history`.
  'user_search_history',
  'navigation_history',
];

/**
 * ISql-compatible interface for reading/writing.
 */
interface IBackupSql {
  queryAll(sql: string, params?: any[]): any[];
  queryOne(sql: string, params?: any[]): any;
  execute(sql: string, params?: any[]): any;
  transaction<T>(fn: () => T): T;
}

/**
 * Recursively collect the file-notes store into a relative-path -> contents map.
 * `.bn` notes are always included; `.bak` history is included only when
 * `includeHistory` is set. Keys use POSIX separators so archives are portable
 * across platforms.
 */
function collectNoteFiles(notesDir: string, includeHistory: boolean): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(notesDir)) return files;

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      log.warn(`[BackupService] Could not read notes dir ${dir}:`, err);
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const isBn = entry.name.endsWith('.bn');
      const isBak = entry.name.endsWith('.bak');
      if (isBn || (includeHistory && isBak)) {
        const rel = relative(notesDir, abs).split(sep).join('/');
        try {
          files[rel] = readFileSync(abs, 'utf-8');
        } catch (err) {
          log.warn(`[BackupService] Could not read note file ${abs}:`, err);
        }
      }
    }
  };

  walk(notesDir);
  return files;
}

/**
 * Write bundled note files back into the notes directory. In `replace` mode an
 * existing file is overwritten; in `merge` mode an existing file is preserved
 * (so a locally-newer note is not clobbered - restore only fills in what's
 * missing). Paths that would escape `notesDir` are rejected. Returns the count
 * of files written.
 *
 * Exported for `__tests__/BackupService.test.ts`: the traversal guard cannot be
 * reached through `restoreBackup`, because building an archive that carries a
 * `../` path means encrypting a payload by hand, and a test that stopped short
 * of that would only be checking that ordinary files land in the right place.
 */
export function restoreNoteFiles(
  notesDir: string,
  files: Record<string, string>,
  mode: 'merge' | 'replace'
): number {
  const base = resolve(notesDir);
  let restored = 0;

  for (const [rel, content] of Object.entries(files)) {
    const abs = resolve(base, rel);
    // Reject anything that escapes the notes directory (defense against a
    // tampered archive with `../` paths).
    if (abs !== base && !abs.startsWith(base + sep)) {
      log.warn(`[BackupService] Skipping note file outside notes dir: ${rel}`);
      continue;
    }
    if (mode === 'merge' && existsSync(abs)) {
      // Preserve the local copy - don't clobber a note the user still has.
      continue;
    }
    try {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf-8');
      restored++;
    } catch (err) {
      log.warn(`[BackupService] Failed to restore note file ${rel}:`, err);
    }
  }

  return restored;
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password, salt, KDF_PARAMS.keyLen, {
    N: KDF_PARAMS.N,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p,
  });
}

async function encryptPayload(payload: BackupPayload, password: string): Promise<BackupEnvelope> {
  const salt = randomBytes(16);
  const iv = randomBytes(12); // GCM standard nonce length
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    magic: MAGIC,
    version: FORMAT_VERSION,
    algorithm: ALGORITHM,
    kdf: 'scrypt',
    kdfParams: { ...KDF_PARAMS },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

async function decryptEnvelope(envelope: BackupEnvelope, password: string): Promise<BackupPayload> {
  if (envelope.magic !== MAGIC) {
    throw new Error('Not a Bible backup file');
  }
  if (envelope.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported backup version: ${envelope.version}`);
  }
  if (envelope.algorithm !== ALGORITHM || envelope.kdf !== 'scrypt') {
    throw new Error(`Unsupported backup algorithm: ${envelope.algorithm}/${envelope.kdf}`);
  }
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const key = await scrypt(password, salt, envelope.kdfParams.keyLen, {
    N: envelope.kdfParams.N,
    r: envelope.kdfParams.r,
    p: envelope.kdfParams.p,
  });
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM auth failure -> wrong password or tampered file. Surface as a
    // recognisable string so the IPC layer can show a user-friendly message.
    throw new Error('incorrect password or corrupt backup');
  }
  return JSON.parse(plaintext.toString('utf-8')) as BackupPayload;
}

function readEnvelope(path: string): BackupEnvelope {
  const raw = readFileSync(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Not a Bible backup file');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Not a Bible backup file');
  }
  return parsed as BackupEnvelope;
}

/**
 * Create a backup of the user database.
 */
export async function createBackup(
  userDb: IBackupSql,
  options: BackupOptions
): Promise<BackupResult> {
  try {
    log.info('[BackupService] Starting backup...');

    const tables = [...CRITICAL_TABLES, ...IMPORTANT_TABLES];
    if (options.includeHistory) {
      tables.push(...HISTORY_TABLES);
    }

    const metadata: BackupMetadata = {
      version: '1.0',
      appVersion: '1.0.0',
      createdAt: new Date().toISOString(),
      username: options.username || 'default',
      tables: {},
      includeHistory: options.includeHistory || false,
    };

    const tableData: Record<string, unknown[]> = {};
    for (const table of tables) {
      try {
        const tableExists = userDb.queryOne(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          [table]
        );

        if (!tableExists) {
          log.info(`[BackupService] Table ${table} does not exist, skipping`);
          continue;
        }

        validateTableName(table);
        const rows = userDb.queryAll(`SELECT * FROM ${table}`);
        metadata.tables[table] = rows.length;
        tableData[table] = rows;
        log.info(`[BackupService] Exported ${rows.length} rows from ${table}`);
      } catch (err) {
        log.warn(`[BackupService] Could not export table ${table}:`, err);
      }
    }

    // Bundle the .bn file-notes store (documents, sermons, verse notes). These
    // live on the filesystem, not in the user DB, so without this they would be
    // silently absent from every backup.
    let noteFiles: Record<string, string> | undefined;
    if (options.notesDir) {
      noteFiles = collectNoteFiles(options.notesDir, options.includeHistory || false);
      metadata.noteFiles = Object.keys(noteFiles).length;
      log.info(`[BackupService] Bundled ${metadata.noteFiles} note file(s)`);
    }

    const envelope = await encryptPayload(
      { metadata, tables: tableData, files: noteFiles },
      options.password
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup_${metadata.username}_${timestamp}.bbk`;
    const outputPath = join(options.destinationPath, filename);
    writeFileSync(outputPath, JSON.stringify(envelope));

    log.info(`[BackupService] Backup created successfully: ${outputPath}`);
    return { success: true, path: outputPath, metadata };
  } catch (error) {
    const errorMsg = `Backup failed: ${(error as Error).message}`;
    log.error('[BackupService]', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Validate a backup file and extract its metadata.
 */
export async function validateBackup(
  backupPath: string,
  password: string
): Promise<{ valid: boolean; metadata?: BackupMetadata; error?: string }> {
  try {
    if (!existsSync(backupPath)) {
      return { valid: false, error: 'Backup file not found' };
    }
    const envelope = readEnvelope(backupPath);
    const payload = await decryptEnvelope(envelope, password);
    if (!payload.metadata?.version || !payload.metadata.createdAt || !payload.metadata.tables) {
      return { valid: false, error: 'Invalid backup metadata format' };
    }
    return { valid: true, metadata: payload.metadata };
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('incorrect password')) {
      return { valid: false, error: 'Incorrect password' };
    }
    return { valid: false, error: `Validation failed: ${msg}` };
  }
}

/**
 * Restore a backup into the user database.
 */
export async function restoreBackup(
  userDb: IBackupSql,
  options: RestoreOptions
): Promise<RestoreResult> {
  try {
    log.info(`[BackupService] Starting restore (mode: ${options.mode})...`);

    if (!existsSync(options.backupPath)) {
      return { success: false, error: 'Backup file not found' };
    }

    const envelope = readEnvelope(options.backupPath);
    const payload = await decryptEnvelope(envelope, options.password);

    const tablesRestored: string[] = [];
    const rowCounts: Record<string, number> = {};

    userDb.transaction(() => {
      for (const tableName of Object.keys(payload.metadata.tables)) {
        const rows = payload.tables[tableName];
        if (!Array.isArray(rows)) {
          log.warn(`[BackupService] No rows for table ${tableName}, skipping`);
          continue;
        }

        const tableExists = userDb.queryOne(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          [tableName]
        );

        if (!tableExists) {
          log.warn(`[BackupService] Table ${tableName} does not exist in target database, skipping`);
          continue;
        }

        validateTableName(tableName);

        if (options.mode === 'replace') {
          if (!tableName.endsWith('_fts')) {
            userDb.execute(`DELETE FROM ${tableName}`);
            log.info(`[BackupService] Cleared table ${tableName}`);
          }
        }

        if (rows.length > 0) {
          const columns = Object.keys(rows[0] as Record<string, unknown>);
          const placeholders = columns.map(() => '?').join(', ');
          const columnList = columns.join(', ');

          const insertSql = options.mode === 'merge'
            ? `INSERT OR REPLACE INTO ${tableName} (${columnList}) VALUES (${placeholders})`
            : `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders})`;

          for (const row of rows as Record<string, unknown>[]) {
            const values = columns.map(col => row[col] ?? null);
            try {
              userDb.execute(insertSql, values);
            } catch (err) {
              log.warn(`[BackupService] Failed to insert row into ${tableName}:`, err);
            }
          }
        }

        tablesRestored.push(tableName);
        rowCounts[tableName] = rows.length;
        log.info(`[BackupService] Restored ${rows.length} rows to ${tableName}`);
      }

      if (tablesRestored.includes('user_note')) {
        try {
          userDb.execute(`INSERT INTO user_note_fts(user_note_fts) VALUES('rebuild')`);
          log.info('[BackupService] Rebuilt user_note_fts index');
        } catch (err) {
          log.warn('[BackupService] Could not rebuild FTS index:', err);
        }
      }
    });

    // Restore bundled .bn file-notes (outside the DB transaction - they are
    // filesystem writes). Absent on archives taken before file-notes support.
    let noteFilesRestored = 0;
    if (payload.files && options.notesDir) {
      noteFilesRestored = restoreNoteFiles(options.notesDir, payload.files, options.mode);
      log.info(`[BackupService] Restored ${noteFilesRestored} note file(s)`);
    }

    log.info(`[BackupService] Restore complete: ${tablesRestored.length} tables restored`);
    return { success: true, tablesRestored, rowCounts, noteFilesRestored };
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('incorrect password')) {
      return { success: false, error: 'Incorrect password' };
    }
    return { success: false, error: `Restore failed: ${msg}` };
  }
}
