CREATE TABLE setting (
    setting_id INTEGER PRIMARY KEY AUTOINCREMENT,   -- Row id. (category, key) is the real identity --
                                                    -- see the UNIQUE below.
    category TEXT NOT NULL DEFAULT 'general',       -- Namespace for the key. 'system' for internal keys
                                                    -- the app manages; anything else is user-facing.
                                                    -- Defaulted so two-column writers --
                                                    -- INSERT INTO setting (key, value) -- keep working.
    key TEXT NOT NULL,                              -- Setting name, unique within its category
    value TEXT,                                     -- Always stored as TEXT regardless of value_type;
                                                    -- parse according to that column. NULL means set
                                                    -- but empty, which is distinct from absent.
    value_type TEXT DEFAULT 'string',               -- Closed set (see CHECK): how to parse `value`.
                                                    -- 'bool' is stored as '0'/'1'.
    description TEXT,                               -- What this setting does, for a settings UI or for
                                                    -- someone reading the table directly
    metadata TEXT,                                  -- JSON: anything not modelled above

    UNIQUE(category, key),
    CHECK (value_type IN ('string', 'int', 'bool', 'json'))
);
