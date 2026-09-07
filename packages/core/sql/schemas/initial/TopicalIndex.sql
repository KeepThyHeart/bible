-- Topical Index Module Database Schema
-- Database: topical_[abbreviation].db
-- Purpose: Hierarchical topical index (Nave's, Torrey's, ...) mapping topics to passages
-- Version: 0.1.0
-- Generated: 2026-07-24
--
-- Range convention (normative): `verse_id_start` inclusive, `verse_id_end` inclusive,
-- a single verse is expressed as `verse_id_end = verse_id_start`, never as NULL.

-- ============================================================================
-- Pragmas and Initialization
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -16000;  -- 16MB cache

-- For this module type the writer sets module_type = 'topical_index' and
-- format = 'topical-index-module'.
-- @include ../shared/module_info.sql

-- ============================================================================
-- 1. Topics
-- ============================================================================

-- 1.1 Topic Hierarchy
-- Self-referential parent/child tree of arbitrary depth. Nave's ships three levels
-- (topic -> sub-topic -> section child); the schema does not cap the depth.
-- Breadcrumbs are produced by walking `parent_topic_id` upward with a recursive CTE.
CREATE TABLE topic (
    topic_id        INTEGER PRIMARY KEY AUTOINCREMENT,  -- Topic id. What verse_link.source_id points
                                                    -- at, what children reference as
                                                    -- parent_topic_id, and the FTS table's rowid.
    parent_topic_id INTEGER REFERENCES topic(topic_id),  -- NULL = root topic
    name            TEXT NOT NULL,                  -- "Aaron", "Lineage of", "MIRACLES OF"
    description     TEXT,                           -- SHORT annotation on the heading itself: a
                                                    -- parenthetical gloss, or the "See X. See Y."
                                                    -- redirect lists Nave's uses. Not the entry body --
                                                    -- that is `content`. Kept separate because a
                                                    -- redirect list is navigation, not prose, and
                                                    -- indexing it would pollute search.
    content         TEXT,                           -- The topic's own prose, where the work has any:
                                                    -- an explanatory note, a definition, an editorial
                                                    -- comment. Optional, and NULL for most topics --
                                                    -- a topical index is primarily a set of pointers
                                                    -- to verses, and a bare topic with no prose is
                                                    -- normal, not deficient. May be HTML or plain text.
                                                    --
                                                    -- Nave's already ships prose of this kind, e.g.
                                                    -- "Church" -> "(Hebrew: qahal, 'edah; Greek:
                                                    -- ekklesia). The people of God...". It currently
                                                    -- lands in `description` alongside the redirects,
                                                    -- because this column did not exist; importers
                                                    -- should route real prose here instead.
    content_file    TEXT,                           -- OR path to the body held outside the database,
                                                    -- for entries too large to inline. Same convention
                                                    -- as commentary_entry/book_section: the two are
                                                    -- alternatives, not both.
    word_count      INTEGER,                        -- Words in `content`, for reading-time estimates.
                                                    -- A snapshot at import; not maintained.
    sort_order      INTEGER,                        -- Source ordering within the parent
    metadata        TEXT                            -- JSON, e.g. {"seeAlso":["PRIESTHOOD"]}
);

CREATE INDEX idx_topic_parent ON topic(parent_topic_id);
CREATE INDEX idx_topic_name ON topic(name COLLATE NOCASE);

-- Unified content->verse linking. This table is byte-identical in every module
-- schema and in the user database. For a topical index every row has
-- source_type='topic' and source_id=topic.topic_id; a topic's passages are its own
-- rows, and a subtree's passages are the union over the topic's descendants.
--
-- Replaces the v1 `topic_verses` table:
--     topic_verses.topic_id         -> verse_link.source_id  (source_type='topic')
--     topic_verses.start_verse_id   -> verse_link.verse_id_start
--     topic_verses.end_verse_id     -> verse_link.verse_id_end  (NULL when single verse)
--     topic_verses.context          -> verse_link.context
--     topic_verses.sort_order       -> verse_link.sort_order
--
-- In a topical index: source_type = 'topic', source_id = topic.topic_id.
-- @include ../shared/verse_link.sql

-- NOTE for writers: v1 `topic_verses` deduplicated by its PRIMARY KEY
-- (topic_id, start_verse_id, end_verse_id). `verse_link` has a surrogate key and no
-- such constraint, so converters MUST deduplicate verse ranges per topic before
-- inserting.
--
-- NOTE for readers: "which topics cover verse V" is
--     WHERE verse_id_start <= V AND COALESCE(verse_id_end, verse_id_start) >= V
-- and a range's verse count is
--     COALESCE(verse_id_end, verse_id_start) - verse_id_start + 1

-- ============================================================================
-- 2. Full-Text Search
-- ============================================================================

-- 2.1 Topic FTS
-- FTS5 external-content table: it stores only the index, reading column values
-- back from the base table via `content=`/`content_rowid=`. The triggers below
-- keep the two in step.
--
-- Column ordering is load-bearing: column 0 = name, column 1 = content.
-- `highlight()` / `snippet()` callers index by position.
--
-- `description` is deliberately NOT indexed. It holds "See APOTHECARY. See
-- BRASS. See BREAD." redirect lists, which are navigation rather than prose: a
-- search for "bread" would otherwise match every topic that merely points at it.
CREATE VIRTUAL TABLE topic_fts USING fts5(
    name,                     -- Column 0. Topic heading.
    content,                  -- Column 1. The topic's prose body, where it has
                              -- one. Empty for most topics, which costs nothing --
                              -- an empty column contributes no terms.
    content='topic',
    content_rowid='topic_id',
    tokenize='porter unicode61'
);

-- Triggers
-- External-content FTS5 tables do not own their data, so rows must be removed with
-- the special 'delete' command carrying the OLD column values. A plain
-- DELETE/UPDATE against the FTS table leaves stale terms in the index.
CREATE TRIGGER topic_fts_insert AFTER INSERT ON topic BEGIN
    INSERT INTO topic_fts(rowid, name, content) VALUES (new.topic_id, new.name, new.content);
END;

CREATE TRIGGER topic_fts_delete AFTER DELETE ON topic BEGIN
    INSERT INTO topic_fts(topic_fts, rowid, name, content)
    VALUES('delete', old.topic_id, old.name, old.content);
END;

CREATE TRIGGER topic_fts_update AFTER UPDATE ON topic BEGIN
    INSERT INTO topic_fts(topic_fts, rowid, name, content)
    VALUES('delete', old.topic_id, old.name, old.content);
    INSERT INTO topic_fts(rowid, name, content) VALUES (new.topic_id, new.name, new.content);
END;

-- ============================================================================
-- 3. Schema Version
-- ============================================================================

-- @include ../shared/schema_version.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');
