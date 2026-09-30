CREATE TABLE data_source (
    id          TEXT PRIMARY KEY,                   -- 'tipnr', 'bibledata', 'curated'
    name        TEXT NOT NULL,                      -- "STEPBible Tagged Individuals (TIPNR)"
    licence     TEXT NOT NULL,                      -- 'CC BY 4.0'. Allow-listed by the module builder.
    url         TEXT,
    attribution TEXT,                               -- Credit line to show
    notes       TEXT                                -- e.g. the change log required by the source
);
