-- Devotional Module Database Schema
-- Database: devotional_[abbreviation].db
-- Purpose: Daily devotional content
-- Version: 0.1.0
-- Generated: 2025-10-10
--
-- Range convention (normative): `verse_id_start` inclusive, `verse_id_end` inclusive,
-- a single verse is expressed as `verse_id_end = verse_id_start`, never as NULL.
-- Never `start_verse_id`/`end_verse_id`.

-- ============================================================================
-- Pragmas and Initialization
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -16000;  -- 16MB cache

-- ============================================================================
-- 1. Module Information
-- ============================================================================

-- For this module type the writer sets module_type = 'devotional' and
-- format = 'devotional-module'.
-- @include ../shared/module_info.sql

-- Devotional specifics. Added by ALTER because the included block is shared with
-- every other module type and must stay one definition. SQLite requires a
-- non-NULL default when adding a NOT NULL column; the table is empty at
-- creation, so the default exists only to satisfy that rule.
--
-- devotional_type -- how the work is paced, which decides how entries are
-- addressed. Source of truth: DevotionalType in
-- packages/core/src/Data/Models/Devotional/DevotionalModuleInfo.ts. CLOSED here
-- (a rare CHECK on a *_type column) because these three exhaust the ways a
-- devotional can be structured.
--
--   'day_of_year'   Tied to the calendar. day_number is 1-365; entry 1 is
--                   January 1. total_days = 365 (366 where leap day is given).
--   'fixed_length'  A course of N days started whenever the reader likes.
--                   day_number is 1..N. total_days = N, e.g. 40.
--   'continuous'    Open-ended, no fixed length. day_number is NULL on every
--                   entry and `sort_order` alone gives the reading order --
--                   which is why sort_order exists on devotional_entry.
--                   total_days is NULL.
ALTER TABLE module_info ADD COLUMN devotional_type TEXT NOT NULL DEFAULT 'continuous'
    CHECK (devotional_type IN ('day_of_year', 'fixed_length', 'continuous'));

-- total_days -- intended length: 365 for 'day_of_year', N for 'fixed_length',
-- NULL for 'continuous'. Advisory; nothing enforces it against the entry count.
ALTER TABLE module_info ADD COLUMN total_days INTEGER;

-- ============================================================================
-- 2. Devotional Entries
-- ============================================================================

CREATE TABLE devotional_entry (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,     -- Entry id. What verse_link.source_id points at,
                                                    -- and the FTS table's rowid.
    day_number INTEGER,                             -- 1-365 or sequential; NULL for 'continuous'
    sort_order INTEGER NOT NULL DEFAULT 0,          -- authoritative reading order. day_number is
                                                    -- nullable (devotional_type='continuous'), so it
                                                    -- cannot order every module.
    date_label TEXT,                                -- "January 1" or "Morning"
    title TEXT,                                     -- Entry title. Optional: dated devotionals are
                                                    -- often titled only by their date_label.
    content TEXT NOT NULL,                          -- Devotional text
    scripture_reference TEXT,                       -- DISPLAY label as the author wrote it,
                                                    -- e.g. "John 3:16-17", "Ps 23 (NIV)".
                                                    -- KEPT: carries the author's own citation
                                                    -- wording/abbreviation/translation note, which the
                                                    -- structured verse_link rows cannot reproduce.
    scripture_text TEXT,                            -- Embedded verse text (optional)
    author_note TEXT,                               -- Closing note, prayer or attribution the author
                                                    -- set apart from the main `content`
    metadata TEXT,                                  -- JSON: anything not modelled above

    -- Retained: SQLite treats NULLs as distinct in a UNIQUE index, so this still
    -- permits the many NULL day_numbers of a 'continuous' devotional.
    UNIQUE(day_number)
);

CREATE INDEX idx_devotional_day ON devotional_entry(day_number);
CREATE INDEX idx_devotional_date ON devotional_entry(date_label);
CREATE INDEX idx_devotional_sort ON devotional_entry(sort_order);

-- Unified content->verse linking. This table is byte-identical in every module
-- schema and in the user database. It replaces the JSON `scripture_verses` column
-- that used to live on `devotional_entry`.
--
-- In a devotional module: source_type = 'devotional_entry',
-- source_id = devotional_entry.entry_id.
-- @include ../shared/verse_link.sql

-- ============================================================================
-- 3. Full-Text Search
-- ============================================================================

-- FTS5 external-content table: it stores only the index, reading column values
-- back from the base table via `content=`/`content_rowid=`. The triggers below
-- keep the two in step.
CREATE VIRTUAL TABLE devotional_entry_fts USING fts5(
    entry_id UNINDEXED,       -- Carried for retrieval only, never matched against
    title,                    -- Entry title
    content,                  -- Devotional body text
    content='devotional_entry',
    content_rowid='entry_id',
    tokenize='porter unicode61'
);

-- Triggers
-- External-content FTS5 tables do not own their data, so rows must be removed with
-- the special 'delete' command carrying the OLD column values. A plain
-- DELETE/UPDATE against the FTS table leaves stale terms in the index.
CREATE TRIGGER devotional_entry_fts_insert AFTER INSERT ON devotional_entry BEGIN
    INSERT INTO devotional_entry_fts(rowid, entry_id, title, content)
    VALUES (new.entry_id, new.entry_id, new.title, new.content);
END;

CREATE TRIGGER devotional_entry_fts_delete AFTER DELETE ON devotional_entry BEGIN
    INSERT INTO devotional_entry_fts(devotional_entry_fts, rowid, entry_id, title, content)
    VALUES ('delete', old.entry_id, old.entry_id, old.title, old.content);
END;

CREATE TRIGGER devotional_entry_fts_update AFTER UPDATE ON devotional_entry BEGIN
    INSERT INTO devotional_entry_fts(devotional_entry_fts, rowid, entry_id, title, content)
    VALUES ('delete', old.entry_id, old.entry_id, old.title, old.content);
    INSERT INTO devotional_entry_fts(rowid, entry_id, title, content)
    VALUES (new.entry_id, new.entry_id, new.title, new.content);
END;

-- ============================================================================
-- 4. Schema Version
-- ============================================================================

-- @include ../shared/schema_version.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');
