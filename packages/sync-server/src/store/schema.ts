/**
 * Sync server database schema (design 0063 "Server storage and API", contracts §11). The server owns its own
 * SQLite file, so `PRAGMA user_version` is free for its migrations. Each migration is a list of single
 * statements (ISql.execute runs one statement at a time). Times are epoch ms; hashes are raw SHA-256 BLOBs;
 * wrapped keys are the b64url wire strings, stored as given.
 */

export const MIGRATIONS: readonly (readonly string[])[] = [
  // v1
  [
    `CREATE TABLE account (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      kdf_json TEXT NOT NULL,
      auth_hash BLOB NOT NULL,
      recovery_auth_hash BLOB NOT NULL,
      wrapped_ak_password TEXT NOT NULL,
      wrapped_ak_recovery TEXT NOT NULL,
      wrapped_idk TEXT NOT NULL,
      current_epoch INTEGER NOT NULL,
      next_seq INTEGER NOT NULL DEFAULT 1,
      bytes_used INTEGER NOT NULL DEFAULT 0,
      quota_bytes INTEGER,
      created_at INTEGER NOT NULL,
      delete_after INTEGER
    )`,
    'CREATE INDEX account_delete_after ON account (delete_after) WHERE delete_after IS NOT NULL',
    `CREATE TABLE keyset (
      account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
      epoch INTEGER NOT NULL,
      wrapped_data_key TEXT NOT NULL,
      PRIMARY KEY (account_id, epoch)
    )`,
    `CREATE TABLE device (
      account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name_sealed TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, id)
    )`,
    `CREATE TABLE session (
      token_hash BLOB PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('normal', 'recovery')),
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_agent TEXT
    )`,
    'CREATE INDEX session_account ON session (account_id, device_id)',
    'CREATE INDEX session_expires ON session (expires_at)',
    `CREATE TABLE record (
      account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      blob BLOB,
      size INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, id)
    )`,
    'CREATE UNIQUE INDEX record_seq ON record (account_id, seq)',
    `CREATE TABLE email_token (
      token_hash BLOB PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES account (id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
      expires_at INTEGER NOT NULL
    )`,
    'CREATE INDEX email_token_account ON email_token (account_id)',
    'CREATE INDEX email_token_expires ON email_token (expires_at)',
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;
