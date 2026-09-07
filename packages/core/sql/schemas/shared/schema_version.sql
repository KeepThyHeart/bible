-- Append-only provenance: what schema version this database reached, and when.
-- Nothing branches on it -- it is a record for humans reading a database after
-- the fact, not control flow -- which is why it carries no UNIQUE constraint and
-- rows are never updated or deleted.
--
-- This is the MODULE variant. Module databases are immutable content, replaced
-- wholesale on update rather than migrated in place, so it holds no migration
-- scripts. Databases that DO migrate use schema_version_migratable.sql instead.
CREATE TABLE schema_version (
    version_id INTEGER PRIMARY KEY AUTOINCREMENT,   -- Row id; ordering is by insertion
    version_number TEXT NOT NULL,                   -- Schema version reached, e.g. '0.1.0'
    applied_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC when it was reached
    notes TEXT,                                     -- Human-readable description of the change
    metadata TEXT                                   -- JSON: anything not modelled above
);
