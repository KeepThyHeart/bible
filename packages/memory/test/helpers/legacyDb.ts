/**
 * Builds databases exactly as the Scripture Memory extension left them, at any
 * of its schema versions (v1-v7), for the import tests.
 *
 * `LEGACY_MIGRATIONS` is a verbatim copy of the extension's `db.ts` migration
 * list at schema v7 (bible-memory, reconciled 0.2 line). It is a fixture: it
 * must never change, because it describes files already on users' disks.
 */

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';

export const LEGACY_MIGRATIONS: readonly string[][] = [
  // --- v1: the initial schema (locks, replay, four-state cards) -------------
  [
    `CREATE TABLE IF NOT EXISTS collection (
       id         INTEGER PRIMARY KEY,
       name       TEXT    NOT NULL,
       created_at INTEGER NOT NULL
     )`,

    `CREATE TABLE IF NOT EXISTS passage (
       id             INTEGER PRIMARY KEY,
       collection_id  INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
       module_id      TEXT    NOT NULL,
       start_verse_id INTEGER NOT NULL,
       end_verse_id   INTEGER NOT NULL,
       reference      TEXT    NOT NULL,
       verse_count    INTEGER NOT NULL,
       added_at       INTEGER NOT NULL
     )`,

    // The same range in two translations is two different memorisation tasks -
    // the words differ - so the uniqueness key includes the module.
    `CREATE UNIQUE INDEX IF NOT EXISTS passage_range_unique
       ON passage (collection_id, module_id, start_verse_id, end_verse_id)`,

    `CREATE TABLE IF NOT EXISTS card (
       id            INTEGER PRIMARY KEY,
       passage_id    INTEGER NOT NULL REFERENCES passage(id) ON DELETE CASCADE,
       rung          TEXT    NOT NULL,
       state         TEXT    NOT NULL,
       interval_step INTEGER NOT NULL DEFAULT -1,
       due_at        INTEGER,
       streak        INTEGER NOT NULL DEFAULT 0,
       last_score    REAL
     )`,

    `CREATE UNIQUE INDEX IF NOT EXISTS card_passage_rung_unique
       ON card (passage_id, rung)`,

    // The hot query is "what is due now", across every passage.
    `CREATE INDEX IF NOT EXISTS card_due_at ON card (due_at)`,

    // Attempt rows are never pruned. That is a deliberate rule, not an
    // oversight: the user asked to keep the data even where the UI does not
    // surface it, so that a statistic they decide they want later can be
    // computed over real history rather than starting from the day they
    // asked. Rows are tiny and bounded by how often a human can practise.
    `CREATE TABLE IF NOT EXISTS attempt (
       id            INTEGER PRIMARY KEY,
       card_id       INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
       at            INTEGER NOT NULL,
       score         REAL    NOT NULL,
       correct_first INTEGER NOT NULL,
       total_steps   INTEGER NOT NULL,
       replay        INTEGER NOT NULL DEFAULT 0
     )`,

    `CREATE INDEX IF NOT EXISTS attempt_card_at ON attempt (card_id, at)`,
    `CREATE INDEX IF NOT EXISTS attempt_at ON attempt (at)`,
  ],

  // --- v2: task 0004 - no locks, per-passage answer mode, resume, settings --
  //
  // `card.state` is left in place rather than dropped: the SQL guard rejects
  // `PRAGMA`, and an unconditional `ALTER TABLE ... DROP COLUMN` is newer than
  // some bundled SQLite builds are guaranteed to support, where `ADD COLUMN`
  // is universal. The column keeps being written (as a coarse, purely
  // informational label - see `MemoryStore.applySchedule`) but nothing reads
  // it back; `RungView.level` (from `ladder.ts#levelFromScore`) replaced it as
  // the source of truth for what the UI shows.
  [
    // `NULL` means "use the global default" - see the `setting` table below.
    `ALTER TABLE passage ADD COLUMN answer_mode TEXT`,

    // Wall-clock length of the session that produced this attempt. Nullable
    // because existing rows have no duration recorded.
    `ALTER TABLE attempt ADD COLUMN duration_ms INTEGER`,

    // A small, generic key/value table for user preferences that are not tied
    // to one passage. `meta` is deliberately not reused for this: `meta`
    // exists for the migration bookkeeping in this file and mixing schema
    // version tracking with user preferences in the same table has bitten
    // other extensions when the two need different lifecycles (a preference
    // survives `npm run clean`-and-reinstall in a way a schema version must
    // not be allowed to appear to).
    `CREATE TABLE IF NOT EXISTS setting (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,

    // Where an in-progress activity paused, so "Resume" can pick it back up -
    // written after each verse (or ordering step), not on every keystroke.
    // One row per card: starting a new attempt at a card overwrites its old
    // resume point, and finishing one clears it.
    `CREATE TABLE IF NOT EXISTS resume_state (
       card_id       INTEGER PRIMARY KEY REFERENCES card(id) ON DELETE CASCADE,
       cursor        INTEGER NOT NULL,
       correct_first INTEGER NOT NULL,
       graded_units  INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL
     )`,
  ],

  // --- v3: tiers, and progress that is derived rather than stored -----------
  //
  // An activity is no longer one exercise but a small ladder of harder
  // renderings of itself (`ladder.ts#TIERS`), and the level the user sees is
  // computed from the best attempt at each tier rather than from the last
  // score. Two columns are all that needs to exist for that:
  //
  //   - `attempt.tier`, so an attempt remembers which rendering it answered.
  //     `DEFAULT 0` is what makes the upgrade lossless: every attempt recorded
  //     before this migration was the only rendering there was, which is tier
  //     0, so existing history keeps counting rather than being discarded or
  //     backfilled by a guess.
  //
  //   - `card.progress_reset_at`, nullable, meaning "attempts at or before
  //     this instant no longer count". It is the ONLY thing that can lower a
  //     level, and it is a timestamp rather than a delete because the
  //     never-prune rule still holds: a reset hides the history from scoring,
  //     it does not destroy it.
  [
    `ALTER TABLE attempt ADD COLUMN tier INTEGER NOT NULL DEFAULT 0`,

    `ALTER TABLE card ADD COLUMN progress_reset_at INTEGER`,

    // The hot query of the new model is "best score per tier for this card",
    // which is a `GROUP BY card_id, tier` - see `store.ts#listTierProgress`.
    `CREATE INDEX IF NOT EXISTS attempt_card_tier ON attempt (card_id, tier)`,
  ],

  // --- v4: T6 - a resume point remembers which tier it was taken at --------
  //
  // `blanks` tier 0 and tier 1 have different step counts (N verses vs. one
  // whole-passage step) and `ordering`'s tiers differ in which candidates a
  // step offers, so a `resume_state` row taken at one tier cannot be safely
  // reapplied at another - reinterpreting a tier-0 `blanks` cursor of, say, 3
  // against tier 1 (which only ever has step 0) is meaningless. `DEFAULT 0`
  // keeps the upgrade lossless: every resume row written before this column
  // existed was written by a session that only ever ran at tier 0.
  [`ALTER TABLE resume_state ADD COLUMN tier INTEGER NOT NULL DEFAULT 0`],

  // --- v5: soft delete - removing a passage hides it rather than erasing it --
  //
  // `deleted_at` is nullable and needs no backfill: NULL means live. A removed
  // passage keeps its cards and attempts so re-adding the same reference
  // restores progress; old rows are purged after a retention window.
  [
    `ALTER TABLE passage ADD COLUMN deleted_at INTEGER`,
    `CREATE INDEX IF NOT EXISTS passage_deleted_at ON passage (deleted_at)`,
  ],

  // --- v6: recite aloud - per-word verdict detail, and an opt-in flag -------
  //
  // `recite_detail` hangs one row off each recite attempt. Only verdict
  // letters, credits and counts are stored - never heard text. Kept to the
  // last 20 per card (`store.ts#recordReciteDetail`); the attempt rows
  // themselves are never pruned.
  [
    `ALTER TABLE passage ADD COLUMN recite_on INTEGER NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS recite_detail (
       attempt_id   INTEGER PRIMARY KEY REFERENCES attempt(id) ON DELETE CASCADE,
       card_id      INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
       at           INTEGER NOT NULL,
       verdicts     TEXT    NOT NULL,
       credits      TEXT    NOT NULL,
       verse_scores TEXT    NOT NULL,
       extras       INTEGER NOT NULL,
       strictness   TEXT    NOT NULL,
       engine_id    TEXT,
       model_id     TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS recite_detail_card_at ON recite_detail (card_id, at)`,
  ],

  // --- v7: task 0072 - push cards -------------------------------------------
  //
  // `push_card` is the schedule of notification-backed recall cards. A recall
  // card itself is an ordinary `card` row with rung 'recall' (rung is plain
  // TEXT), so no DDL is needed for it. `attempt.duration_ms` already exists
  // (v2), so it is not added again here.
  [
    `CREATE TABLE IF NOT EXISTS push_card (
       key        TEXT PRIMARY KEY,
       passage_id INTEGER NOT NULL REFERENCES passage(id) ON DELETE CASCADE,
       fire_at    INTEGER NOT NULL,
       origin     TEXT    NOT NULL,
       state      TEXT    NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS push_card_state_fire ON push_card (state, fire_at)`,
  ],
];

/** Create (or open) a file and bring it to `version` the way the extension's `migrate()` did. */
export function createLegacyDb(path: string, version: number): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.transaction(() => {
    for (let v = 0; v < version; v++) for (const s of LEGACY_MIGRATIONS[v] as string[]) db.exec(s);
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(version));
  })();
  return db;
}
