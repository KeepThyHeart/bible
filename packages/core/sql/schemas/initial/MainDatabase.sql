-- Main Database Schema
-- Database: main.db
-- Purpose: Core application database -- Bible reference structure, module
--          registry, shared search index, and application settings.
-- Version: 0.1.0
-- Generated: 2025-10-10
--
-- ============================================================================
-- What this file is
-- ============================================================================
-- This is the CURRENT schema: what a brand-new main.db is created from. It is
-- the end state, not a historical baseline.
--
-- An existing database reaches this same state by running the ordered sequence
-- in `packages/core/src/sql/migrations/`. The two must stay in step -- change
-- one, change the other in the same commit. A database created from this file
-- should be BASELINED (see MigrationRunner.baseline) rather than replaying
-- history it never needed.
--
-- ============================================================================
-- Conventions
-- ============================================================================
-- Verse IDs:  verse_id = (book_number * 1000000) + (chapter * 1000) + verse
--             Gen 1:1 = 1001001, John 3:16 = 43003016, Rev 22:21 = 66022021
-- Ranges:     verse_id_start is INCLUSIVE; verse_id_end is INCLUSIVE. A single
--             verse is `verse_id_end = verse_id_start`, never NULL (R-1). Where
--             the ANCHOR ITSELF is optional both columns are nullable together --
--             never one without the other.
--             Normative for every table in every database.
-- Canon:      66-book Protestant canon, standard English (KJV) versification.
-- Enums:      CHECK is kept only for sets closed by the domain (booleans,
--             testament, value_type). Open, extensible sets
--             (module_type, search_type, ...) carry no CHECK -- SQLite cannot
--             alter one, so growing a closed list would mean rebuilding the
--             table. They are validated in TypeScript at the repository
--             boundary.

-- ============================================================================
-- Pragmas and Initialization
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -64000;  -- 64MB cache

-- ============================================================================
-- 1. Bible Reference Structure
-- ============================================================================

-- 1.1 Bible Books
CREATE TABLE bible_book (
    book_id INTEGER PRIMARY KEY AUTOINCREMENT,      -- Surrogate key; FK target for the tables below.
                                                    -- Not the same as book_number -- join on this, but
                                                    -- compute verse_ids from book_number.
    book_number INTEGER NOT NULL UNIQUE,            -- Canonical position, 1-66 (Genesis = 1, Revelation
                                                    -- = 66). The value that enters a verse_id.
    book_name TEXT NOT NULL,                        -- Full English display name: "Genesis", "Matthew"
    book_abbreviation TEXT,                         -- Short display form: "Gen", "Matt". Display only --
                                                    -- reference PARSING accepts many more spellings and
                                                    -- lives in BookNames.ts, not here.
    testament TEXT NOT NULL,                        -- Closed set: "OT", "NT"
    book_group TEXT,                                -- Traditional grouping, for browse UI and grouped
                                                    -- book pickers: "Law", "History", "Gospels",
                                                    -- "Epistles". Free text; NULL if ungrouped.
    chapter_count INTEGER NOT NULL,                 -- Chapters in this book, KJV versification
    verse_count INTEGER NOT NULL,                   -- Total verses in book (sum over its chapters)
    metadata TEXT,                                  -- JSON: additional book data

    CHECK (testament IN ('OT', 'NT')),
    CHECK (book_number BETWEEN 1 AND 66),
    CHECK (chapter_count > 0),
    CHECK (verse_count > 0)
);

CREATE INDEX idx_bible_book_testament ON bible_book(testament);
CREATE INDEX idx_bible_book_group ON bible_book(book_group);
CREATE INDEX idx_bible_book_number ON bible_book(book_number);

-- 1.2 Bible Verse Reference
CREATE TABLE bible_verse_ref (
    verse_id INTEGER PRIMARY KEY,                   -- book*1000000 + chapter*1000 + verse
    absolute_id INTEGER NOT NULL UNIQUE,            -- Sequential 1-based ID (Genesis 1:1 = 1, Revelation
                                                    -- 22:21 = 31102). Gapless, so "next/previous verse"
                                                    -- and "verses between X and Y" are arithmetic;
                                                    -- verse_id is NOT gapless and cannot do that.
    book_id INTEGER NOT NULL,                       -- -> bible_book.book_id (the surrogate, not 1-66)
    chapter INTEGER NOT NULL,                       -- 1-based chapter within the book
    verse INTEGER NOT NULL,                         -- 1-based verse within the chapter
    is_book_start INTEGER DEFAULT 0,                -- 1 if first verse of a book
    is_division_start INTEGER DEFAULT 0,            -- 1 if book start OR Psalms chapter start. Psalms
                                                    -- chapters count as divisions because each psalm is
                                                    -- a standalone work; readers page and title by
                                                    -- division, so both cases need the same flag.
    metadata TEXT,                                  -- JSON: additional data

    FOREIGN KEY (book_id) REFERENCES bible_book(book_id) ON DELETE CASCADE,

    CHECK (chapter > 0),
    CHECK (verse > 0),
    CHECK (is_book_start IN (0, 1)),
    CHECK (is_division_start IN (0, 1))
);

CREATE UNIQUE INDEX idx_verse_ref_absolute ON bible_verse_ref(absolute_id);
CREATE INDEX idx_verse_ref_book_chapter ON bible_verse_ref(book_id, chapter);
CREATE INDEX idx_verse_ref_location ON bible_verse_ref(book_id, chapter, verse);
CREATE INDEX idx_verse_ref_division_start ON bible_verse_ref(is_division_start) WHERE is_division_start = 1;

-- 1.3 Chapter Verse Counts
CREATE TABLE chapter_info (
    chapter_info_id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Surrogate key; nothing references it
    book_id INTEGER NOT NULL,                       -- -> bible_book.book_id
    chapter INTEGER NOT NULL,                       -- 1-based chapter within the book
    verse_count INTEGER NOT NULL,                   -- Verses in this chapter
    first_absolute_id INTEGER NOT NULL,             -- bible_verse_ref.absolute_id of this chapter's
                                                    -- first verse. With last_absolute_id it makes a
                                                    -- chapter a contiguous range, so "load a chapter"
                                                    -- is one BETWEEN, no per-verse lookup.
    last_absolute_id INTEGER NOT NULL,              -- Absolute ID of last verse (INCLUSIVE)
    metadata TEXT,                                  -- JSON: additional data

    FOREIGN KEY (book_id) REFERENCES bible_book(book_id) ON DELETE CASCADE,
    UNIQUE(book_id, chapter),
    CHECK (chapter > 0),
    CHECK (verse_count > 0)
);

CREATE INDEX idx_chapter_info_book ON chapter_info(book_id, chapter);

-- No sort_order is needed anywhere in section 1: bible_book orders by
-- book_number, bible_verse_ref by absolute_id, chapter_info by chapter. Every
-- one is a natural, canonical key.

-- ============================================================================
-- 2. Module Registry
-- ============================================================================

-- 2.1 Module Metadata
--
-- `module_uuid` is the stable identity of a module across versions and is the
-- join key other databases should use. It is NOT NULL: every module is required
-- to conform to the current format, which makes `module_info.module_uuid`
-- mandatory (see shared/module_info.sql), so a registered module always has one.
-- A module file without a UUID is not installable -- reject it at import rather
-- than registering it with a NULL here.
--
-- `module_type` is an OPEN set -- no CHECK. Recognised values:
--     bible, commentary, dictionary, book, devotional, lexicon,
--     topical_index, cross_reference, tag_graph
-- NOT module types: semantic_*.db and enrichments_*.db are app-private caches
-- outside the module contract. They have no module_info and are never
-- registered here.
CREATE TABLE module_metadata (
    module_id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Local install id. Meaningful only in THIS main.db --
                                                    -- reinstalling the same module yields a different
                                                    -- one. Never persist it in exported or synced data;
                                                    -- use module_uuid there.
    module_uuid TEXT NOT NULL,                      -- Stable identity, copied from the module's own
                                                    -- module_info.module_uuid. Survives content
                                                    -- revisions and reinstalls; the join key other
                                                    -- databases should use. Required -- see the note
                                                    -- above.
    module_type TEXT NOT NULL,                      -- What kind of module this is. Source of truth:
                                                    -- MODULE_TYPES in Data/Core/Types.ts. Open set,
                                                    -- no CHECK:
                                                    --   'bible'           A translation
                                                    --   'commentary'      Verse/passage commentary
                                                    --   'dictionary'      Dictionary or lexicon
                                                    --   'lexicon'         Legacy alias; new modules
                                                    --                     use 'dictionary' with a
                                                    --                     dictionary_type of
                                                    --                     '*_lexicon'
                                                    --   'book'            Free-standing book
                                                    --   'devotional'      Dated or sequential readings
                                                    --   'topical_index'   Topic -> passages (Nave's)
                                                    --   'cross_reference' Passage -> passages (TSK)
                                                    --   'tag_graph'       Entity graph (see TagGraph.sql
                                                    --                     -- implemented, unpopulated)
                                                    -- See also the note above this table on what is
                                                    -- deliberately NOT a module type.
    module_name TEXT NOT NULL,                      -- Full display name, e.g. "King James Version".
                                                    -- From module_info.full_name.
    abbreviation TEXT,                              -- Display/legacy key, e.g. "KJV". NOT unique and NOT
                                                    -- an identity: two unrelated modules may both claim
                                                    -- "KJV". Superseded by module_uuid.
    version TEXT,                                   -- Installed content version, from
                                                    -- module_info.version. Compared against
                                                    -- module_update.available_version; parsed by
                                                    -- ModuleVersion.ts, not by string compare.
    language_code TEXT,                             -- Language of the module's CONTENT, copied from
                                                    -- module_info.language_code. ISO 639-1 two-letter
                                                    -- where one exists ("en", "es", "he"), ISO 639-3
                                                    -- three-letter where none does ("grc" Ancient
                                                    -- Greek, "hbo" Biblical Hebrew). Lowercase, no
                                                    -- region or script subtag. NULL only when the
                                                    -- source module declared none.
    installed_date TEXT DEFAULT CURRENT_TIMESTAMP,  -- ISO-8601 UTC. When this install first happened.
    last_updated TEXT,                              -- ISO-8601 UTC. When the module was last upgraded in
                                                    -- place. NULL if never updated since install.
    database_path TEXT NOT NULL,                    -- Path to the module's .db file, relative to the app
                                                    -- data modules directory. Relative so a profile
                                                    -- stays portable across machines and OSes.
    size_bytes INTEGER,                             -- On-disk size of that file, for the storage UI.
                                                    -- A snapshot at install/update, not kept live.
    is_indexed INTEGER DEFAULT 0,                   -- 1 once this module's book-level rows exist in
                                                    -- bible_search_index (section 3). Bible modules
                                                    -- only; stays 0 for every other type.
    last_indexed_date TEXT,                         -- ISO-8601 UTC of that indexing run
    features TEXT,                                  -- JSON array of feature flags this module provides
                                                    -- (e.g. "strongs", "red_letter"). Vocabulary and
                                                    -- validation live in ModuleMetadata.ts.
    sword_metadata TEXT,                            -- JSON: the original SWORD .conf keys, kept verbatim
                                                    -- for modules imported from a SWORD repository so
                                                    -- an import can be re-run or audited. NULL for
                                                    -- natively built modules.
    repository_id INTEGER,                          -- -> module_repository.repository_id, where this
                                                    -- module came from. NULL for sideloaded or
                                                    -- bundled-with-the-app modules.
    update_available INTEGER DEFAULT 0,             -- 1 when a matching module_update row exists.
                                                    -- Denormalised so the library list does not join.
    last_used_date TEXT,                            -- ISO-8601 UTC, for recency sorting
    usage_count INTEGER DEFAULT 0,                  -- Times opened, for frequency sorting
    user_hidden INTEGER DEFAULT 0,                  -- 1 = hide from pickers WITHOUT uninstalling. The
                                                    -- module stays installed and searchable by uuid.
    is_cross_reference_module INTEGER DEFAULT 0,    -- 1 = supplies cross-references rather than readable
                                                    -- content, e.g. Treasury of Scripture Knowledge.
                                                    -- A flag, not a module_type, because such a module
                                                    -- may also be a normal commentary.
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (is_indexed IN (0, 1)),
    CHECK (update_available IN (0, 1)),
    CHECK (user_hidden IN (0, 1)),
    CHECK (is_cross_reference_module IN (0, 1))
);

CREATE INDEX idx_module_type ON module_metadata(module_type);
CREATE INDEX idx_module_language ON module_metadata(language_code);
CREATE INDEX idx_module_indexed ON module_metadata(is_indexed) WHERE is_indexed = 0;
CREATE INDEX idx_module_repository ON module_metadata(repository_id);
CREATE INDEX idx_module_hidden ON module_metadata(user_hidden) WHERE user_hidden = 0;
CREATE INDEX idx_module_update ON module_metadata(update_available) WHERE update_available = 1;
CREATE INDEX idx_module_xref_flag ON module_metadata(is_cross_reference_module) WHERE is_cross_reference_module = 1;
-- Full, not partial: module_uuid is NOT NULL, so there are no rows to exempt.
-- One installed row per UUID -- installing a module you already have is an
-- update, not a second row.
CREATE UNIQUE INDEX idx_module_uuid ON module_metadata(module_uuid);

-- 2.2 Module Repositories
CREATE TABLE module_repository (
    repository_id INTEGER PRIMARY KEY AUTOINCREMENT,-- Local id, referenced by module_metadata
    name TEXT NOT NULL,                             -- Display name, e.g. "CrossWire Bible Society"
    abbreviation TEXT,                              -- Short display form, e.g. "CrossWire"
    url TEXT NOT NULL UNIQUE,                       -- Catalog endpoint. UNIQUE, so the URL is the real
                                                    -- identity of a repository -- the same source cannot
                                                    -- be registered twice under two names.
    type TEXT NOT NULL,                             -- 'official', 'crosswire', 'third_party', 'local'
    is_enabled INTEGER DEFAULT 1,                   -- 0 = keep the row but skip it when fetching catalogs
    priority INTEGER DEFAULT 0,                     -- Higher = searched first. Breaks ties when the same
                                                    -- module is offered by several repositories.
    catalog_json TEXT,                              -- Cached catalog document from the last successful
                                                    -- fetch, so the module browser works offline.
    last_updated TEXT,                              -- ISO-8601 UTC. When the catalog CONTENT last
                                                    -- changed.
    last_fetched TEXT,                              -- ISO-8601 UTC. When it was last requested, changed
                                                    -- or not -- this is what the refresh interval reads.
    metadata TEXT,                                  -- JSON: anything not modelled above
    signature_status TEXT,                          -- Last verified detached-signature status (see CatalogTypes.ts)
    signing_public_key TEXT,                        -- Hex Ed25519 key observed on first use (trust-on-first-use)

    CHECK (type IN ('official', 'crosswire', 'third_party', 'local')),
    CHECK (is_enabled IN (0, 1))
);

CREATE INDEX idx_repo_enabled ON module_repository(is_enabled, priority);

-- No repository is seeded here on purpose. The official catalog URL is not a
-- compile-time constant: it comes from the BIBLE_MODULE_CATALOG_URL build
-- setting and is inserted at runtime (see applyMigration002 in
-- apps/desktop/electron/utils/initMainDatabase.ts). Hardcoding a URL here
-- would register a repository the build may not actually point at, and left
-- fresh databases advertising an endpoint that does not resolve.

-- 2.3 Module Download Queue
CREATE TABLE module_download_queue (
    queue_id INTEGER PRIMARY KEY AUTOINCREMENT,     -- Queue entry id
    module_id TEXT NOT NULL,                        -- The catalog's own identifier for the module, as a
                                                    -- STRING. Not module_metadata.module_id -- nothing
                                                    -- is installed yet, so there is no local row to
                                                    -- point at.
    module_name TEXT NOT NULL,                      -- Display name, denormalised so the queue renders
                                                    -- without re-fetching the catalog
    download_url TEXT NOT NULL,                     -- Direct URL of the module archive
    download_size_bytes INTEGER,                    -- Expected total, from the catalog. NULL if the
                                                    -- catalog did not state one; progress is then
                                                    -- indeterminate.
    status TEXT DEFAULT 'pending',                  -- Closed set, see CHECK below. 'paused' is
                                                    -- user-initiated; 'failed' carries error_message.
    progress_bytes INTEGER DEFAULT 0,               -- Bytes received so far. Resume point for a paused
                                                    -- or retried download.
    download_speed_bps INTEGER,                     -- Last observed bytes/second, for the ETA readout
    started_date TEXT,                              -- ISO-8601 UTC, first transition to 'downloading'
    completed_date TEXT,                            -- ISO-8601 UTC, transition to 'completed'
    error_message TEXT,                             -- Failure detail when status = 'failed'; NULL
                                                    -- otherwise
    retry_count INTEGER DEFAULT 0,                  -- Automatic retries already spent on this entry
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (status IN ('pending', 'downloading', 'completed', 'failed', 'paused'))
);

CREATE INDEX idx_download_status ON module_download_queue(status);

-- 2.4 Available Module Updates
CREATE TABLE module_update (
    update_id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Update-offer id
    module_id INTEGER NOT NULL,                     -- -> module_metadata.module_id. An INTEGER local id
                                                    -- here, unlike the queue above, because the module
                                                    -- IS installed -- that is what makes this an update.
    current_version TEXT NOT NULL,                  -- Version installed when this offer was recorded.
                                                    -- Stale if the module was updated by another route;
                                                    -- re-check against module_metadata.version.
    available_version TEXT NOT NULL,                -- Version the repository is offering
    release_date TEXT,                              -- ISO-8601 UTC release date of that version
    changelog TEXT,                                 -- Release notes text, for the update dialog
    download_url TEXT NOT NULL,                     -- Direct URL of the new version's archive
    download_size_bytes INTEGER,                    -- Expected download size, from the catalog
    is_critical INTEGER DEFAULT 0,                  -- 1 = the repository flagged this as important
                                                    -- (corrupt text, licensing). Surfaced more
                                                    -- insistently; still never auto-installed.
    user_ignored INTEGER DEFAULT 0,                 -- 1 = user dismissed THIS version. The row is kept,
                                                    -- not deleted, so the next catalog fetch does not
                                                    -- re-offer what was already declined.
    notified_date TEXT,                             -- ISO-8601 UTC the user was last told. NULL = not
                                                    -- yet shown.
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (module_id) REFERENCES module_metadata(module_id) ON DELETE CASCADE,
    CHECK (is_critical IN (0, 1)),
    CHECK (user_ignored IN (0, 1))
);

CREATE INDEX idx_update_module ON module_update(module_id);
CREATE INDEX idx_update_available ON module_update(user_ignored) WHERE user_ignored = 0;

-- ============================================================================
-- 3. Shared Search Index
-- ============================================================================
-- Verse-level FTS lives inside each bible_*.db. These book-level structures
-- live here, in main.db, because the index is built per module per book and is
-- shared across users.

-- 3.1 Book-level FTS index (enables proximity search across verse boundaries)
--
-- One row per (module, book). The whole book is indexed as a single document so
-- a NEAR query can match across a verse boundary -- something the per-verse FTS
-- inside each bible_*.db cannot do, since there each verse is its own document.
-- The cost is that a hit is an offset into book text, not a verse; 3.3 maps it
-- back.
--
-- (type, document, division) is the composite key shared by all three tables in
-- this section. All three columns are TEXT, including `division`, so the triple
-- stays one uniform shape as `type` grows beyond "bible".
CREATE VIRTUAL TABLE bible_search_index USING fts5(
    type UNINDEXED,           -- Content kind. "bible" today; the column exists so
                              -- commentaries and books can share these tables later.
    document UNINDEXED,       -- Which module, by abbreviation. A soft key -- see the
                              -- warning on `abbreviation` in 2.1. Safe only because
                              -- these rows are a derived cache scoped to one machine
                              -- and are rebuilt, never synced or exported.
    division UNINDEXED,       -- Book number as a STRING ("1".."66"), to keep the key
                              -- triple uniformly TEXT.
    text,                     -- Complete book text, verses concatenated in canonical
                              -- order. The only indexed column.
    tokenize='porter unicode61'
);

-- 3.2 Index status
CREATE TABLE bible_search_index_metadata (
    index_id INTEGER PRIMARY KEY AUTOINCREMENT,     -- Status-row id
    type TEXT NOT NULL,                             -- Key triple, matching 3.1. A row may exist here
    document TEXT NOT NULL,                         -- with is_indexed = 0 before any bible_search_index
    division TEXT NOT NULL,                         -- row is written -- that is how work is queued.
    last_indexed TEXT,                              -- ISO-8601 UTC of the last successful pass. NULL
                                                    -- while pending.
    is_indexed INTEGER DEFAULT 0,                   -- 1 = this (module, book) is fully indexed. The
                                                    -- partial index below makes finding the 0s cheap.
    word_count INTEGER,                             -- Words indexed for this book, for progress
                                                    -- reporting and rough result-density estimates
    metadata TEXT,                                  -- JSON: anything not modelled above

    UNIQUE(type, document, division),
    CHECK (is_indexed IN (0, 1))
);

CREATE INDEX idx_search_index_status ON bible_search_index_metadata(is_indexed) WHERE is_indexed = 0;
CREATE INDEX idx_search_index_lookup ON bible_search_index_metadata(type, document, division);
CREATE INDEX idx_search_metadata_type_doc ON bible_search_index_metadata(type, document);

-- 3.3 Verse position mapping (FTS match position -> verse_id)
CREATE TABLE bible_search_verse_positions (
    position_id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Position-row id
    type TEXT NOT NULL,                             -- Key triple, matching 3.1 -- identifies which
    document TEXT NOT NULL,                         -- book document these offsets are measured in.
    division TEXT NOT NULL,                         --
    verse_id INTEGER NOT NULL,                      -- The verse occupying that span, in the standard
                                                    -- book*1000000 + chapter*1000 + verse encoding
    start_index INTEGER NOT NULL,                   -- Offset into bible_search_index.text. INCLUSIVE.
                                                    -- Half-open [start, end) here -- deliberately
                                                    -- unlike verse_id ranges elsewhere, which are
                                                    -- inclusive on both ends. These are string offsets
                                                    -- in a concatenated document, so adjacent verses
                                                    -- must abut exactly: verse N's end IS verse N+1's
                                                    -- start.
    end_index INTEGER NOT NULL,                     -- EXCLUSIVE -- see start_index

    CHECK (start_index >= 0),
    CHECK (end_index > start_index)
);

CREATE INDEX idx_verse_position_lookup ON bible_search_verse_positions(type, document, division, verse_id);
CREATE INDEX idx_verse_position_range ON bible_search_verse_positions(type, document, division, start_index, end_index);
CREATE INDEX idx_search_positions_verse ON bible_search_verse_positions(verse_id);
CREATE INDEX idx_search_positions_division ON bible_search_verse_positions(type, document, division);

-- 3.4 Saved Searches
CREATE TABLE saved_search (
    search_id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Saved-search id
    name TEXT NOT NULL,                             -- User's label for this search
    query TEXT NOT NULL,                            -- Query string exactly as typed, unparsed, so it
                                                    -- can be re-run and edited as the user wrote it
    search_type TEXT,                               -- How `query` is to be interpreted. Source of
                                                    -- truth: SEARCH_TYPES in Data/Core/Types.ts. Open
                                                    -- set, no CHECK:
                                                    --   'multi-word'       All words, any order
                                                    --   'phrase'           Exact phrase
                                                    --   'proximity'        Words within N words
                                                    --   'verse-proximity'  Words within N verses
                                                    --   'boolean'          AND/OR/NOT expression
                                                    --   'fuzzy'            Approximate matching
                                                    --   'regex'            Regular expression
                                                    --   'strongs'          By Strong's number
                                                    -- NULL = the app's current default.
    scope TEXT,                                     -- JSON: what to search over -- which modules, which
                                                    -- books or verse ranges, testament filters
    options TEXT,                                   -- JSON: how to search -- case sensitivity, whole
                                                    -- word, proximity distance, result ordering
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    last_used TEXT,                                 -- ISO-8601 UTC of the last re-run. NULL if never
                                                    -- re-run since it was saved.
    use_count INTEGER DEFAULT 0,                    -- Times re-run, for frequency sorting
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (use_count >= 0)
);

CREATE INDEX idx_saved_search_last_used ON saved_search(last_used DESC);
CREATE INDEX idx_saved_search_use_count ON saved_search(use_count DESC);
CREATE INDEX idx_saved_search_date ON saved_search(created_date DESC);

-- 3.5 Search History (canonical definition)
--
-- Two `search_history` tables used to exist -- one here, one in the user
-- database -- with different columns and the same name, so a query's meaning
-- depended on which connection ran it. The user database's copy was renamed to
-- `user_search_history`; this is now the only `search_history` in the system.
--
-- The split is intentional, not merely a name fix. This table is app-wide
-- telemetry for the search box; `user_search_history` is per-profile data that
-- syncs with the user's other content.
CREATE TABLE search_history (
    history_id INTEGER PRIMARY KEY AUTOINCREMENT,   -- History-entry id
    query TEXT NOT NULL,                            -- Query string exactly as typed
    search_type TEXT,                               -- Same vocabulary as saved_search.search_type
                                                    -- above (SEARCH_TYPES in Data/Core/Types.ts):
                                                    -- 'multi-word', 'phrase', 'proximity',
                                                    -- 'verse-proximity', 'boolean', 'fuzzy', 'regex',
                                                    -- 'strongs'.
    result_count INTEGER,                           -- Hits returned, so the history list can show which
                                                    -- past searches found nothing. NULL if the search
                                                    -- errored or was cancelled before completing.
    searched_date TEXT DEFAULT CURRENT_TIMESTAMP,   -- ISO-8601 UTC
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (result_count >= 0)
);

CREATE INDEX idx_search_history_date ON search_history(searched_date DESC);

-- ============================================================================
-- 4. Application Settings
-- ============================================================================
-- Same shape as the user database's `setting` table. `category` has a default
-- so two-column writers -- `INSERT INTO setting (key, value) VALUES (...)` --
-- keep working.
-- @include ../shared/setting.sql

-- No index on `category`: UNIQUE(category, key) already creates one whose
-- leftmost column is `category`, and SQLite uses it for `WHERE category = ?`
-- (and for `... ORDER BY key` within a category) on its own. A standalone
-- index on `category` is a strict prefix of that autoindex -- it answers no
-- query the autoindex cannot, while costing a second B-tree write on every
-- setting change. Verified with EXPLAIN QUERY PLAN.

INSERT INTO setting (category, key, value, value_type, description)
VALUES ('system', '_schema', '0.1.0', 'string', 'Database schema / module format version');

-- ============================================================================
-- 5. Schema Bookkeeping
-- ============================================================================

-- Two tables, two jobs:
--
--   `schema_migration` -- one row per migration script actually applied, the
--     ledger MigrationRunner reads to decide what still needs running. A
--     database created from THIS file has applied none of them and must be
--     baselined (MigrationRunner.baseline) so history it never needed is not
--     replayed. Maintained by MigrationRunner; see sql/migrations/README.md.
--
--   `schema_version` -- append-only human-readable notes about what the schema
--     reached and when. Nothing branches on it; it is provenance, not control
--     flow, which is why it carries no UNIQUE constraint.
-- @include ../shared/schema_migration.sql

-- @include ../shared/schema_version_migratable.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Main database schema - Bible reference structure and module registry');

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');
