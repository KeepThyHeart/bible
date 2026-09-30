-- Timeline Module Database Schema
-- Database: timeline_[abbreviation].db
-- Purpose: Dated people, reigns, periods and events, each linked to passages, laid out
--          on a zoomable timeline. Dates are kept per chronology so a module can carry
--          one scheme (the shipped module follows Ussher, read literally) or several.
-- Version: 0.1.0
--
-- Time model (normative)
-- ----------------------
-- Every instant is a REAL "day number": the Julian Day Number of the calendar date in
-- the PROLEPTIC JULIAN calendar (the calendar Ussher's Annals use), plus the fraction of
-- the day (hour/24). Julian day numbers are unambiguous across BC/AD (there is no year
-- zero problem), and give a natural precision finer than a year, e.g. the days of Holy
-- Week. `precision` says how much of the value is meaningful: 'millennium', 'century',
-- 'decade', 'year', 'month', 'day', 'hour'. A reader must NOT display more precision
-- than the row states. Uncertainty ranges are `start_min`/`start_max` (and
-- `end_min`/`end_max`), also day numbers.
--
-- Range convention (normative): `verse_id_start` inclusive, `verse_id_end` inclusive,
-- a single verse is expressed as `verse_id_end = verse_id_start`, never as NULL.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -16000;  -- 16MB cache

-- For this module type the writer sets module_type = 'timeline' and
-- format = 'timeline-module'.
-- @include ../shared/module_info.sql
-- @include ../shared/compression_dictionary.sql

-- ============================================================================
-- 1. Chronologies
-- ============================================================================
-- One row per dating scheme. `fallback_id` names the chronology consulted when an
-- item has no date in this one (chain ends at NULL).
CREATE TABLE timeline_chronology (
    chronology_id TEXT PRIMARY KEY,                 -- slug, e.g. 'ussher'
    name          TEXT NOT NULL,                    -- "Ussher (literal)"
    description   TEXT,                             -- one paragraph explaining the scheme
    fallback_id   TEXT REFERENCES timeline_chronology(chronology_id),
    is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    sort_order    INTEGER NOT NULL DEFAULT 0
);

-- ============================================================================
-- 2. Lanes
-- ============================================================================
-- A lane is a horizontal band of related items (Judah, Israel, Prophets, Events).
CREATE TABLE timeline_lane (
    lane_id     TEXT PRIMARY KEY,                   -- slug, e.g. 'judah'
    name        TEXT NOT NULL,
    group_name  TEXT,                               -- optional heading shared by lanes
    color_key   TEXT,                               -- theme token suffix, e.g. 'judah'
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ============================================================================
-- 3. Items
-- ============================================================================
-- source_type = 'timeline_item', source_id = timeline_item.item_id.
-- The passages of an item are its verse_link rows; link_type 'primary_passage' marks
-- the one the "Read" button opens.
CREATE TABLE timeline_item (
    item_id     INTEGER PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,               -- stable key for updates, e.g. 'hezekiah-judah'
    kind        TEXT NOT NULL,                      -- 'reign' | 'life' | 'period' | 'event' | 'ministry'
                                                    -- Open set, no CHECK. Spans have an end date;
                                                    -- points do not.
    lane_id     TEXT NOT NULL REFERENCES timeline_lane(lane_id),
    title       TEXT NOT NULL,
    summary     TEXT,                               -- one or two sentences for the card
    entity_category TEXT,                           -- soft link to the tag graph
    entity_id   TEXT,                               --   (people/places/...); never enforced
    sort_order  INTEGER NOT NULL DEFAULT 0,
    reviewed_by TEXT,                               -- NULL = draft, not yet reviewed
    metadata    TEXT                                -- JSON
);
CREATE INDEX idx_timeline_item_lane ON timeline_item(lane_id, sort_order);

-- ============================================================================
-- 4. Dates
-- ============================================================================
-- At most one row per (item, chronology). `end_day` NULL = a point in time.
CREATE TABLE timeline_date (
    item_id       INTEGER NOT NULL REFERENCES timeline_item(item_id) ON DELETE CASCADE,
    chronology_id TEXT NOT NULL REFERENCES timeline_chronology(chronology_id),
    start_day     REAL NOT NULL,
    end_day       REAL,
    start_min     REAL,                             -- earliest the start could be (NULL = exact)
    start_max     REAL,
    end_min       REAL,
    end_max       REAL,
    precision     TEXT NOT NULL DEFAULT 'year',
    circa         INTEGER NOT NULL DEFAULT 0 CHECK (circa IN (0, 1)),
    basis         TEXT,                             -- how the date was derived, e.g. "1 Kgs 6:1"
    PRIMARY KEY (item_id, chronology_id)
);
CREATE INDEX idx_timeline_date_chronology ON timeline_date(chronology_id, start_day);

-- ============================================================================
-- 5. Passages
-- ============================================================================
-- @include ../shared/verse_link.sql

-- NOTE for writers: verse_link has no foreign key to timeline_item. Deleting an item
-- must delete its links explicitly:
--     DELETE FROM verse_link WHERE source_type = 'timeline_item' AND source_id = ?;

-- @include ../shared/module_feature.sql

-- Licence and attribution per source dataset (shared with the tag graph). Items name their
-- source in `timeline_item.metadata`; this table holds what to credit.
-- @include ../shared/data_source.sql

-- ============================================================================
-- 6. Schema Version
-- ============================================================================

-- @include ../shared/schema_version.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');
