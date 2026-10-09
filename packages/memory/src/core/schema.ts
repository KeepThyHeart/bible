/**
 * Scripture memory's tables in the host user database.
 *
 * The extension kept these in its own SQLite file (schema v1-v7, see
 * `legacyImport.ts`). As a built-in module they live in the user database next
 * to notes and highlights, so they are encrypted with it, backed up with it
 * (`Backup.USER_TABLES` classifies every one) and restored with it.
 *
 * The shape is the extension's v7 schema with every table prefixed `memory_`
 * (the user database already has `collection` and `setting`). The extension's
 * `meta` table is gone: the host's `USER_SCHEMA_VERSION` versions these shapes
 * now, and a later change follows the host's rules (`IF NOT EXISTS` DDL here,
 * a repair or an upgrader in the backup registry, a version bump).
 *
 * `card.state` is still created and written (a display-only label; see the
 * extension's v2 migration note) so imported and new rows look alike.
 *
 * Everything is `IF NOT EXISTS`, so this is safe to run on every open. It is
 * run by the desktop's `initializeUserSchema`, unconditionally: a backup that
 * holds memory rows must restore even if the memory feature has never been
 * opened on this machine.
 */

import type { ISql } from '@bible/core';

/** Every memory table, parents before children. */
export const MEMORY_TABLES = [
  'memory_collection',
  'memory_passage',
  'memory_card',
  'memory_attempt',
  'memory_setting',
  'memory_resume_state',
  'memory_recite_detail',
  'memory_push_card',
] as const;

export type MemoryTable = (typeof MEMORY_TABLES)[number];

/** Machine-local bookkeeping of the one-time import (excluded from backups). */
export const MEMORY_IMPORT_TABLE = 'memory_import';

export const MEMORY_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS memory_collection (
     id         INTEGER PRIMARY KEY,
     name       TEXT    NOT NULL,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS memory_passage (
     id             INTEGER PRIMARY KEY,
     collection_id  INTEGER NOT NULL REFERENCES memory_collection(id) ON DELETE CASCADE,
     module_id      TEXT    NOT NULL,
     start_verse_id INTEGER NOT NULL,
     end_verse_id   INTEGER NOT NULL,
     reference      TEXT    NOT NULL,
     verse_count    INTEGER NOT NULL,
     added_at       INTEGER NOT NULL,
     answer_mode    TEXT,
     deleted_at     INTEGER,
     recite_on      INTEGER NOT NULL DEFAULT 0
   )`,
  // The same range in two translations is two different tasks, so the module is part of the key.
  `CREATE UNIQUE INDEX IF NOT EXISTS memory_passage_range_unique
     ON memory_passage (collection_id, module_id, start_verse_id, end_verse_id)`,
  `CREATE INDEX IF NOT EXISTS memory_passage_deleted_at ON memory_passage (deleted_at)`,

  `CREATE TABLE IF NOT EXISTS memory_card (
     id                INTEGER PRIMARY KEY,
     passage_id        INTEGER NOT NULL REFERENCES memory_passage(id) ON DELETE CASCADE,
     rung              TEXT    NOT NULL,
     state             TEXT    NOT NULL,
     interval_step     INTEGER NOT NULL DEFAULT -1,
     due_at            INTEGER,
     streak            INTEGER NOT NULL DEFAULT 0,
     last_score        REAL,
     progress_reset_at INTEGER
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS memory_card_passage_rung_unique ON memory_card (passage_id, rung)`,
  `CREATE INDEX IF NOT EXISTS memory_card_due_at ON memory_card (due_at)`,

  // Never pruned (the extension's rule): history is kept so later statistics have real data.
  `CREATE TABLE IF NOT EXISTS memory_attempt (
     id            INTEGER PRIMARY KEY,
     card_id       INTEGER NOT NULL REFERENCES memory_card(id) ON DELETE CASCADE,
     at            INTEGER NOT NULL,
     score         REAL    NOT NULL,
     correct_first INTEGER NOT NULL,
     total_steps   INTEGER NOT NULL,
     replay        INTEGER NOT NULL DEFAULT 0,
     duration_ms   INTEGER,
     tier          INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS memory_attempt_card_at ON memory_attempt (card_id, at)`,
  `CREATE INDEX IF NOT EXISTS memory_attempt_at ON memory_attempt (at)`,
  `CREATE INDEX IF NOT EXISTS memory_attempt_card_tier ON memory_attempt (card_id, tier)`,

  `CREATE TABLE IF NOT EXISTS memory_setting (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS memory_resume_state (
     card_id       INTEGER PRIMARY KEY REFERENCES memory_card(id) ON DELETE CASCADE,
     cursor        INTEGER NOT NULL,
     correct_first INTEGER NOT NULL,
     graded_units  INTEGER NOT NULL,
     updated_at    INTEGER NOT NULL,
     tier          INTEGER NOT NULL DEFAULT 0
   )`,

  // Verdict letters, credits and counts only - never heard text. Kept to the last 20 per card.
  `CREATE TABLE IF NOT EXISTS memory_recite_detail (
     attempt_id   INTEGER PRIMARY KEY REFERENCES memory_attempt(id) ON DELETE CASCADE,
     card_id      INTEGER NOT NULL REFERENCES memory_card(id) ON DELETE CASCADE,
     at           INTEGER NOT NULL,
     verdicts     TEXT    NOT NULL,
     credits      TEXT    NOT NULL,
     verse_scores TEXT    NOT NULL,
     extras       INTEGER NOT NULL,
     strictness   TEXT    NOT NULL,
     engine_id    TEXT,
     model_id     TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS memory_recite_detail_card_at ON memory_recite_detail (card_id, at)`,

  `CREATE TABLE IF NOT EXISTS memory_push_card (
     key        TEXT PRIMARY KEY,
     passage_id INTEGER NOT NULL REFERENCES memory_passage(id) ON DELETE CASCADE,
     fire_at    INTEGER NOT NULL,
     origin     TEXT    NOT NULL,
     state      TEXT    NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS memory_push_card_state_fire ON memory_push_card (state, fire_at)`,

  // One row per import source. Written in the same transaction as the imported
  // rows, so an import is either recorded and complete, or neither.
  `CREATE TABLE IF NOT EXISTS memory_import (
     source         TEXT    PRIMARY KEY,
     status         TEXT    NOT NULL,
     source_version INTEGER,
     recorded_at    INTEGER NOT NULL,
     counts         TEXT,
     detail         TEXT
   )`,
];

/** Create the memory tables if missing. Idempotent; safe on every open. */
export function installMemorySchema(db: ISql): void {
  for (const statement of MEMORY_DDL) db.execute(statement);
}
