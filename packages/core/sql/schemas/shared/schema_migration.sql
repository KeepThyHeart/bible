CREATE TABLE schema_migration (
    version TEXT PRIMARY KEY,                       -- 'NNN' prefix of the migration filename
    name TEXT NOT NULL,                             -- Remainder of the filename, for readable logs
    applied_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- ISO-8601 UTC when this migration ran
    checksum TEXT NOT NULL                          -- Hash of the script as executed. Re-checked on
                                                    -- startup so an edit to an already-applied
                                                    -- migration is caught loudly, rather than
                                                    -- silently leaving databases in different shapes.
);
