-- Dictionary Module Database Schema
-- Database: dictionary_[abbreviation].db
-- Version: 0.1.0
-- Generated: 2025-10-10
-- Purpose: One module type covering three related but genuinely different kinds
--          of reference work. Which one you are holding is declared by
--          `module_info.dictionary_type` -- branch on that, never on probing
--          columns for NULL.
--
--   1. Original-language lexicon (strongs, greek_lexicon, hebrew_lexicon).
--      Keyed by a Strong's number or lexical id ("G25"); `word`,
--      `transliteration`, `pronunciation`, `part_of_speech` and `etymology`
--      carry the Greek or Hebrew headword and its apparatus. This is the shape
--      the column list below was designed around.
--
--   2. Bible dictionary or encyclopaedia (bible_dictionary, topical). Keyed by
--      an English topic ("Passover"); the entry is prose about the subject, and
--      the original-language columns are meaningless.
--
--   3. General-language dictionary, such as Webster's 1828 English dictionary. The entry 
--      defines the ENGLISH word, and may not mention Scripture at all. Webster's as
--      currently shipped populates exactly three content columns --
--      `entry_key`, `word` (which merely repeats the key) and `definition` --
--      and every other one is NULL across all 62,387 entries. It has no
--      `word_occurrence` table and no `verse_link` rows.
--
-- Case 3 is why nearly every column below is nullable, and why a reader must
-- never assume `word` is an original-language word, that a transliteration or
-- part of speech exists, or that an entry links to any verse whatsoever. Note
-- also that `dictionary_type` has no value meaning "plain English dictionary":
-- Webster's is filed as `bible_dictionary`, the nearest available fit.
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

-- For this module type the writer sets module_type = 'dictionary' and
-- format = 'dictionary-module'.
-- @include ../shared/module_info.sql

-- Dictionary specifics. Added by ALTER because the included block is shared with
-- every other module type and must stay one definition. `dictionary_type` is an
-- open set -- no CHECK, validated in TypeScript. SQLite requires a non-NULL
-- default when adding a NOT NULL column; the table is empty at creation, so the
-- default exists only to satisfy that rule.
--
-- dictionary_type -- which of the three shapes at the top of this file the module
-- is. Source of truth: DICTIONARY_TYPES in packages/core/src/Data/Core/Types.ts;
-- keep this list in step with it.
--
--   'strongs'          Strong's Concordance numbering. Keyed 'G25'/'H430'. The
--                      only type that would carry `word_occurrence` data.
--   'greek_lexicon'    Greek lexicon (Thayer, LSJ). language_from = 'grc'.
--   'hebrew_lexicon'   Hebrew lexicon (BDB, Gesenius). language_from = 'hbo'.
--   'bible_dictionary' Bible dictionary or encyclopaedia (ISBE, Easton's),
--                      keyed by English topic. ALSO the current catch-all for a
--                      general-language dictionary such as Webster's 1828 --
--                      there is no 'english_dictionary' value, so shape 3 above
--                      is filed here.
--   'topical'          Topical/thematic dictionary, keyed by subject.
--
-- The DEFAULT is a SQLite requirement, not a recommendation: adding a NOT NULL
-- column needs one. The writer is expected to state the value explicitly.
ALTER TABLE module_info ADD COLUMN dictionary_type TEXT NOT NULL DEFAULT 'bible_dictionary';

-- language_from -- the language being DEFINED (the headword's language), using
-- the same coding as module_info.language_code: ISO 639-1 where a two-letter code
-- exists, ISO 639-3 where none does. So 'grc' (Ancient Greek), 'hbo' (Biblical
-- Hebrew), 'arc' (Aramaic) for lexicons; 'en' for Webster's, which defines
-- English words. NULL when the notion does not apply -- a Bible dictionary
-- defines topics, not words in a language.
ALTER TABLE module_info ADD COLUMN language_from TEXT;

-- language_to -- the language the definitions are WRITTEN IN. Same coding.
-- Defaults to 'en'. For a monolingual dictionary such as Webster's this equals
-- language_from; for a lexicon the pair is the point ('grc' -> 'en').
ALTER TABLE module_info ADD COLUMN language_to TEXT DEFAULT 'en';

-- ============================================================================
-- 2. Dictionary Entries
-- ============================================================================

CREATE TABLE dictionary_entry (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,     -- Surrogate key. It is what `verse_link.source_id`
                                                    -- points at and what the FTS table below uses as
                                                    -- its rowid.
    entry_key TEXT NOT NULL UNIQUE,                 -- The lookup key, in whatever vocabulary this module
                                                    -- is keyed by: a Strong's number ("G25", "H430"), a
                                                    -- topic ("Passover"), or an English headword
                                                    -- ("LOVE"). Case and spacing are the source work's
                                                    -- own -- Webster's ships uppercase -- so match
                                                    -- case-insensitively when resolving user input.
    word TEXT,                                      -- The headword as displayed. Case 1: the Greek or
                                                    -- Hebrew word itself (agapao). Cases 2 and 3: the
                                                    -- English headword, routinely identical to
                                                    -- `entry_key`. Do not present this as
                                                    -- original-language text without checking
                                                    -- `dictionary_type` first.
    transliteration TEXT,                           -- Case 1 only. Nothing to transliterate in an
                                                    -- English dictionary; NULL throughout Webster's.
    pronunciation TEXT,                             -- Respelling or IPA. Case 1 in practice: the shipped
                                                    -- English dictionaries carry none, even though a
                                                    -- general dictionary is exactly the kind of work
                                                    -- that would have it.
    part_of_speech TEXT,                            -- Free text, and the vocabulary is the source work's
                                                    -- own: a lexicon writes a parsing code ("N-GSM"),
                                                    -- Webster's writes "verb transitive" inside the
                                                    -- definition prose and leaves this NULL. Not
                                                    -- reliably filterable across modules.
    definition TEXT NOT NULL,                       -- The entry body, and the ONLY content column every
                                                    -- kind of module populates. May be HTML or plain
                                                    -- text depending on the source; strip tags before
                                                    -- measuring or excerpting.
    etymology TEXT,                                 -- Word origin. Present in scholarly works; NULL
                                                    -- throughout the shipped Webster's and Breton
                                                    -- modules even though Webster's does discuss
                                                    -- etymology -- inside `definition`, unseparated.
    usage_notes TEXT,                               -- Commentary on how the word is used. Same story:
                                                    -- treat as a bonus, never as a given.
    semantic_range TEXT,                            -- The spread of senses a lexicon assigns to an
                                                    -- original-language word. Case 1 only; has no
                                                    -- meaning for cases 2 and 3.
    related_words TEXT,                             -- JSON array of `entry_key`s WITHIN THIS SAME MODULE
                                                    -- ("see also", cross-references). Never verse
                                                    -- references -- those are `verse_link` rows -- and
                                                    -- never keys into another dictionary.
    content_file TEXT,                              -- Path to the full entry held outside the database,
                                                    -- for works too large to inline. Optional and
                                                    -- currently unused: no shipped module sets it, and
                                                    -- the base path it resolves against is not yet
                                                    -- defined.
    metadata TEXT                                   -- JSON: anything not modelled above

    -- the JSON `example_verses` column is removed. Example/illustrative verses
    -- are now rows in `verse_link` with source_type='dictionary_entry' and
    -- source_id=entry_id, which makes them queryable and range-aware.
);

CREATE INDEX idx_entry_key ON dictionary_entry(entry_key);
CREATE INDEX idx_entry_word ON dictionary_entry(word);

-- ============================================================================
-- 3. Word Occurrences -- SHIPPED concordance content, not a derived index
-- ============================================================================
--
-- OPTIONAL, and absent from most dictionary modules. It exists for one thing:
-- an EXHAUSTIVE CONCORDANCE, where the publisher authored the complete list of
-- verses in one named translation in which a given entry's word stands behind
-- the English. That list is a property of the printed work -- Strong's is a
-- concordance *of the KJV* -- which is why every row names its translation.
--
-- It is deliberately NOT a cache of the user's installed Bibles. Derived
-- occurrence data has two better homes, and both are used in preference:
--
--   * Per-translation Strong's alignment lives in the Bible module. When a
--     translation ships an interlinear, every occurrence is already queryable
--     from that module's own `interlinear_word.strongs_number` (indexed), in
--     the database that actually owns the text. Prefer that path. It covers
--     exactly the translations the user has, it stays correct when the
--     translation is revised, and it disappears when the module is uninstalled.
--     For such a translation this table is pure duplication.
--
--   * Derived search structures live in main.db. `bible_search_index` and
--     friends are built per module per book and rebuilt as modules come and go
--     (MainDatabase.sql section 3). A module database cannot play that role: it
--     is read-only content, replaced wholesale on update, so nothing here can
--     be pruned in response to what the user installs.
--
-- Consequences for readers:
--
--   * `bible_module_uuid` is a SOFT cross-database reference. SQLite cannot
--     enforce a foreign key across files, so rows may name a translation the
--     user does not own and never will. Filter by the uuids of installed Bible
--     modules and treat the remainder as inert.
--
--   * The table may not exist at all. Querying it on a module that lacks it
--     raises `no such table: word_occurrence`; guard before you read.
--
-- Current state: nothing in the project populates it. The SWORD dictionary
-- importer creates the table but writes no rows; dictionary_strongsgreek and
-- dictionary_strongshebrew ship with it empty, and Webster's and the Breton
-- module omit it entirely. It is a reserved shape for concordance content that
-- cannot be recomputed -- keyed by a translation with no interlinear alignment
-- to derive it from -- not a structure any current code path depends on.
--
-- Not to be confused with `verse_link` (section below), which records the few
-- verses an entry CITES AS EXAMPLES. Examples are editorial selection;
-- occurrences are exhaustive enumeration. Different questions, not
-- interchangeable.

CREATE TABLE word_occurrence (
    occurrence_id INTEGER PRIMARY KEY AUTOINCREMENT,-- Row id; nothing references it
    entry_key TEXT NOT NULL,                        -- -> dictionary_entry.entry_key ("G25", "H430").
                                                    -- Joins on the natural key, not entry_id, so an
                                                    -- importer can write occurrences without having
                                                    -- resolved entry ids first.
    verse_id INTEGER NOT NULL,                      -- The verse containing the occurrence, in the
                                                    -- standard book*1000000 + chapter*1000 + verse
                                                    -- encoding. A single verse, not a range: an
                                                    -- occurrence is a point, so no verse_id_end.
    bible_module_uuid TEXT,                         -- Which translation this occurrence was counted in,
                                                    -- by module_info.module_uuid. Unenforceable across
                                                    -- databases -- see the note above. (Was
                                                    -- `bible_module`, holding a bare abbreviation:
                                                    -- ambiguous, since two unrelated modules may both
                                                    -- call themselves "KJV".) NULL means the source did
                                                    -- not say, which makes the row unattributable and
                                                    -- of little use.
    translation_word TEXT,                          -- How that translation rendered the word HERE, in
                                                    -- this verse ("loved", "charity"). Occurrence-
                                                    -- specific, unlike the context-free gloss in
                                                    -- interlinear_word.gloss or the definition in
                                                    -- dictionary_entry.
    metadata TEXT,                                  -- JSON: anything not modelled above

    FOREIGN KEY (entry_key) REFERENCES dictionary_entry(entry_key) ON DELETE CASCADE
);

CREATE INDEX idx_occurrence_entry ON word_occurrence(entry_key);
CREATE INDEX idx_occurrence_verse ON word_occurrence(verse_id);

-- Unified content->verse linking. This table is byte-identical in every module
-- schema and in the user database. It replaces the JSON `example_verses` column
-- that used to live on `dictionary_entry`.
--
-- In a dictionary module: source_type = 'dictionary_entry',
-- source_id = dictionary_entry.entry_id.
-- @include ../shared/verse_link.sql

-- ============================================================================
-- 4. Full-Text Search
-- ============================================================================

-- FTS5 external-content table: it stores only the index, reading column values
-- back from the base table via `content=`/`content_rowid=`. The triggers below
-- keep the two in step.
--
-- `entry_key` is UNINDEXED because exact-key lookup is served by the UNIQUE
-- index on the base table; FTS here is for prose search, not key resolution.
CREATE VIRTUAL TABLE dictionary_entry_fts USING fts5(
    entry_id UNINDEXED,       -- Carried for retrieval only, never matched against
    entry_key UNINDEXED,      -- Likewise -- see the note above
    word,                     -- Headword
    definition,               -- Entry body; the column that carries most matches
    usage_notes,              -- Usually empty outside lexicons, and harmless when
                              -- it is -- an empty column contributes no terms
    content='dictionary_entry',
    content_rowid='entry_id',
    tokenize='porter unicode61'
);

-- Triggers
-- External-content FTS5 tables do not own their data, so rows must be removed with
-- the special 'delete' command carrying the OLD column values. A plain
-- DELETE/UPDATE against the FTS table leaves stale terms in the index.
CREATE TRIGGER dictionary_entry_fts_insert AFTER INSERT ON dictionary_entry BEGIN
    INSERT INTO dictionary_entry_fts(rowid, entry_id, entry_key, word, definition, usage_notes)
    VALUES (new.entry_id, new.entry_id, new.entry_key, new.word, new.definition, new.usage_notes);
END;

CREATE TRIGGER dictionary_entry_fts_delete AFTER DELETE ON dictionary_entry BEGIN
    INSERT INTO dictionary_entry_fts(dictionary_entry_fts, rowid, entry_id, entry_key, word, definition, usage_notes)
    VALUES ('delete', old.entry_id, old.entry_id, old.entry_key, old.word, old.definition, old.usage_notes);
END;

CREATE TRIGGER dictionary_entry_fts_update AFTER UPDATE ON dictionary_entry BEGIN
    INSERT INTO dictionary_entry_fts(dictionary_entry_fts, rowid, entry_id, entry_key, word, definition, usage_notes)
    VALUES ('delete', old.entry_id, old.entry_id, old.entry_key, old.word, old.definition, old.usage_notes);
    INSERT INTO dictionary_entry_fts(rowid, entry_id, entry_key, word, definition, usage_notes)
    VALUES (new.entry_id, new.entry_id, new.entry_key, new.word, new.definition, new.usage_notes);
END;

-- ============================================================================
-- 5. Schema Version
-- ============================================================================

-- @include ../shared/schema_version.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');
