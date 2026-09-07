-- User Database Schema
-- Database: user_[username].db
-- Purpose: User-specific data -- notes, markup, bookmarks, reading plans,
--          journal, prayer, and application state.
-- Version: 0.1.0
-- Generated: 2025-10-10
--
-- ============================================================================
-- What this file is
-- ============================================================================
-- This is the CURRENT schema: what a brand-new user database is created from.
-- It is the end state, not a historical baseline.
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
-- Ranges:     verse_id_start is INCLUSIVE; verse_id_end is INCLUSIVE. A single
--             verse is `verse_id_end = verse_id_start`, never NULL (R-1). Where
--             the ANCHOR ITSELF is optional (user_note, pinned_item) both columns
--             are nullable together -- never one without the other.
--             Normative for every table in every database.
-- Offsets:    word indices are 0-based and inclusive.
-- Colours:    hex #RRGGBB everywhere (user_text_markup.color, collection.color,
--             user_commentary.color). The six-name palette is a UI constant,
--             not a storage format.
-- Enums:      CHECK is kept only for sets closed by the domain (booleans,
--             content_format, visibility, status, value_type). Open sets
--             (note_type, item_type, plan_type, link_type, source_type,
--             search_type, module_type) carry no CHECK -- SQLite cannot alter
--             one, so growing a closed list would mean rebuilding the table.
--             They are validated in TypeScript at the repository boundary.

-- ============================================================================
-- Pragmas and Initialization
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -32000;  -- 32MB cache

-- ============================================================================
-- 1. User Profile
-- ============================================================================

CREATE TABLE user_profile (
    profile_id INTEGER PRIMARY KEY CHECK (profile_id = 1),  -- Singleton guard: exactly one row. One
                                                    -- database is one profile; multiple users mean
                                                    -- multiple database files, not multiple rows.
    username TEXT NOT NULL UNIQUE,                  -- Local login/identity name. UNIQUE is vestigial
                                                    -- given the singleton guard above.
    display_name TEXT,                              -- Name shown in the UI, if different from username
    email TEXT,                                     -- Optional, for sync or account linking. Never
                                                    -- required to use the app locally.
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC when the profile was created
    last_login TEXT,                                -- ISO-8601 UTC of the most recent sign-in
    preferences TEXT,                               -- JSON: user preferences. Distinct from the
                                                    -- `setting` table, which holds app-wide settings.
    metadata TEXT                                   -- JSON: anything not modelled above
);

-- ============================================================================
-- 2. User-Generated Content
-- ============================================================================

-- 2.1 User Commentary Collections (notebooks)
CREATE TABLE user_commentary (
    user_commentary_id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Notebook id; user_note rows reference it
    name TEXT NOT NULL,                             -- "My Study Notes"
    description TEXT,                               -- What this notebook is for
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    modified_date TEXT DEFAULT CURRENT_TIMESTAMP,   -- ISO-8601 UTC, updated when the notebook itself
                                                    -- changes. Not touched by edits to its notes.
    is_default INTEGER DEFAULT 0,                   -- 1 = where a new note lands when the user picks no
                                                    -- notebook. Nothing enforces that only one row sets
                                                    -- it; the repository maintains that.
    color TEXT,                                     -- Hex #RRGGBB
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (is_default IN (0, 1))
);

-- 2.2 User Notes
--
-- `note_type` is an OPEN set -- no CHECK. Known values: verse_note, document,
-- sermon, study, journal, prayer. Validated in TypeScript.
--
-- `sort_order` gives siblings under `parent_note_id` a user-controllable order.
-- Without it a notes tree could only fall back to insertion order.
CREATE TABLE user_note (
    note_id INTEGER PRIMARY KEY AUTOINCREMENT,      -- Note id. What verse_link.source_id points at,
                                                    -- what children reference as parent_note_id, and
                                                    -- the FTS table's rowid.
    user_commentary_id INTEGER,                     -- NULL for documents
    parent_note_id INTEGER,                         -- For hierarchical notes
    verse_id_start INTEGER,                         -- Primary passage start (inclusive); NULL = note is
                                                    -- not anchored to scripture at all
    verse_id_end INTEGER,                           -- inclusive. NOT NULL alongside a NOT NULL start
                                                    -- everywhere the range is mandatory; here the whole
                                                    -- anchor is optional, so both stay nullable together.
                                                    -- When start is present, end must be too.
    title TEXT,                                     -- Note title. Optional: a verse note is usually
                                                    -- identified by its passage instead.
    content TEXT NOT NULL,                          -- Rich text (see content_format)
    content_format TEXT DEFAULT 'html',             -- Closed set
    note_type TEXT DEFAULT 'verse_note',            -- What kind of note this is; the code branches on
                                                    -- it. Source of truth: NOTE_TYPES in
                                                    -- Data/Core/Types.ts. Open set, no CHECK:
                                                    --   'verse_note'  Anchored to a passage (default)
                                                    --   'document'    Free-standing; no anchor, and
                                                    --                 user_commentary_id is NULL
                                                    --   'sermon'      Sermon manuscript or outline;
                                                    --                 often uses series_name
                                                    --   'study'       Study notes
                                                    --   'journal'     Journal-style entry kept as a
                                                    --                 note. Distinct from the
                                                    --                 journal_entry table, which is
                                                    --                 the dedicated journal.
                                                    --   'prayer'      Prayer note. Likewise distinct
                                                    --                 from prayer_item.
    document_type TEXT,                             -- 'Sermon', 'Study Note', 'Journal', 'Prayer'.
                                                    -- A user-facing display label, unlike `note_type`
                                                    -- which the code branches on.
    visibility TEXT DEFAULT 'private',              -- Closed set (see CHECK): private|public. Governs
                                                    -- whether the note is included when content is
                                                    -- shared or exported.
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    modified_date TEXT DEFAULT CURRENT_TIMESTAMP,   -- ISO-8601 UTC, updated on every edit. Indexed
                                                    -- DESC below for the "recent notes" list.
    tags TEXT,                                      -- JSON: array of tags. Free-form user labels,
                                                    -- indexed by the FTS table so they are searchable.
    series_name TEXT,                               -- Groups notes into a named sequence (a sermon
                                                    -- series). Free text, so a series exists only as
                                                    -- the notes that name it.
    entry_date TEXT,                                -- The date the note is ABOUT -- when a sermon was
                                                    -- preached, what day a journal entry covers -- as
                                                    -- opposed to created_date, when it was typed.
    sort_order INTEGER NOT NULL DEFAULT 0,          -- Sibling order under parent_note_id
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (user_commentary_id) REFERENCES user_commentary(user_commentary_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_note_id) REFERENCES user_note(note_id) ON DELETE CASCADE,

    CHECK (content_format IN ('html', 'markdown', 'plain')),
    CHECK (visibility IN ('private', 'public'))
);

CREATE INDEX idx_user_note_commentary ON user_note(user_commentary_id);
CREATE INDEX idx_user_note_parent ON user_note(parent_note_id, sort_order);
CREATE INDEX idx_user_note_type ON user_note(note_type);
CREATE INDEX idx_user_note_date ON user_note(entry_date);
CREATE INDEX idx_user_note_modified ON user_note(modified_date DESC);
CREATE INDEX idx_user_note_verse_start ON user_note(verse_id_start);
CREATE INDEX idx_user_note_verse_end ON user_note(verse_id_end);
CREATE INDEX idx_user_note_verse_range ON user_note(verse_id_start, verse_id_end);

-- ONE table for every kind of user content that points at scripture. Replaces
-- the three legacy shapes below it. `source_type` and `link_type` are open
-- sets and deliberately carry no CHECK.
--
--   source_type   'note', 'journal', 'prayer', 'document', ...
--   link_type     'reference', 'annotation', 'primary_passage', 'cross_reference', ...
--
-- No foreign key: `source_id` is polymorphic. Referential integrity is the
-- repository's job, which is the price of a single table over one per type.
--
-- In the user database the owner is whatever user content made the link:
-- source_type = 'note' | 'journal' | 'prayer' | 'document', source_id = that
-- row's primary key.
-- @include ../shared/verse_link.sql

-- 2.4 User Text Markup (highlights, underlines, ...)
--
-- `color` stores hex #RRGGBB, matching collection.color. No CHECK: the palette
-- is open, and SQLite cannot alter a CHECK. The default six-colour palette
-- lives in the UI as a constant. `metadata.colorName` records the original
-- palette name when one was supplied.
CREATE TABLE user_text_markup (
    markup_id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Markup id; nothing references it
    module_id INTEGER NOT NULL,                     -- References main.db module_metadata.module_id.
                                                    -- A soft reference across database files, so it can
                                                    -- dangle if the module is uninstalled. Markup is
                                                    -- per-translation because word offsets are.
    verse_id_start INTEGER NOT NULL,                -- inclusive
    verse_id_end INTEGER NOT NULL,                  -- inclusive; single verse is expressed as end = start
    text_start INTEGER,                             -- Word index in first verse (0-based, inclusive)
    text_end INTEGER,                               -- Word index in last verse (0-based, inclusive)
    color TEXT NOT NULL,                            -- Hex #RRGGBB
    note_id INTEGER,                                -- Optional link to user_note
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    metadata TEXT,                                  -- JSON: markupType, underlineStyle, colorName, ...

    FOREIGN KEY (note_id) REFERENCES user_note(note_id) ON DELETE SET NULL
);

CREATE INDEX idx_markup_verse_start ON user_text_markup(verse_id_start);
CREATE INDEX idx_markup_verse_end ON user_text_markup(verse_id_end);
CREATE INDEX idx_markup_module ON user_text_markup(module_id);
CREATE INDEX idx_markup_color ON user_text_markup(color);
CREATE INDEX idx_markup_note ON user_text_markup(note_id);

-- 2.5 User Cross-References
--
-- BOTH ends are ranges, inclusive at both bounds, per the range convention. A
-- user connecting the Beatitudes to Psalm 1 is linking two passages, not two
-- verses, and forcing that into single verse ids would lose what they meant.
--
-- This matches how a cross-reference MODULE stores the same relation: there,
-- `cross_reference_group` holds a source range and each target is a `verse_link`
-- row with its own range (see CrossReference.sql). The user's table stays a
-- single flat row rather than adopting that two-table shape, because a user
-- cross-reference is one source to one target -- there is no phrase group
-- fanning out to many targets to model.
--
-- A single verse is `verse_id_end = verse_id_start`, never NULL, so every
-- containment probe is uniform:
--     WHERE from_verse_id_start <= :v AND from_verse_id_end >= :v
CREATE TABLE user_cross_reference (
    user_xref_id INTEGER PRIMARY KEY AUTOINCREMENT, -- Row id; nothing references it
    from_verse_id_start INTEGER NOT NULL,           -- Source passage the user linked FROM (inclusive)
    from_verse_id_end INTEGER NOT NULL,             -- inclusive; single verse is expressed as end = start
    to_verse_id_start INTEGER NOT NULL,             -- Target passage it points TO (inclusive)
    to_verse_id_end INTEGER NOT NULL,               -- inclusive; single verse is expressed as end = start.
                                                    -- Directional: the reverse link is a separate row,
                                                    -- if the user wants one.
    notes TEXT,                                     -- Why the user made the connection
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (from_verse_id_end >= from_verse_id_start),
    CHECK (to_verse_id_end >= to_verse_id_start)
);

-- Range plus reverse-pair indexes on each end, so a containment probe can be
-- driven from either bound -- the same pattern as verse_link.
CREATE INDEX idx_user_xref_from ON user_cross_reference(from_verse_id_start, from_verse_id_end);
CREATE INDEX idx_user_xref_from_covering ON user_cross_reference(from_verse_id_end, from_verse_id_start);
CREATE INDEX idx_user_xref_to ON user_cross_reference(to_verse_id_start, to_verse_id_end);
CREATE INDEX idx_user_xref_to_covering ON user_cross_reference(to_verse_id_end, to_verse_id_start);

-- 2.6 Collections
CREATE TABLE collection (
    collection_id INTEGER PRIMARY KEY AUTOINCREMENT,-- Collection id; pinned_item rows reference it
    parent_collection_id INTEGER,                   -- NULL for top-level
    name TEXT NOT NULL,                             -- Display name
    description TEXT,                               -- What the user is collecting here
    color TEXT,                                     -- Hex #RRGGBB
    icon TEXT,                                      -- Icon identifier or emoji
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    modified_date TEXT DEFAULT CURRENT_TIMESTAMP,   -- ISO-8601 UTC, updated when the collection itself
                                                    -- changes. Not touched by adding or removing pins.
    sort_order INTEGER DEFAULT 0,                   -- Order within parent collection
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (parent_collection_id) REFERENCES collection(collection_id) ON DELETE CASCADE
);

CREATE INDEX idx_collection_parent ON collection(parent_collection_id, sort_order);

-- 2.7 Pinned Items
--
-- `item_type` is an OPEN set -- no CHECK. Known values: verse, passage, note,
-- commentary, dictionary_entry, book_section, image.
CREATE TABLE pinned_item (
    pin_id INTEGER PRIMARY KEY AUTOINCREMENT,       -- Pin id; nothing references it
    collection_id INTEGER NOT NULL,                 -- Owning collection. Required -- a pin always lives
                                                    -- in a collection; CASCADE deletes it with one.
    item_type TEXT NOT NULL,                        -- What is pinned. Decides how reference_id and
                                                    -- module_id are read. Source of truth: ITEM_TYPES
                                                    -- in Data/Core/Types.ts. Open set, no CHECK:
                                                    --   'verse'             One verse; uses the range
                                                    --                       columns, reference_id NULL
                                                    --   'passage'           A verse range; likewise
                                                    --   'note'              -> user_note.note_id
                                                    --   'commentary'        -> commentary_entry.entry_id
                                                    --                       in the module named by
                                                    --                       module_id
                                                    --   'dictionary_entry'  -> dictionary_entry.entry_id
                                                    --                       in that module
                                                    --   'book_section'      -> book_section.section_id
                                                    --                       in that module
                                                    --   'image'             An image; located via
                                                    --                       reference_text/metadata
    verse_id_start INTEGER,                         -- inclusive; NULL = not a scripture pin
    verse_id_end INTEGER,                           -- inclusive; nullable in step with start (see user_note)
    reference_id INTEGER,                           -- Generic FK for non-verse types -- a note_id, a
                                                    -- commentary entry_id, and so on. Which table it
                                                    -- addresses is decided by `item_type`, so this is
                                                    -- polymorphic and unenforceable; for a module's
                                                    -- content it is only meaningful with `module_id`.
    reference_text TEXT,                            -- Human-readable form of what is pinned, cached at
                                                    -- pin time so the list renders without opening
                                                    -- every referenced database -- and still reads
                                                    -- sensibly if the target is gone.
    module_id INTEGER,                              -- References main.db module_metadata.module_id when
                                                    -- the pin points into module content. NULL for a
                                                    -- pin on the user's own material.
    title TEXT,                                     -- User's label for the pin, overriding
                                                    -- reference_text in the UI when set
    notes TEXT,                                     -- Why the user pinned it
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    sort_order INTEGER DEFAULT 0,                   -- Manual order within the collection
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (collection_id) REFERENCES collection(collection_id) ON DELETE CASCADE
);

CREATE INDEX idx_pinned_collection ON pinned_item(collection_id, sort_order);
CREATE INDEX idx_pinned_verse_start ON pinned_item(verse_id_start);
CREATE INDEX idx_pinned_verse_end ON pinned_item(verse_id_end);
CREATE INDEX idx_pinned_reference ON pinned_item(reference_id);

-- ============================================================================
-- 3. Reading & Spiritual Practice
-- ============================================================================

-- 3.1 Reading Plans
--
-- `plan_type` is an OPEN set -- no CHECK. Known values: canonical,
-- chronological, thematic, nt_only, ot_only, gospels, custom.
CREATE TABLE reading_plan (
    plan_id INTEGER PRIMARY KEY AUTOINCREMENT,      -- Plan id; days and progress rows reference it
    name TEXT NOT NULL,                             -- Display name: "M'Cheyne One-Year"
    description TEXT,                               -- What the plan covers and how it works
    plan_type TEXT,                                 -- How the plan orders scripture. Source of truth:
                                                    -- PLAN_TYPES in Data/Core/Types.ts. Open set, no
                                                    -- CHECK:
                                                    --   'canonical'      Genesis to Revelation, in order
                                                    --   'chronological'  In the order events occurred
                                                    --   'thematic'       Grouped by subject
                                                    --   'nt_only'        New Testament only
                                                    --   'ot_only'        Old Testament only
                                                    --   'gospels'        The four Gospels
                                                    --   'custom'         User-built; no fixed pattern
                                                    -- Descriptive only -- the actual readings are the
                                                    -- reading_plan_day / _passage rows.
    duration_days INTEGER,                          -- Intended length. Should agree with the count of
                                                    -- reading_plan_day rows, but nothing enforces it --
                                                    -- it is stated up front, before days are generated.
    is_builtin INTEGER DEFAULT 0,                   -- 1 = shipped with the app. Distinguishes plans the
                                                    -- user may freely edit or delete from those an
                                                    -- update may replace.
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (is_builtin IN (0, 1))
);

-- 3.2 Reading Plan Days
CREATE TABLE reading_plan_day (
    day_id INTEGER PRIMARY KEY AUTOINCREMENT,       -- Day id; passages reference it
    plan_id INTEGER NOT NULL,                       -- Owning plan; CASCADE deletes days with it
    day_number INTEGER NOT NULL,                    -- Natural ordering; no sort_order needed. 1-based,
                                                    -- an offset from the reader's own start_date, not
                                                    -- a calendar date -- so a plan works started any day.
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (plan_id) REFERENCES reading_plan(plan_id) ON DELETE CASCADE,
    UNIQUE(plan_id, day_number)
);

CREATE INDEX idx_plan_day ON reading_plan_day(plan_id, day_number);

-- 3.3 Reading Plan Passages
CREATE TABLE reading_plan_passage (
    passage_id INTEGER PRIMARY KEY AUTOINCREMENT,   -- Row id; nothing references it
    day_id INTEGER NOT NULL,                        -- Owning day; CASCADE deletes passages with it
    session_name TEXT,                              -- "Morning", "Evening", ...
    verse_id_start INTEGER NOT NULL,                -- inclusive
    verse_id_end INTEGER NOT NULL,                  -- inclusive; single verse is expressed as end = start
    sort_order INTEGER DEFAULT 0,                   -- Reading order within the day (and within a
                                                    -- session, where session_name is used)
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (day_id) REFERENCES reading_plan_day(day_id) ON DELETE CASCADE
);

CREATE INDEX idx_reading_passage_day ON reading_plan_passage(day_id, sort_order);
CREATE INDEX idx_reading_passage_session ON reading_plan_passage(day_id, session_name);

-- 3.4 User Reading Progress
CREATE TABLE user_reading_progress (
    progress_id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Row id. One per attempt at a plan, so a plan read
                                                    -- twice has two rows.
    plan_id INTEGER NOT NULL,                       -- Which plan is being read
    start_date TEXT NOT NULL,                       -- ISO-8601 date the reader began. day_number 1 maps
                                                    -- to this date, which is how a plan's relative days
                                                    -- become calendar days.
    current_day INTEGER DEFAULT 1,                  -- Where the reader is now -- their own position,
                                                    -- which may lag or lead the calendar.
    completed_days TEXT,                            -- JSON: array of day numbers. An array rather than
                                                    -- a counter because readers skip and return: days
                                                    -- may be completed out of order.
    notes TEXT,                                     -- Reader's notes on this time through the plan
    status TEXT DEFAULT 'active',                   -- Closed set (see CHECK): active|paused|completed
    estimated_completion_date TEXT,                 -- ISO-8601 projection from current pace. Derived
                                                    -- and advisory; recomputed, never authoritative.
    streak_days INTEGER DEFAULT 0,                  -- Consecutive days read, for encouragement.
                                                    -- Maintained by the app, not by SQL.
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (plan_id) REFERENCES reading_plan(plan_id) ON DELETE CASCADE,

    CHECK (status IN ('active', 'paused', 'completed'))
);

CREATE INDEX idx_reading_progress_plan ON user_reading_progress(plan_id, status);

-- 3.5 Prayer Items
--
-- `linked_verses` is legacy: verse links now belong in `verse_link` with
-- source_type='prayer'. Migration 006 backfills it. Kept for compatibility.
CREATE TABLE prayer_item (
    prayer_id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Prayer id. Updates reference it, and verse_link
                                                    -- rows cite it with source_type='prayer'.
    title TEXT NOT NULL,                            -- Short label for the request
    description TEXT,                               -- The request in full
    category TEXT,                                  -- User's own grouping ("Family", "Missions").
                                                    -- Free text: categories exist only as the prayers
                                                    -- naming them.
    priority INTEGER DEFAULT 0,                     -- 0-5 (see CHECK), 0 = unprioritised. A closed
                                                    -- numeric domain, so the CHECK is kept.
    status TEXT DEFAULT 'active',                   -- Closed set (see CHECK):
                                                    -- active|answered|ongoing|archived. 'ongoing' is a
                                                    -- standing prayer with no expected end; 'archived'
                                                    -- is set aside without being answered.
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    answered_date TEXT,                             -- ISO-8601 UTC. Set alongside status='answered';
                                                    -- NULL otherwise.
    reminder_date TEXT,                             -- ISO-8601 of the next reminder. With
                                                    -- reminder_recurrence, the app advances it.
    reminder_recurrence TEXT,                       -- Closed set (see CHECK):
                                                    -- daily|weekly|monthly|once, or NULL for no
                                                    -- reminder.
    tags TEXT,                                      -- JSON: array of user tags
    linked_verses TEXT,                             -- JSON: array of verse_ids (legacy -- see verse_link)
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (priority BETWEEN 0 AND 5),
    CHECK (status IN ('active', 'answered', 'ongoing', 'archived')),
    CHECK (reminder_recurrence IN ('daily', 'weekly', 'monthly', 'once', NULL))
);

CREATE INDEX idx_prayer_status ON prayer_item(status);
CREATE INDEX idx_prayer_reminder ON prayer_item(reminder_date);

-- 3.6 Prayer Updates
CREATE TABLE prayer_update (
    update_id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Row id; nothing references it
    prayer_id INTEGER NOT NULL,                     -- Owning prayer; CASCADE deletes updates with it
    update_text TEXT NOT NULL,                      -- What has happened since. Append-only by
                                                    -- convention -- the history of a prayer is the
                                                    -- point, so updates are added, not edited.
    update_date TEXT DEFAULT CURRENT_TIMESTAMP,     -- ISO-8601 UTC; indexed DESC for newest-first
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (prayer_id) REFERENCES prayer_item(prayer_id) ON DELETE CASCADE
);

CREATE INDEX idx_prayer_update_prayer ON prayer_update(prayer_id, update_date DESC);

-- 3.7 Journal Entries
CREATE TABLE journal_entry (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,     -- Entry id. verse_link rows cite it with
                                                    -- source_type='journal'.
    title TEXT,                                     -- Optional; entries are usually found by date
    content TEXT NOT NULL,                          -- The entry body, in content_format
    content_format TEXT DEFAULT 'html',             -- Closed set (see CHECK): html|markdown|plain
    entry_date TEXT NOT NULL,                       -- Natural ordering; no sort_order needed. The date
                                                    -- the entry is ABOUT, which is why it and not
                                                    -- created_date drives the index below.
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC when it was written -- may be well
                                                    -- after entry_date
    modified_date TEXT DEFAULT CURRENT_TIMESTAMP,   -- ISO-8601 UTC of the last edit
    tags TEXT,                                      -- JSON: array of user tags
    mood TEXT,                                      -- Optional free-text mood label, for readers who
                                                    -- track it. No fixed vocabulary.
    is_encrypted INTEGER DEFAULT 0,                 -- 1 = `content` is ciphertext, not plaintext. It
                                                    -- must then be decrypted before display, and it is
                                                    -- not meaningfully searchable.
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (content_format IN ('html', 'markdown', 'plain')),
    CHECK (is_encrypted IN (0, 1))
);

CREATE INDEX idx_journal_date ON journal_entry(entry_date DESC);

-- ============================================================================
-- 4. Application State
-- ============================================================================

-- 4.1 Sessions
CREATE TABLE session (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT,   -- Session id; navigation_history references it
    name TEXT NOT NULL,                             -- User's name for this saved workspace
    description TEXT,                               -- What the session is for
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    modified_date TEXT DEFAULT CURRENT_TIMESTAMP,   -- ISO-8601 UTC when the session was last SAVED
    last_opened TEXT,                               -- ISO-8601 UTC when it was last RESTORED. Distinct
                                                    -- from modified_date: opening is not saving.
    is_autosave INTEGER DEFAULT 0,                  -- 1 = the app's own rolling snapshot of current
                                                    -- state, not a session the user deliberately saved.
                                                    -- Hidden from the session list and overwritten
                                                    -- freely.
    is_default INTEGER DEFAULT 0,                   -- 1 = restored on a cold start when there is no
                                                    -- autosave to resume
    session_data TEXT NOT NULL,                     -- JSON: full session state
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (is_autosave IN (0, 1)),
    CHECK (is_default IN (0, 1))
);

CREATE INDEX idx_session_autosave ON session(is_autosave);
CREATE INDEX idx_session_default ON session(is_default);
CREATE INDEX idx_session_last_opened ON session(last_opened DESC);

-- Identical in shape to main.db's `setting`. `category` has a
-- default so two-column writers keep working.
-- @include ../shared/setting.sql

-- No index on `category`: UNIQUE(category, key) already creates one whose
-- leftmost column is `category`, and SQLite uses it for `WHERE category = ?`
-- (and for `... ORDER BY key` within a category) on its own. A standalone
-- index on `category` is a strict prefix of that autoindex -- it answers no
-- query the autoindex cannot, while costing a second B-tree write on every
-- setting change. Verified with EXPLAIN QUERY PLAN.

-- 4.3 Search History (user-scoped)
--
-- main.db owns the name `search_history` and the two
-- tables had incompatible columns (history_id/searched_date vs
-- search_id/search_date), which made any code generic over "the search history
-- table" wrong against one of them.
CREATE TABLE user_search_history (
    search_id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Row id; nothing references it
    query TEXT NOT NULL,                            -- Query string exactly as typed
    search_type TEXT,                               -- Same vocabulary as main.db saved_search and
                                                    -- search_history (SEARCH_TYPES in
                                                    -- Data/Core/Types.ts). Open set, no CHECK:
                                                    --   'multi-word'       All words, any order
                                                    --   'phrase'           Exact phrase
                                                    --   'proximity'        Words within N words
                                                    --   'verse-proximity'  Words within N verses
                                                    --   'boolean'          AND/OR/NOT expression
                                                    --   'fuzzy'            Approximate matching
                                                    --   'regex'            Regular expression
                                                    --   'strongs'          By Strong's number
    scope TEXT,                                     -- JSON: what was searched over -- modules, books,
                                                    -- verse ranges
    module_id INTEGER,                              -- References main.db module_metadata.module_id when
                                                    -- the search was confined to one module. NULL for a
                                                    -- search across everything.
    result_count INTEGER,                           -- Hits returned, so the history can show which past
                                                    -- searches found nothing. NULL if it errored or was
                                                    -- cancelled.
    search_date TEXT DEFAULT CURRENT_TIMESTAMP,     -- ISO-8601 UTC; indexed DESC for newest-first
    metadata TEXT                                   -- JSON: anything not modelled above
);

CREATE INDEX idx_user_search_history_date ON user_search_history(search_date DESC);

-- 4.4 Navigation History
--
-- `module_type` is the same open set as main.db's module_metadata.module_type.
CREATE TABLE navigation_history (
    nav_id INTEGER PRIMARY KEY AUTOINCREMENT,       -- Row id; nothing references it
    session_id INTEGER NOT NULL,                    -- Owning session; CASCADE clears history with it
    tab_id TEXT NOT NULL,                           -- Which tab within that session. TEXT because tabs
                                                    -- are identified by the client's own id, not by a
                                                    -- database row -- a tab need never be persisted to
                                                    -- have a history.
    module_id INTEGER NOT NULL,                     -- References main.db module_metadata.module_id --
                                                    -- what was being read. Soft, so it can dangle after
                                                    -- an uninstall.
    module_type TEXT,                               -- What kind of module was open in the tab. Same
                                                    -- open set as main.db module_metadata.module_type
                                                    -- (MODULE_TYPES in Data/Core/Types.ts): 'bible',
                                                    -- 'commentary', 'dictionary', 'book', 'devotional',
                                                    -- 'lexicon', 'topical_index', 'cross_reference',
                                                    -- 'tag_graph'. Denormalised alongside module_id so
                                                    -- history renders without opening main.db --
                                                    -- and still reads sensibly after an uninstall.
    verse_id_start INTEGER NOT NULL,                -- inclusive
    verse_id_end INTEGER NOT NULL,                  -- inclusive; single verse is expressed as end = start
    navigation_date TEXT DEFAULT CURRENT_TIMESTAMP, -- ISO-8601 UTC. Ordering back/forward through
                                                    -- history is by this, indexed DESC per tab.
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (session_id) REFERENCES session(session_id) ON DELETE CASCADE
);

CREATE INDEX idx_nav_history_session ON navigation_history(session_id, tab_id, navigation_date DESC);
CREATE INDEX idx_nav_history_module_type ON navigation_history(module_type, navigation_date DESC);

-- 4.5 Layout Presets
CREATE TABLE layout_preset (
    layout_id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Preset id; nothing references it
    name TEXT NOT NULL,                             -- Display name: "Study", "Reading"
    description TEXT,                               -- What the arrangement is good for
    is_stock INTEGER DEFAULT 0,                     -- 1 = shipped with the app. Distinguishes presets an
                                                    -- update may replace from the user's own.
    layout_data TEXT NOT NULL,                      -- JSON: pane configuration
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (is_stock IN (0, 1))
);

-- 4.6 Module Display Options
CREATE TABLE module_display_option (
    option_id INTEGER PRIMARY KEY AUTOINCREMENT,    -- Row id. (module_id, option_key) is the real
                                                    -- identity -- see the UNIQUE below.
    module_id INTEGER NOT NULL,                     -- References main.db module_metadata.module_id
    option_key TEXT NOT NULL,                       -- Which display option: 'showStrongs',
                                                    -- 'showFootnotes'. Per-module, unlike `setting`
                                                    -- which is app-wide.
    option_value TEXT,                              -- Always TEXT; the reader knows the type each key
                                                    -- expects. Booleans are '0'/'1'.
    metadata TEXT,                                  -- JSON: anything not modelled above

    UNIQUE(module_id, option_key)
);

CREATE INDEX idx_module_option ON module_display_option(module_id, option_key);

-- 4.7 Generic Extensible Data Store
--
-- Somewhere for a module -- or a future app feature -- to keep user data the
-- schema does not model. Without it a module has nowhere to put anything of its
-- own: `setting` is one flat app-wide key/value space, `module_display_option`
-- is flat per-module preferences, and per-row `metadata` JSON can only extend a
-- row that already exists.
--
-- The address is three levels: (owner_uuid, collection, item_key) -> value.
--
--   owner_uuid  WHOSE data this is. A module's `module_info.module_uuid`, or
--               'app:<feature>' for the application's own use. Module UUIDs are
--               RFC 4122 and never contain ':', so the two namespaces cannot
--               collide.
--
--               NOT `module_metadata.module_id`, and deliberately not a foreign
--               key. The local install id changes when a module is reinstalled,
--               which would orphan the user's data; the UUID does not. And
--               module_metadata lives in main.db -- a different file -- so
--               SQLite could not enforce a reference anyway. Rows outliving an
--               uninstall is the INTENDED behaviour: uninstalling a module must
--               not silently destroy the notes the user made with it. Sweep for
--               orphans deliberately, never on a cascade.
--
--   collection  WHICH set within that owner: 'settings', 'verse_ratings',
--               'flashcards'. This is what makes the store more than a
--               preferences bag -- one owner keeps as many independently
--               enumerable, independently clearable collections as it likes.
--
--   item_key    The item within the collection. Unique per (owner, collection).
--
-- Anchoring items to scripture -- "custom user metadata for a set of verses" --
-- uses `verse_link`, not columns here: source_type = 'user_data_item',
-- source_id = item_id. That is the one content-to-verse shape in this project,
-- so range containment, multi-passage anchoring and reverse lookup ("what user
-- data touches John 3:16?") all work with no new query code.
--
-- `sync_metadata` picks these rows up for free: it tracks (table_name,
-- record_id) generically.
--
-- WHEN NOT TO USE IT: a store with no schema cannot constrain or index anything
-- inside `value`. It is right for module-owned and experimental data. Once a
-- feature is first-class and needs per-field queries, give it a real table.
CREATE TABLE user_data_item (
    item_id INTEGER PRIMARY KEY AUTOINCREMENT,      -- Item id. What verse_link.source_id points at
                                                    -- when the item is anchored to scripture.
    owner_uuid TEXT NOT NULL,                       -- Owning module's module_uuid, or 'app:<feature>'.
                                                    -- See the block above -- not a FK, by design.
    collection TEXT NOT NULL,                       -- Named set within the owner. Free text; the owner
                                                    -- defines its own vocabulary.
    item_key TEXT NOT NULL,                         -- Key within the collection. Unique per
                                                    -- (owner_uuid, collection) -- see the UNIQUE below.
    value TEXT,                                     -- The payload, always stored as TEXT; parse
                                                    -- according to value_type. NULL means present but
                                                    -- empty, which is distinct from absent.
    value_type TEXT NOT NULL DEFAULT 'json',        -- Closed set (see CHECK), same vocabulary as
                                                    -- `setting.value_type`. Defaults to 'json' here
                                                    -- rather than 'string': a generic store mostly
                                                    -- holds structured values. 'bool' is '0'/'1'.
    sort_order INTEGER NOT NULL DEFAULT 0,          -- Order within the collection, for collections that
                                                    -- are lists rather than maps
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC
    modified_date TEXT DEFAULT CURRENT_TIMESTAMP,   -- ISO-8601 UTC, updated on every write
    metadata TEXT,                                  -- JSON: anything not modelled above

    UNIQUE(owner_uuid, collection, item_key),
    CHECK (value_type IN ('string', 'int', 'bool', 'json'))
);

-- Indexing note, verified with EXPLAIN QUERY PLAN.
--
-- The UNIQUE above already indexes (owner_uuid, collection, item_key), and
-- SQLite uses its leftmost prefixes -- so fetching one item, enumerating a
-- collection, and enumerating everything one owner has stored are all served
-- with no further index. What it does NOT give is ordered output: an
-- enumeration with ORDER BY sort_order falls back to a temp B-tree sort. The
-- index below supplies that order directly, and covers the same lookups.
CREATE INDEX idx_user_data_owner_collection
    ON user_data_item(owner_uuid, collection, sort_order);

-- No standalone index on `collection`. Every query that filters by collection
-- also knows its owner, and that case is already covered. An owner-agnostic
-- sweep ("every 'cache' collection across all modules") would scan -- add
-- `CREATE INDEX ... ON user_data_item(collection)` if such a query ever appears,
-- rather than carrying the write cost for one that has not.

-- ============================================================================
-- 5. Full-Text Search
-- ============================================================================

-- 5.1 User Notes FTS (external content -- user_note is the source of truth)
CREATE VIRTUAL TABLE user_note_fts USING fts5(
    note_id UNINDEXED,        -- Carried for retrieval only, never matched against
    title,                    -- Note title
    content,                  -- Note body; carries most matches
    tags,                     -- The JSON array as stored. Indexed as text, so a
                              -- tag is findable by a plain query -- with the
                              -- brackets and quotes as harmless extra tokens.
    content='user_note',
    content_rowid='note_id',
    tokenize='porter unicode61'
);

-- External-content FTS5 tables must be maintained with the 'delete' command,
-- not with plain UPDATE/DELETE: a plain statement cannot remove the old terms
-- (FTS5 needs the ORIGINAL column values to do that) and leaves the index
-- returning matches for text that is no longer there.
CREATE TRIGGER user_note_fts_insert AFTER INSERT ON user_note BEGIN
    INSERT INTO user_note_fts(rowid, note_id, title, content, tags)
    VALUES (new.note_id, new.note_id, new.title, new.content, new.tags);
END;

CREATE TRIGGER user_note_fts_delete AFTER DELETE ON user_note BEGIN
    INSERT INTO user_note_fts(user_note_fts, rowid, note_id, title, content, tags)
    VALUES ('delete', old.note_id, old.note_id, old.title, old.content, old.tags);
END;

CREATE TRIGGER user_note_fts_update AFTER UPDATE ON user_note BEGIN
    INSERT INTO user_note_fts(user_note_fts, rowid, note_id, title, content, tags)
    VALUES ('delete', old.note_id, old.note_id, old.title, old.content, old.tags);
    INSERT INTO user_note_fts(rowid, note_id, title, content, tags)
    VALUES (new.note_id, new.note_id, new.title, new.content, new.tags);
END;

-- ============================================================================
-- 6. Sync & Cloud
-- ============================================================================

-- One row per synced record, tracking what has changed since the last upload.
-- (table_name, record_id) is a soft polymorphic reference into this same
-- database: no FK is possible against a name held as data, so a row here can
-- outlive the record it describes -- which is exactly what `is_deleted` is for.
CREATE TABLE sync_metadata (
    sync_id INTEGER PRIMARY KEY AUTOINCREMENT,      -- Row id. (table_name, record_id) is the real
                                                    -- identity -- see the UNIQUE below.
    table_name TEXT NOT NULL,                       -- Which table the tracked record lives in
    record_id INTEGER NOT NULL,                     -- Its primary key in that table
    last_modified TEXT NOT NULL,                    -- ISO-8601 UTC of the last local change
    last_synced TEXT,                               -- ISO-8601 UTC of the last successful sync. NULL =
                                                    -- never synced. last_modified > last_synced is what
                                                    -- makes a record pending.
    sync_hash TEXT,                                 -- Content hash at last sync, so an edit that reverts
                                                    -- to the synced content is recognised as a no-op
                                                    -- rather than resent
    device_id TEXT,                                 -- Which device made the change, for conflict
                                                    -- resolution and for not echoing a change back to
                                                    -- its origin
    is_deleted INTEGER DEFAULT 0,                   -- 1 = a tombstone. The record is gone locally but
                                                    -- the row remains, because a deletion has to be
                                                    -- propagated -- an absent row is indistinguishable
                                                    -- from one never created.
    metadata TEXT,                                  -- JSON: anything not modelled above

    UNIQUE(table_name, record_id),
    CHECK (is_deleted IN (0, 1))
);

CREATE INDEX idx_sync_table_record ON sync_metadata(table_name, record_id);
CREATE INDEX idx_sync_modified ON sync_metadata(last_modified);

-- ============================================================================
-- 7. Schema Bookkeeping
-- ============================================================================

-- @include ../shared/schema_migration.sql

-- @include ../shared/schema_version_migratable.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial user database schema');

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');

INSERT INTO setting (category, key, value, value_type, description)
VALUES ('system', '_schema', '0.1.0', 'string', 'Database schema / module format version');
