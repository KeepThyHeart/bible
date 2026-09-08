-- Extension state and storage tables.
--
-- Spec A §"Storage schema additions" (Chunk 2). These tables live inside the
-- per-user encrypted database (user_<username>.db) so backups and per-user
-- isolation come for free from the existing user-DB lifecycle.
--
-- DDL is mirrored verbatim in
-- packages/desktop/electron/extensions/extensionSchema.ts (the runtime
-- applies the TS version because the user DB is opened from the main
-- process, not from disk-loaded SQL files). Keep both copies in sync.

-- ─── extensions: state of each known extension ────────────────────────────
CREATE TABLE IF NOT EXISTS extensions (
  id                  TEXT PRIMARY KEY,            -- 'ext.publisher.name'
  version             TEXT NOT NULL,
  install_path        TEXT NOT NULL,               -- absolute path; under data/extensions/ unless dev_mode
  enabled             INTEGER NOT NULL DEFAULT 1,
  granted_permissions TEXT NOT NULL,               -- JSON array of permission strings
  installed_at        INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  last_error          TEXT,                        -- last load/crash error message
  crash_count_session INTEGER NOT NULL DEFAULT 0,
  signature_status    TEXT,                        -- Ed25519 verification result at install time
  signature_key       TEXT,                        -- hex public key when verified
  folder_grant_path   TEXT,                        -- user-granted managed folder, if any
  folder_grant_date   TEXT,                        -- ISO 8601 date of the folder grant
  dev_mode            INTEGER NOT NULL DEFAULT 0,  -- 1 = unpacked, run in place, watched for rebuilds
  CHECK (enabled IN (0, 1)),
  CHECK (dev_mode IN (0, 1))
);

-- ─── extension_storage: KV store, namespaced by extension ID ──────────────
CREATE TABLE IF NOT EXISTS extension_storage (
  extension_id TEXT NOT NULL,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,                      -- JSON-encoded
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (extension_id, key)
);

CREATE INDEX IF NOT EXISTS idx_extension_storage_ext ON extension_storage(extension_id);
