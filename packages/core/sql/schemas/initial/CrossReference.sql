-- Cross-Reference Module Database Schema
-- Database: xref_[abbreviation].db
-- Purpose: Phrase-grouped scripture cross-references (Treasury of Scripture Knowledge, ...)
-- Version: 0.1.0
-- Generated: 2026-07-24
--
-- This schema had no schema file before v2: its DDL lived only inside
-- `scripts/import-tsk.js`. Promoted here.
--
-- Shape: a source verse owns an ordered list of phrase groups ("For God so loved"),
-- and each group owns an ordered list of target passages. The groups are the module's
-- own content; the targets are verse links and therefore live in `verse_link`.
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

-- For this module type the writer sets module_type = 'cross_reference' and
-- format = 'cross-reference-module'.
-- @include ../shared/module_info.sql

-- ============================================================================
-- 1. Cross-Reference Groups
-- ============================================================================

-- 1.1 Phrase Group
-- One group per phrase of the source passage. `phrase` is NULL for references that
-- the source lists without a phrase label. The targets belonging to a group are
-- `verse_link` rows with source_type='cross_reference_group' and source_id=group_id.
CREATE TABLE cross_reference_group (
    group_id        INTEGER PRIMARY KEY AUTOINCREMENT,  -- Group id. This is what verse_link.source_id
                                                    -- points at for every target of this group.
    verse_id_start  INTEGER NOT NULL,               -- Source passage (inclusive)
    verse_id_end    INTEGER NOT NULL,               -- inclusive; single verse is expressed as end = start
    phrase          TEXT,                           -- "For God so loved the world"
    sort_order      INTEGER NOT NULL DEFAULT 0,     -- Order of groups within the source verse
    metadata        TEXT                            -- JSON: anything not modelled above
);

CREATE INDEX idx_xref_group_start ON cross_reference_group(verse_id_start);
CREATE INDEX idx_xref_group_range ON cross_reference_group(verse_id_start, verse_id_end);

-- Uses the unified shared verse_link.sql.  In this case, the source type is a phrase group.
--
-- source_type = 'cross_reference_group', source_id = cross_reference_group.group_id,
-- link_type = 'cross_reference'.
-- @include ../shared/verse_link.sql

-- NOTE for writers: `verse_link` carries no foreign key to cross_reference_group
-- (it is generic across source types), so the ON DELETE CASCADE that v1
-- `cross_reference_entry` had is gone. Deleting a group must delete its links
-- explicitly:
--     DELETE FROM verse_link
--      WHERE source_type = 'cross_reference_group' AND source_id = ?;
--
-- NOTE for readers: the reverse lookup ("what points at verse V?") joins back to the
-- group for the source passage and phrase:
--     SELECT g.verse_id_start, g.phrase, l.context
--       FROM verse_link l
--       JOIN cross_reference_group g ON g.group_id = l.source_id
--      WHERE l.source_type = 'cross_reference_group'
--        AND l.verse_id_start <= V AND COALESCE(l.verse_id_end, l.verse_id_start) >= V;

-- ============================================================================
-- 2. Schema Version
-- ============================================================================

-- @include ../shared/schema_version.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');
