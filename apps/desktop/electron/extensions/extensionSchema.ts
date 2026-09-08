/**
 * Extension state and storage schema.
 *
 * Mirrors `apps/desktop/sql/user_db_extensions.sql` - keep both in sync.
 * The runtime applies the TS version because the user DB is opened from the
 * main process and the rest of the app has no DDL-file loader.
 *
 * Tables are created on the existing per-user encrypted database so backups
 * and per-user isolation come for free from the user-DB lifecycle.
 */

import type { ISql } from '@bible/core';

export function initializeExtensionSchema(db: ISql): void {
  // --- extensions: state of each known extension ------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS extensions (
      id                  TEXT PRIMARY KEY,
      version             TEXT NOT NULL,
      install_path        TEXT NOT NULL,
      enabled             INTEGER NOT NULL DEFAULT 1,
      granted_permissions TEXT NOT NULL,
      installed_at        INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL,
      last_error          TEXT,
      crash_count_session INTEGER NOT NULL DEFAULT 0,
      signature_status   TEXT,
      signature_key      TEXT,
      CHECK (enabled IN (0, 1))
    )
  `);

  // Migrate existing databases that don't have the signature columns yet.
  addColumnIfMissing(db, 'extensions', 'signature_status', 'TEXT');
  addColumnIfMissing(db, 'extensions', 'signature_key', 'TEXT');

  // Migrate existing databases that don't have the managed folder columns yet.
  addColumnIfMissing(db, 'extensions', 'folder_grant_path', 'TEXT');
  addColumnIfMissing(db, 'extensions', 'folder_grant_date', 'TEXT');

  // Developer Mode: an unpacked extension run in place rather than copied into
  // `data/extensions/`. Defaulting to 0 is what makes the migration safe -
  // every pre-existing row is, by definition, a packed install.
  addColumnIfMissing(db, 'extensions', 'dev_mode', 'INTEGER NOT NULL DEFAULT 0');

  // Provenance: the catalog this extension was installed from, or
  // NULL for a sideload / Developer-Mode load. Stored rather than derived
  // because it is a historical fact about the install; whether that URL still
  // counts as *the* marketplace is decided at read time against the app's
  // current default-catalog setting (see `DefaultCatalog.ts`), the same way
  // the trusted-publisher set is applied. NULL for every pre-existing row is
  // correct - nothing installed before this column existed came from a
  // catalog.
  addColumnIfMissing(db, 'extensions', 'source_catalog_url', 'TEXT');

  // --- extension_catalog_source: marketplaces the user has added --------
  //
  // `risk_acknowledged_at` is the decision-2 gate: a non-default catalog is
  // only usable once the user has explicitly accepted that its contents are
  // no more vouched-for than a sideload. NULL means the warning has not been
  // accepted and the source must not be fetched.
  db.execute(`
    CREATE TABLE IF NOT EXISTS extension_catalog_source (
      url                  TEXT PRIMARY KEY,
      label                TEXT,
      added_at             INTEGER NOT NULL,
      risk_acknowledged_at INTEGER,
      last_fetched_at      INTEGER,
      last_error           TEXT,
      cached_document      TEXT
    )
  `);

  // --- extension_blocklist: rules from the last manual update check -----
  //
  // Rows are replaced wholesale per source on each fetch, so there is no
  // primary key beyond the implicit rowid: the same id can legitimately
  // appear more than once with different version ranges.
  db.execute(`
    CREATE TABLE IF NOT EXISTS extension_blocklist (
      extension_id TEXT NOT NULL,
      versions     TEXT,
      reason       TEXT NOT NULL,
      url          TEXT,
      source_url   TEXT NOT NULL,
      fetched_at   INTEGER NOT NULL
    )
  `);

  db.execute(
    'CREATE INDEX IF NOT EXISTS idx_extension_blocklist_ext ON extension_blocklist(extension_id)',
  );

  // --- extension_storage: namespaced KV store ---------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS extension_storage (
      extension_id TEXT NOT NULL,
      key          TEXT NOT NULL,
      value        TEXT NOT NULL,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (extension_id, key)
    )
  `);

  db.execute(
    'CREATE INDEX IF NOT EXISTS idx_extension_storage_ext ON extension_storage(extension_id)',
  );
}

/**
 * Add a column to `table` if it doesn't already exist. Allows safe migration
 * of existing databases without requiring a full schema rebuild.
 */
function addColumnIfMissing(db: ISql, table: string, column: string, type: string): void {
  const info = db.queryAll<{ name: string }>(`PRAGMA table_info(${table})`, []);
  if (!info.some((col) => col.name === column)) {
    db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
