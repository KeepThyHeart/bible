-- Book Module Database Schema
-- Database: book_[abbreviation].db
-- Purpose: General study books (theology, history, systematic works)
-- Version: 0.1.0
-- Generated: 2025-10-10
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
PRAGMA cache_size = -32000;  -- 32MB cache

-- For this module type the writer sets module_type = 'book' and
-- format = 'book-module'.
-- @include ../shared/module_info.sql

-- ============================================================================
-- 1. Book Structure
-- ============================================================================

-- 1.1 Table of Contents / Sections
CREATE TABLE book_section (
    section_id INTEGER PRIMARY KEY AUTOINCREMENT,   -- Section id. What verse_link.source_id points at,
                                                    -- and the FTS table's rowid.
    parent_section_id INTEGER,                      -- For hierarchical TOC
    section_number TEXT,                            -- DISPLAY label: "1.2.3" or "Chapter 5"
    sort_order INTEGER NOT NULL DEFAULT 0,          -- authoritative ordering among siblings.
                                                    -- section_number is TEXT and sorts "1.10"
                                                    -- before "1.2", so it cannot be used for order.
    title TEXT NOT NULL,                            -- Section heading, as displayed in the table of
                                                    -- contents. Required: a section with no heading
                                                    -- cannot be navigated to.
    content TEXT,                                   -- Text content
    content_file TEXT,                              -- OR path to external file
    word_count INTEGER,                             -- Words in `content`, for reading-time estimates.
                                                    -- A snapshot at import; not maintained.
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (parent_section_id) REFERENCES book_section(section_id) ON DELETE CASCADE
);

CREATE INDEX idx_section_parent ON book_section(parent_section_id);
CREATE INDEX idx_section_number ON book_section(section_number);
CREATE INDEX idx_section_sort ON book_section(parent_section_id, sort_order);

-- Unified content->verse linking. This table is byte-identical in every module
-- schema and in the user database. It replaces the former `scripture_reference`
-- table: section_id becomes (source_type='book_section', source_id), and the old
-- `context` column carries over unchanged.
--
-- In a book module: source_type = 'book_section',
-- source_id = book_section.section_id.
-- @include ../shared/verse_link.sql

-- ============================================================================
-- 2. Full-Text Search
-- ============================================================================

-- FTS5 external-content table: it stores only the index, reading column values
-- back from the base table via `content=`/`content_rowid=`. The triggers below
-- keep the two in step.
CREATE VIRTUAL TABLE book_section_fts USING fts5(
    section_id UNINDEXED,     -- Carried for retrieval only, never matched against
    title,                    -- Section heading -- indexed, so a heading-only
                              -- match still finds the section
    content,                  -- Section body text
    content='book_section',
    content_rowid='section_id',
    tokenize='porter unicode61'
);

-- Triggers
-- External-content FTS5 tables do not own their data, so rows must be removed with
-- the special 'delete' command carrying the OLD column values. A plain
-- DELETE/UPDATE against the FTS table leaves stale terms in the index.
CREATE TRIGGER book_section_fts_insert AFTER INSERT ON book_section BEGIN
    INSERT INTO book_section_fts(rowid, section_id, title, content)
    VALUES (new.section_id, new.section_id, new.title, new.content);
END;

CREATE TRIGGER book_section_fts_delete AFTER DELETE ON book_section BEGIN
    INSERT INTO book_section_fts(book_section_fts, rowid, section_id, title, content)
    VALUES ('delete', old.section_id, old.section_id, old.title, old.content);
END;

CREATE TRIGGER book_section_fts_update AFTER UPDATE ON book_section BEGIN
    INSERT INTO book_section_fts(book_section_fts, rowid, section_id, title, content)
    VALUES ('delete', old.section_id, old.section_id, old.title, old.content);
    INSERT INTO book_section_fts(rowid, section_id, title, content)
    VALUES (new.section_id, new.section_id, new.title, new.content);
END;

-- ============================================================================
-- 3. Schema Version
-- ============================================================================

-- @include ../shared/schema_version.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');
