-- Quiz Module Database Schema
-- Database: quiz_[abbreviation].db
-- Purpose: Questions about the text of scripture, each anchored to the verses it asks
--          about, for the Quiz feature (a quiz from today's reading, a chapter or a
--          chosen passage). See packages/core/docs/features/quiz.md.
-- Version: 0.1.0
--
-- One row per question. The question's passages are its verse_link rows
-- (source_type = 'quiz_question', source_id = question_id); link_type
-- 'primary_passage' marks the verse(s) the question is chiefly about. A question may
-- be anchored to several ranges.
--
-- Extensibility (normative): `kind` and `answer_mode` are open sets with no CHECK.
-- A reader that does not know an answer_mode shows the prompt, reveals `answer` (when
-- there is one) and lets the user grade themselves; without an answer it treats the
-- question as an ungraded reflection. Anything a future question type needs beyond
-- the columns below goes in `metadata` (JSON object), never in a new column that old
-- readers would ignore silently.
--
-- Range convention (normative): `verse_id_start` inclusive, `verse_id_end` inclusive,
-- a single verse is expressed as `verse_id_end = verse_id_start`, never as NULL.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -8000;  -- 8MB cache

-- For this module type the writer sets module_type = 'quiz' and format = 'quiz-module'.
-- module_info.metadata (JSON) may carry {"textBasis": "KJV"}: the translation whose
-- wording the questions and answers follow.
-- @include ../shared/module_info.sql
-- @include ../shared/compression_dictionary.sql

-- Licence and attribution per source dataset (e.g. 'uw-tq' for unfoldingWord
-- Translation Questions, CC BY-SA 4.0). Readers show the attribution of the sources
-- whose questions they display.
-- @include ../shared/data_source.sql

-- ============================================================================
-- 1. Questions
-- ============================================================================
CREATE TABLE quiz_question (
    question_id   INTEGER PRIMARY KEY,              -- verse_link.source_id. NOT an identity
                                                    -- across releases; use question_key.
    question_key  TEXT NOT NULL UNIQUE,             -- Stable across releases; the user's progress
                                                    -- is keyed by it, e.g. 'tq:MRK:a4zc',
                                                    -- 'kth:MRK:1:03'. Never reuse a retired key
                                                    -- for a different question.
    kind          TEXT NOT NULL,                    -- What the question exercises. Open set, no CHECK:
                                                    --   'recall'         a fact the text states
                                                    --   'comprehension'  why / how / what it means
                                                    --                    in context
                                                    --   'application'    personal reflection
    answer_mode   TEXT NOT NULL,                    -- How it is answered. Open set, no CHECK:
                                                    --   'multiple_choice'  pick one of `choices`
                                                    --   'short_answer'     type a word or name,
                                                    --                      checked against `accepted`
                                                    --   'free_response'    reveal `answer`, grade
                                                    --                      yourself
                                                    --   'reflection'       ungraded
    difficulty    INTEGER,                          -- 1 easy, 2 medium, 3 hard; NULL = unrated
                                                    -- (readers treat it as 2 when mixing levels)
    prompt        TEXT NOT NULL,                    -- The question as shown
    answer        TEXT,                             -- Correct choice text (multiple_choice), the
                                                    -- expected answer (short_answer) or the model
                                                    -- answer (free_response). NULL for reflection.
    choices       TEXT,                             -- JSON [{"text": "...", "correct": true}, ...]
                                                    -- multiple_choice only; readers shuffle them
    accepted      TEXT,                             -- JSON ["Simon", "Simon Peter"]: answers that
                                                    -- count as correct (short_answer)
    explanation   TEXT,                             -- Shown after answering; cites the verse
    tags          TEXT,                             -- JSON array of lowercase topic tags
    source_id     TEXT REFERENCES data_source(id),  -- Where the question came from (attribution)
    review_status TEXT,                             -- Open set: 'unreviewed' | 'approved' | 'edited'
    reviewed_by   TEXT,                             -- Reviewer's name; NULL = not reviewed
    sort_order    INTEGER NOT NULL DEFAULT 0,       -- Order within a passage (the text's order)
    metadata      TEXT                              -- JSON object: anything a question type needs
                                                    -- that has no column (e.g. a generator id, a
                                                    -- verse template, the translation a dynamic
                                                    -- question was built from)
);
CREATE INDEX idx_quiz_question_kind ON quiz_question(kind, answer_mode, difficulty);

-- ============================================================================
-- 2. Passages
-- ============================================================================
-- @include ../shared/verse_link.sql

-- NOTE for writers: verse_link has no foreign key to quiz_question. Deleting a question
-- must delete its links explicitly:
--     DELETE FROM verse_link WHERE source_type = 'quiz_question' AND source_id = ?;

-- @include ../shared/module_feature.sql

-- ============================================================================
-- 3. Schema Version
-- ============================================================================

-- @include ../shared/schema_version.sql

INSERT INTO schema_version (version_number, notes)
VALUES ('0.1.0', 'Initial release.');
