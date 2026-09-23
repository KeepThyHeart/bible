-- Commentary Module Database Schema
-- Database: commentary_[abbreviation].db
-- Purpose: Individual commentary content
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
PRAGMA cache_size = -32000;  -- 32MB cache

-- For this module type the writer sets module_type = 'commentary' and
-- format = 'commentary-module'.
-- @include ../shared/module_info.sql
-- @include ../shared/compression_dictionary.sql

-- ============================================================================
-- 1. Commentary Entries
-- ============================================================================

-- 1.1 Commentary Entry Table
-- verse_id_start/verse_id_end anchor the entry to the passage it comments on
-- (inclusive start, inclusive end). commentary_entry is anchor-optional: a
-- book/chapter-level entry leaves BOTH columns NULL; where an anchor is present
-- both are populated and a single verse is expressed as end = start (R-1), never
-- as a NULL end.
CREATE TABLE commentary_entry (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,     -- Entry id. What verse_link.source_id points at,
                                                    -- and the FTS table's rowid.
    verse_id_start INTEGER,                         -- For passage-level entries (inclusive). NULL for
                                                    -- entry_level='book'/'chapter', which comment on no
                                                    -- specific verse range.
    verse_id_end INTEGER,                           -- inclusive; nullable in step with start. Where the
                                                    -- range exists at all, both columns are populated and
                                                    -- a single verse is expressed as end = start.
    entry_level TEXT NOT NULL,                      -- Granularity of what this entry comments on.
                                                    -- Source of truth: ENTRY_LEVELS in
                                                    -- Data/Core/Types.ts. Open set, no CHECK:
                                                    --   'book'     Whole-book introduction. No verse
                                                    --              anchor -- both range columns NULL.
                                                    --   'chapter'  Chapter introduction. Also unanchored.
                                                    --   'passage'  A verse range: start..end.
                                                    --   'verse'    A single verse: end = start.
                                                    -- Every shipped commentary uses only 'verse'.
    content TEXT NOT NULL,                          -- Commentary text
    content_file TEXT,                              -- OR path to external file
    word_count INTEGER,                             -- Words in `content`, for reading-time estimates
                                                    -- and for sizing an entry before loading it.
                                                    -- A snapshot at import; not maintained.
    metadata TEXT                                   -- JSON: anything not modelled above

    -- no CHECK on entry_level. It is an open/extensible set and SQLite cannot
    -- alter a CHECK constraint without a full table rebuild. Validation lives in
    -- TypeScript (packages/core/src/Data/Core/Types.ts) and is enforced at the
    -- repository boundary.
);

-- idx_entry_verse_start (verse_id_start) was dropped: it is a strict prefix of
-- idx_entry_range (verse_id_start, verse_id_end) below.
CREATE INDEX idx_entry_range ON commentary_entry(verse_id_start, verse_id_end);
CREATE INDEX idx_entry_level ON commentary_entry(entry_level);

-- Unified content->verse linking. This table is byte-identical in every module
-- schema and in the user database. For commentaries it carries cross-references
-- parsed out of entry content at import time (e.g. TSK's
-- <a href="passagestudy.jsp?action=showRef&value=Ge+1%3A1"> anchors) as rows with
-- link_type='cross_reference', plus any additional scripture citations.
--
-- In a commentary module: source_type = 'commentary_entry',
-- source_id = commentary_entry.entry_id.
-- @include ../shared/verse_link.sql

-- @include ../shared/module_feature.sql

-- ============================================================================
-- 2. Schema Version
-- ============================================================================

-- @include ../shared/schema_version.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');
