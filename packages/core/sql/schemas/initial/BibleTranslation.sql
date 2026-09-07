-- Bible Translation Module Database Schema
-- Database: bible_[abbreviation].db
-- Purpose: Individual Bible translation content
-- Format: bible-module
-- Format version / Schema version: 0.1.0
-- Generated: 2025-10-10
--
-- ============================================================================
-- Pragmas and Initialization
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -32000;  -- 32MB cache


-- For this module type the writer sets module_type = 'bible' and
-- format = 'bible-module'.
-- @include ../shared/module_info.sql

-- ============================================================================
-- 1. Bible Verses
-- ============================================================================
--
-- TEXT + FORMATTING REPRESENTATION
-- ---------------------------------------
-- `text` is clean canonical UTF-8: no HTML, no inline markup delimiters, no
-- pilcrow (U+00B6), no leading or trailing whitespace. A consumer that only wants
-- readable text can ignore `formatting` entirely. FTS indexes `text` directly.
--
-- `formatting` is JSON describing structure as DATA (ranges of words), never as
-- markup:
--
--   {
--     "v": 1,
--     "block": {
--       "paragraph_start": true,
--       "lines": [                     // poetic lines; omitted for prose
--         {"start": 0, "end": 4, "level": 1},
--         {"start": 5, "end": 8, "level": 2}
--       ],
--       "heading": "A Psalm of David", // see "Headings" note below
--       "heading_kind": "psalm_title"  // optional: 'section' | 'psalm_title'
--     },
--     "spans": [
--       { "type": "divine_name",     "start": 1, "end": 1 },
--       { "type": "supplied",        "start": 2, "end": 2 },
--       { "type": "words_of_christ", "start": 0, "end": 24 },
--       { "type": "emphasis",        "start": 5, "end": 6 },
--       { "type": "quotation",       "start": 3, "end": 9,
--         "ref_start": 24031031, "ref_end": 24031034 },
--       { "type": "musical_direction", "start": 12, "end": 12 }
--     ]
--   }
--
-- Span vocabulary (plain-English names; USFM equivalent published for
-- interoperability -- borrowing the vocabulary, not the syntax):
--
--   | Span type (stored) | USFM | Meaning / rendering                            |
--   |--------------------|------|------------------------------------------------|
--   | divine_name        | \nd  | YHWH rendered LORD/GOD -> small caps           |
--   | supplied           | \add | translator-supplied words -> italic            |
--   | words_of_christ    | \wj  | red letter                                     |
--   | emphasis           | \em  | genuine emphasis present in the source         |
--   | quotation          | \qt  | OT quotation in NT; source passage in ref_*    |
--   | transliteration    | \tl  | italic                                         |
--   | musical_direction  | \qs  | Selah / Higgaion, set apart from the line      |
--
-- `quotation` carries the quoted passage as an inclusive verse_id range,
-- `ref_start` / `ref_end`, both present or both absent. Quotations are routinely
-- multi-verse -- Heb 8:8-12 quotes Jer 31:31-34 -- so a single id will not do. A
-- one-verse quotation sets `ref_end` equal to `ref_start`, never NULL (R-1).
--
-- `musical_direction` is a SPAN, not a block flag. USFM \qs is a character
-- marker wrapping the words themselves; the notation can sit mid-verse
-- ("Higgaion. Selah", Ps 9:16) as well as at the end, and more than one term
-- occupies the role. The words stay in `text` like any others -- the span only
-- says which words they are, so nothing has to guess at export time.
--
-- Block-level fields map to USFM as: paragraph_start -> \p,
-- lines[].level 1..3 -> \q1..\q3, heading -> \d / \s.
--
-- Poetry. `block.lines` is a LIST of word ranges, not one indent for the verse.
-- A verse is regularly more than one poetic line, and the indent regularly
-- changes between them -- Psalm 23:1 is
--
--   \q1 The LORD is my shepherd;
--   \q2 I shall not want.
--
-- so one level per verse could express neither the break nor the change. Lines
-- are ordered, do not overlap, and together cover every word of the verse; a
-- renderer walks them in order. A verse that is a single poetic line has one
-- entry. Prose omits the field entirely.
--
-- A span may straddle a line break. On export it is closed and re-opened across
-- it, because a USFM character marker cannot cross a paragraph marker; the
-- importer merges the halves back.
--
-- Headings. `block.heading` is the ONE field for heading text. It covers both USFM
-- \s (section heading, e.g. "The Beatitudes") and USFM \d (Psalm superscription /
-- descriptive title, e.g. "A Psalm of David"). Where the distinction matters for
-- rendering or for the toUSFM() exporter, qualify it with the optional
-- `block.heading_kind`:
--
--   | heading_kind  | USFM | Typical rendering                                   |
--   |---------------|------|-----------------------------------------------------|
--   | 'section'     | \s   | bold/large heading above the verse                  |
--   | 'psalm_title' | \d   | italic superscription, part of the psalm itself      |
--
-- `heading_kind` is omitted when unknown; consumers should default to 'section'.
-- Do NOT introduce a second heading field. The legacy v1 `formatting_data`
-- key `sectionHeading` normalizes to `block.heading` (+ heading_kind 'section').
--
-- `start` / `end` are WORD indices, 0-based and inclusive.
-- Extend the format by adding span type names -- never by adding presentational
-- attributes, and never by re-introducing inline markup or a third `text_usfm`
-- column. USFM is produced on export (see the toUSFM() exporter).
--
-- Worked example -- Psalm 23:1:
--   text:       The LORD is my shepherd; I shall not want.
--   formatting: {"v":1,"spans":[{"type":"divine_name","start":1,"end":1},
--                               {"type":"supplied","start":2,"end":2}]}

-- 1.1 Bible Verse Table
CREATE TABLE bible_verse (
    verse_id INTEGER PRIMARY KEY,                   -- Matches main.db bible_verse_ref.verse_id
    text TEXT NOT NULL,                             -- Clean canonical UTF-8 (see block above)
    formatting TEXT,                                -- JSON: block + spans (see block above)
    word_count INTEGER,                             -- Number of whitespace-delimited words in
                                                    -- `text`; span indices run 0..word_count-1
    metadata TEXT,                                  -- JSON: anything not modelled above

    CHECK (verse_id > 0)
);

-- No foreign key to main.db; verse_id values must match main.db bible_verse_ref
CREATE INDEX idx_verse_id ON bible_verse(verse_id);

-- 1.2 Interlinear Data (Original Language Texts Only)
--
-- WORD OFFSET CONVENTION
-- -----------------------------
-- Word offsets are 0-BASED and INCLUSIVE throughout this project: the first word of
-- a verse is index 0, and a range [start, end] includes both endpoints. A single
-- word is expressed as start == end. This matches `user_text_markup`, matches
-- JavaScript array indexing in the renderer, and matches the `formatting` span
-- indices above. Normative statement of the convention:
--
-- DISCONTIGUOUS ALIGNMENT
-- -----------------------------
-- One original-language word does not always map to one contiguous run of
-- translated words. Greek and Hebrew word order differs from English, and the
-- translation of a single word is routinely split by words belonging to another:
--
--   ou me      -> "not ... at all"        (two English words, split)
--   apekrithe  -> "answered ... saying"   (an intervening subject)
--
-- The alignment is therefore a LIST of word ranges:
--
--   * the FIRST range stays in real columns, `word_position_start` /
--     `word_position_end`. It is what `idx_interlinear_position` indexes and what
--     every query orders by, and the overwhelming majority of words need only it.
--   * any FURTHER ranges go in `extra_word_positions` as a short text list.
--
-- A child table was considered and rejected. Nothing ever selects or orders by a
-- secondary range from SQL: a reader loads every `interlinear_word` row for a
-- verse and resolves alignment in memory, so an index over the extra ranges would
-- have no query to serve. A table would buy indexability nobody uses at the cost
-- of a second query, a foreign key, an ordering column, and a flag column to say
-- whether the join is worth making. The text column needs none of those -- NULL
-- is the flag, and it is the usual value.

CREATE TABLE interlinear_word (
    interlinear_id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Row id; nothing references it
    verse_id INTEGER NOT NULL,                      -- The verse this word belongs to. -> bible_verse.
    word_position_start INTEGER NOT NULL,           -- 0-based inclusive word index (0, 1, 2...)
    word_position_end INTEGER NOT NULL,             -- 0-based inclusive; == start for one word
    original_word TEXT,                             -- Greek/Hebrew word, where the source has
                                                    -- one. NULL for a Strong's-tagged
                                                    -- translation: the tagging attaches a
                                                    -- number, lemma and gloss to the ENGLISH
                                                    -- words, with no original-language form to
                                                    -- record. 8 of 55 bible modules rely on
                                                    -- this (kjv, kjva, asv, abp, bsb, darby,
                                                    -- rlt, rwebster).
    transliteration TEXT,                           -- Latin-script rendering of `original_word`, for
                                                    -- readers who cannot read the script. Scheme is
                                                    -- the source's own; not normalised.
    strongs_number TEXT,                            -- "H1234" or "G5678"
    morphology TEXT,                                -- "V-AAI-3S"
    lemma TEXT,                                     -- Dictionary/lexical form
    gloss TEXT,                                     -- Brief description of word in module's language,
                                                    -- provided by module.  Not the same as 
                                                    -- translation term, nor as lexicon term.
    extra_word_positions TEXT,                      -- Word ranges beyond the first.  Useful
                                                    -- when the translation is to incontiguous 
                                                    -- destination words.  Comma-seaprated, each entry
                                                    -- either single word index or range:
                                                    -- "12-14,18".  0-based, as with other fields.
    metadata TEXT,                                  -- JSON, for future expansion of data model

    FOREIGN KEY (verse_id) REFERENCES bible_verse(verse_id) ON DELETE CASCADE,
    CHECK (word_position_start >= 0),
    CHECK (word_position_end >= word_position_start)
);

CREATE INDEX idx_interlinear_verse ON interlinear_word(verse_id);
CREATE INDEX idx_interlinear_strongs ON interlinear_word(strongs_number);
CREATE INDEX idx_interlinear_morphology ON interlinear_word(morphology);
CREATE INDEX idx_interlinear_position ON interlinear_word(verse_id, word_position_start);

-- This data format is the same for all modules.  Usually for plain translations it will
-- be empty, unless there are translator-supplied cross-references.  Ranges are inclusive
-- (so start and end verse IDs are included).
--
-- `source_type` and `link_type` are validated in TypeScript (see enum policy).
--
-- In a bible module the owner is the verse carrying the translator-supplied
-- reference: source_type = 'bible_verse', source_id = bible_verse.verse_id.
-- Usually empty -- a plain translation supplies no references.
-- @include ../shared/verse_link.sql

-- ============================================================================
-- 2. Full-Text Search
-- ============================================================================
--
-- `bible_verse_fts` is an external content table (content='bible_verse'): the FTS
-- index stores only the inverted index, and the column values live in
-- `bible_verse`. For such tables a plain `UPDATE`/`DELETE` against the FTS table is
-- not supported and silently leaves stale terms in the index.  Rows must instead be
-- removed with the special 'delete' command, supplying the old column values so
-- FTS5 can locate and remove the corresponding index entries:
--
--   INSERT INTO x_fts(x_fts, rowid, <cols...>) VALUES('delete', old.id, <old vals...>);
--
-- Reference implementation: scripts/convert-topical-index.js.
--
-- Column ordering is load-bearing: column 0 = verse_id (UNINDEXED),
-- column 1 = text. `highlight()` / `snippet()` callers index by position.

-- 2.1 Bible Verses FTS (indexes the clean `text` directly)
-- FTS5 external-content table: it stores only the index, reading column values
-- back from the base table via `content=`/`content_rowid=`. The triggers below
-- keep the two in step.
CREATE VIRTUAL TABLE bible_verse_fts USING fts5(
    verse_id UNINDEXED,       -- Column 0. Carried for retrieval only, never matched
                              -- against. Position is load-bearing -- see above.
    text,                     -- Column 1. The clean verse text; the only indexed
                              -- column, and what highlight()/snippet() operate on.
    content='bible_verse',
    content_rowid='verse_id',
    tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync (external-content pattern)
CREATE TRIGGER bible_verse_fts_insert AFTER INSERT ON bible_verse BEGIN
    INSERT INTO bible_verse_fts(rowid, verse_id, text)
    VALUES (new.verse_id, new.verse_id, new.text);
END;

CREATE TRIGGER bible_verse_fts_delete AFTER DELETE ON bible_verse BEGIN
    INSERT INTO bible_verse_fts(bible_verse_fts, rowid, verse_id, text)
    VALUES('delete', old.verse_id, old.verse_id, old.text);
END;

CREATE TRIGGER bible_verse_fts_update AFTER UPDATE ON bible_verse BEGIN
    INSERT INTO bible_verse_fts(bible_verse_fts, rowid, verse_id, text)
    VALUES('delete', old.verse_id, old.verse_id, old.text);
    INSERT INTO bible_verse_fts(rowid, verse_id, text)
    VALUES (new.verse_id, new.verse_id, new.text);
END;

-- @include ../shared/module_feature.sql

-- ============================================================================
-- 3. Schema Version
-- ============================================================================

-- @include ../shared/schema_version.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');
