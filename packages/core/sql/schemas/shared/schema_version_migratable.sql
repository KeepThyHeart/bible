-- Append-only provenance, as in schema_version.sql, plus two columns for
-- databases that migrate in place (main.db, the user database) rather than
-- being replaced wholesale like module content.
--
-- Note the division with `schema_migration`: THAT table is the ledger the
-- MigrationRunner reads to decide what still needs applying. This one is a
-- human-readable history. The scripts below are kept for forensics -- so a
-- database can say what was actually run against it, even if the migration
-- files on disk have since changed -- not as the source the runner executes.
CREATE TABLE schema_version (
    version_id INTEGER PRIMARY KEY AUTOINCREMENT,   -- Row id; ordering is by insertion
    version_number TEXT NOT NULL,                   -- Schema version reached, e.g. '0.1.0'
    applied_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC when it was reached
    migration_script_up TEXT,                       -- The SQL actually applied to reach this version,
                                                    -- recorded verbatim. NULL for a version created
                                                    -- from the schema file rather than by migration.
    migration_script_down TEXT,                     -- The reverse SQL, where the migration was written
                                                    -- to be reversible. NULL when it was not.
    notes TEXT,                                     -- Human-readable description of the change
    metadata TEXT                                   -- JSON: anything not modelled above
);
