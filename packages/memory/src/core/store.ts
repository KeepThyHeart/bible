/**
 * Every read and write the extension makes against its own database.
 *
 * No SQL exists outside this file and `db.ts`, and no value is ever
 * concatenated into a statement - all of them are bound parameters. A
 * reference typed by the user reaches this layer as a string and must never
 * become part of a query's text.
 *
 * The store owns rows. It deliberately owns no scoring and no interval
 * arithmetic: those live in `ladder.ts` and `scheduler.ts` as pure functions
 * so they can be tested without a database, and so that a change to the
 * ladder cannot quietly become a change to persistence.
 */

import type { MemorySql } from './ports';
import type {
  AnalyticsView,
  AnswerMode,
  AttemptRow,
  Card,
  Collection,
  ListSummary,
  Milestone,
  Passage,
  PassageSortOrder,
  Rung,
  Scope,
} from './types';
import {
  applicableRungs,
  levelForActivity,
  levelFromScore,
  materialRungs,
  passageWellLearned,
  PASS_THRESHOLD,
  summarizeActivity,
  WELL_LEARNED_LEVEL,
} from './ladder';
import type { ActivityLevel, TierBest } from './ladder';
import type { ScheduleResult } from './scheduler';
import { RECALL_RUNG } from './pushTypes';
import type { PushCardRow, PushCardState } from './pushTypes';

interface PushCardSqlRow {
  key: string;
  passage_id: number;
  fire_at: number;
  origin: string;
  state: string;
  updated_at: number;
}

function toPushCard(r: PushCardSqlRow): PushCardRow {
  return {
    key: r.key,
    passageId: r.passage_id,
    fireAt: r.fire_at,
    origin: r.origin === 'snooze' ? 'snooze' : 'plan',
    state: r.state as PushCardState,
    updatedAt: r.updated_at,
  };
}

/** What the push scheduler needs to know about one live passage. */
export interface PushCandidateFacts {
  passageId: number;
  reference: string;
  /** MAX(attempt.at) over every card of the passage, recall included. */
  lastAttemptAt: number | null;
  /** The recall card's due_at, when it has one. */
  recallDueAt: number | null;
}

/** How many recite detail rows are kept per card. */
export const RECITE_DETAIL_KEEP = 20;

/** Per-word detail of one recite attempt. No heard text, ever. */
export interface ReciteDetailInput {
  /** One char per expected word: c v n s w m h. */
  verdicts: string;
  credits: number[];
  verseScores: number[];
  /** Count of extra spoken words only. */
  extras: number;
  strictness: string;
  engineId?: string | null;
  modelId?: string | null;
}

/** Row shapes as SQLite returns them: snake_case, integers for booleans. */
interface PassageRow {
  id: number;
  collection_id: number;
  module_id: string;
  start_verse_id: number;
  end_verse_id: number;
  reference: string;
  verse_count: number;
  added_at: number;
  answer_mode: string | null;
  deleted_at: number | null;
  recite_on?: number | null;
}

interface CardRow {
  id: number;
  passage_id: number;
  rung: string;
  state: string;
  interval_step: number;
  due_at: number | null;
  streak: number;
  last_score: number | null;
  progress_reset_at: number | null;
}

/**
 * One card's history at one tier, since that card's last progress reset.
 *
 * Deliberately the aggregate rather than the rows: `ladder.ts` needs a best,
 * a count and a recency per tier and nothing else, and doing the reduction in
 * SQL keeps a plan's whole attempt history from crossing into JavaScript just
 * to be maxed.
 */
export interface TierProgressRow extends TierBest {
  cardId: number;
  tier: number;
  /** Best score at this tier since the reset, 0..1. */
  bestScore: number;
  /** Attempts at this tier since the reset. Always at least 1 - no row exists otherwise. */
  attempts: number;
  /** When the most recent of them happened, epoch ms. */
  lastAt: number;
}

export interface ResumeRow {
  cardId: number;
  cursor: number;
  correctFirst: number;
  gradedUnits: number;
  /**
   * Which difficulty tier this resume point was taken at, 0-based.
   *
   * `ordering` and `blanks` have tier-dependent step counts and candidate
   * sets, so a resume point is only valid for the tier it was written at -
   * `main.ts#startSession` compares this against the tier being started and
   * discards the resume point (rather than misapplying its cursor) on a
   * mismatch. `0` for every row written before this column existed.
   */
  tier: number;
  updatedAt: number;
}

interface ResumeSqlRow {
  card_id: number;
  cursor: number;
  correct_first: number;
  graded_units: number;
  tier: number;
  updated_at: number;
}

function toPassage(r: PassageRow): Passage {
  return {
    id: r.id,
    collectionId: r.collection_id,
    moduleId: r.module_id,
    startVerseId: r.start_verse_id,
    endVerseId: r.end_verse_id,
    reference: r.reference,
    verseCount: r.verse_count,
    addedAt: r.added_at,
    answerMode: r.answer_mode === 'firstLetter' || r.answer_mode === 'fullWord' ? r.answer_mode : null,
    reciteOn: r.recite_on === 1,
  };
}

function toCard(r: CardRow): Card {
  return {
    id: r.id,
    passageId: r.passage_id,
    rung: r.rung as Rung,
    intervalStep: r.interval_step,
    dueAt: r.due_at,
    streak: r.streak,
    lastScore: r.last_score,
  };
}

function toResume(r: ResumeSqlRow): ResumeRow {
  return {
    cardId: r.card_id,
    cursor: r.cursor,
    correctFirst: r.correct_first,
    gradedUnits: r.graded_units,
    tier: r.tier,
    updatedAt: r.updated_at,
  };
}

/** Label written to `card.state` - display-only, kept for humans reading the DB directly. */
function stateLabelFor(level: number): string {
  if (level >= WELL_LEARNED_LEVEL) return 'mastered';
  if (level > 0) return 'learning';
  return 'new';
}

const DEFAULT_ANSWER_MODE: AnswerMode = 'firstLetter';
const SETTING_DEFAULT_ANSWER_MODE = 'defaultAnswerMode';

const DEFAULT_PASSAGE_SORT_ORDER: PassageSortOrder = 'bible';
const SETTING_PASSAGE_SORT_ORDER = 'passageSortOrder';
const SETTING_SCOPE = 'practiceScope';

export class MemoryStore {
  constructor(private readonly db: MemorySql) {}

  // -- passages -------------------------------------------------------------

  async listPassages(collectionId: number): Promise<Passage[]> {
    const rows = await this.db.query<PassageRow>(
      `SELECT * FROM memory_passage WHERE collection_id = ? AND deleted_at IS NULL ORDER BY start_verse_id`,
      [collectionId],
    );
    return rows.map(toPassage);
  }

  async getPassage(id: number): Promise<Passage | undefined> {
    const row = await this.db.queryOne<PassageRow>(
      `SELECT * FROM memory_passage WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row ? toPassage(row) : undefined;
  }

  /**
   * Insert a passage and give it the ladder its shape implies.
   *
   * Two ways this can avoid a fresh `INSERT`, checked in order:
   *
   *  1. This exact range is already active in the target collection - a user
   *     slip, not an error worth a dialog - so the second add lands on the
   *     passage they already have (`created: false`, `revived: false`).
   *  2. A soft-deleted row matching this `(module, start, end)` exists in ANY
   *     list (left behind by `removePassage`): it is revived in place
   *     (`deleted_at` cleared, `collection_id` moved), keeping its cards and
   *     attempt history (`created: false`, `revived: true`). A match in the
   *     target list itself wins over one elsewhere. Because the per-list
   *     unique index also counts soft-deleted rows, a soft-deleted twin
   *     already sitting in the target list is hard-deleted first when the
   *     revived row comes from another list.
   */
  async addPassage(
    input: Omit<Passage, 'id' | 'answerMode' | 'reciteOn'>,
  ): Promise<{ passage: Passage; created: boolean; revived: boolean }> {
    const existing = await this.db.queryOne<PassageRow>(
      `SELECT * FROM memory_passage
        WHERE collection_id = ? AND module_id = ?
          AND start_verse_id = ? AND end_verse_id = ?
          AND deleted_at IS NULL`,
      [input.collectionId, input.moduleId, input.startVerseId, input.endVerseId],
    );
    if (existing) return { passage: toPassage(existing), created: false, revived: false };

    const revivable = await this.db.queryOne<PassageRow>(
      `SELECT * FROM memory_passage
        WHERE module_id = ? AND start_verse_id = ? AND end_verse_id = ?
          AND deleted_at IS NOT NULL
        ORDER BY (collection_id = ?) DESC, id DESC LIMIT 1`,
      [input.moduleId, input.startVerseId, input.endVerseId, input.collectionId],
    );
    if (revivable) {
      if (revivable.collection_id !== input.collectionId) {
        await this.db.run(
          `DELETE FROM memory_passage
            WHERE collection_id = ? AND module_id = ?
              AND start_verse_id = ? AND end_verse_id = ?
              AND deleted_at IS NOT NULL AND id <> ?`,
          [
            input.collectionId,
            input.moduleId,
            input.startVerseId,
            input.endVerseId,
            revivable.id,
          ],
        );
      }
      await this.db.run(`UPDATE memory_passage SET deleted_at = NULL, collection_id = ? WHERE id = ?`, [
        input.collectionId,
        revivable.id,
      ]);
      await this.syncLadders(input.collectionId);
      const passage = await this.getPassage(revivable.id);
      return { passage: passage as Passage, created: false, revived: true };
    }

    const res = await this.db.run(
      `INSERT INTO memory_passage
         (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at, answer_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        input.collectionId,
        input.moduleId,
        input.startVerseId,
        input.endVerseId,
        input.reference,
        input.verseCount,
        input.addedAt,
      ],
    );
    const id = Number(res.lastInsertRowid);

    // Adding a passage can change what applies to its *siblings* too: a lone
    // single verse gains a `refmatch` rung the moment a second passage exists.
    await this.syncLadders(input.collectionId);

    const passage = await this.getPassage(id);
    return { passage: passage as Passage, created: true, revived: false };
  }

  /**
   * Soft-delete a passage: stamp `deleted_at` and hide it from every read.
   *
   * Its cards and attempts stay, so re-adding the same reference restores its
   * progress; `purgeOldDeletedPassages` removes it for good after the
   * retention window.
   */
  async removePassage(id: number, now: number): Promise<void> {
    const passage = await this.getPassage(id);
    if (!passage) return;
    await this.db.run(`UPDATE memory_passage SET deleted_at = ? WHERE id = ?`, [now, id]);
    await this.syncLadders(passage.collectionId);
  }

  /**
   * Hard-delete passages soft-deleted more than `maxAgeMs` before `now`,
   * returning how many went. The `ON DELETE CASCADE` chain takes their cards,
   * attempts and resume rows. Called once per activation from `main.ts`.
   */
  async purgeOldDeletedPassages(now: number, maxAgeMs: number): Promise<number> {
    const res = await this.db.run(
      `DELETE FROM memory_passage WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
      [now - maxAgeMs],
    );
    return res.changes;
  }

  async setPassageReciteOn(passageId: number, on: boolean): Promise<void> {
    await this.db.run(`UPDATE memory_passage SET recite_on = ? WHERE id = ?`, [on ? 1 : 0, passageId]);
  }

  async setPassageAnswerMode(passageId: number, mode: AnswerMode | null): Promise<void> {
    await this.db.run(`UPDATE memory_passage SET answer_mode = ? WHERE id = ?`, [mode, passageId]);
  }

  /**
   * Every passage in `scope`: one list, or - `{ kind: 'all' }` - every list
   * together.
   *
   * The counterpart to `listPassages`, which stays collection-scoped only
   * (`syncLadders` and the per-passage reads in `main.ts` genuinely want one
   * passage's own list, never the panel's current browsing scope - see the
   * note on `applicableRungs` in `ladder.ts` for why that distinction is not
   * cosmetic).
   */
  async listPassagesInScope(scope: Scope): Promise<Passage[]> {
    if (scope.kind === 'all') {
      const rows = await this.db.query<PassageRow>(`SELECT * FROM memory_passage WHERE deleted_at IS NULL ORDER BY start_verse_id`);
      return rows.map(toPassage);
    }
    return this.listPassages(scope.id);
  }

  // -- collections (lists) ---------------------------------------------------

  /**
   * Every list, with the totals the "switch list" UI needs.
   *
   * `verseCount` is `SUM(passage.verse_count)`, not `COUNT(passage.id)` - a
   * list holding one 30-verse passage has 30 verses, not 1, and the scope
   * gate for the reference activities (`ladder.ts#MIN_VERSES_FOR_REFERENCE_ACTIVITIES`)
   * is a verse count. `LEFT JOIN` plus `COALESCE` so an empty list reads as
   * zero rather than dropping out of the result.
   */
  async listCollections(): Promise<ListSummary[]> {
    const rows = await this.db.query<{
      id: number;
      name: string;
      passageCount: number;
      verseCount: number;
    }>(
      `SELECT c.id                        AS id,
              c.name                      AS name,
              COUNT(p.id)                 AS passageCount,
              COALESCE(SUM(p.verse_count), 0) AS verseCount
         FROM memory_collection c
         LEFT JOIN memory_passage p ON p.collection_id = c.id AND p.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY c.id`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      passageCount: Number(r.passageCount),
      verseCount: Number(r.verseCount),
    }));
  }

  async createCollection(name: string, now: number): Promise<Collection> {
    const res = await this.db.run(`INSERT INTO memory_collection (name, created_at) VALUES (?, ?)`, [
      name,
      now,
    ]);
    return { id: Number(res.lastInsertRowid), name, createdAt: now };
  }

  async renameCollection(id: number, name: string): Promise<void> {
    await this.db.run(`UPDATE memory_collection SET name = ? WHERE id = ?`, [name, id]);
  }

  /** Non-deleted passages of a list, and how many of them have at least one attempt. */
  async listPracticeStats(id: number): Promise<{ total: number; practiced: number }> {
    const row = await this.db.queryOne<{ total: number; practiced: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN EXISTS (
                SELECT 1 FROM memory_attempt a JOIN memory_card c ON c.id = a.card_id WHERE c.passage_id = p.id
              ) THEN 1 ELSE 0 END), 0) AS practiced
         FROM memory_passage p WHERE p.collection_id = ? AND p.deleted_at IS NULL`,
      [id],
    );
    return { total: row?.total ?? 0, practiced: row?.practiced ?? 0 };
  }

  /**
   * Delete a list, moving everything it holds to `movePassagesTo` first.
   *
   * "Everything it holds" needs no separate step for cards and attempts: they
   * hang off `passage_id`, not `collection_id`, so reassigning a passage's
   * `collection_id` carries its cards and its whole attempt history with it
   * untouched. Only the now-empty `collection` row is actually deleted.
   *
   * Refuses - with a readable error, not a thrown SQL constraint violation -
   * when `id` is the only list, because a plan with zero lists is a state
   * nothing else in this extension can describe. Deliberately checked with a
   * real `SELECT COUNT(*)` rather than trusting a cached count: two panels
   * could both be looking at a two-list plan and both try to delete a
   * different one of the two lists.
   *
   * If `movePassagesTo` already holds the exact same `(module, start, end)`
   * range as one of the passages being moved, the `memory_passage_range_unique`
   * index rejects that single `UPDATE` and the whole deletion fails with that
   * SQL error surfacing to the caller - there is no reasonable place to
   * silently drop or merge one passage's history into another's here, unlike
   * `addPassage`/`movePassage`'s single-passage collision case.
   */
  async deleteCollection(id: number, movePassagesTo: number): Promise<void> {
    const countRow = await this.db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM memory_collection`);
    if ((countRow?.n ?? 0) <= 1) {
      throw new Error('You cannot delete your only list. Create another list first.');
    }
    if (movePassagesTo === id) {
      throw new Error('Choose a different list to move these passages to.');
    }

    await this.db.transaction(async (tx) => {
      // Soft-deleted rows still occupy `memory_passage_range_unique`. Clear the ones
      // that would collide: a soft-deleted twin in the target yields to an
      // active row moving in, and a soft-deleted row moving out is dropped if
      // the target already holds that range (active or not).
      await tx.run(
        `DELETE FROM memory_passage
          WHERE collection_id = ? AND deleted_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM memory_passage s
                         WHERE s.collection_id = ? AND s.deleted_at IS NULL
                           AND s.module_id = memory_passage.module_id
                           AND s.start_verse_id = memory_passage.start_verse_id
                           AND s.end_verse_id = memory_passage.end_verse_id)`,
        [movePassagesTo, id],
      );
      await tx.run(
        `DELETE FROM memory_passage
          WHERE collection_id = ? AND deleted_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM memory_passage t
                         WHERE t.collection_id = ?
                           AND t.module_id = memory_passage.module_id
                           AND t.start_verse_id = memory_passage.start_verse_id
                           AND t.end_verse_id = memory_passage.end_verse_id)`,
        [id, movePassagesTo],
      );
      await tx.run(`UPDATE memory_passage SET collection_id = ? WHERE collection_id = ?`, [
        movePassagesTo,
        id,
      ]);
      await tx.run(`DELETE FROM memory_collection WHERE id = ?`, [id]);
    });
  }

  /**
   * Reassign one passage to a different list.
   *
   * Mirrors `addPassage`'s own collision behaviour rather than throwing: if
   * the target list already holds this exact `(module, start, end)` range,
   * the move is a no-op and the existing row in the target list is returned
   * with `moved: false` - the same "a duplicate add just lands on what is
   * already there" reasoning `addPassage` documents, applied to a move
   * instead of an insert.
   */
  async movePassage(
    passageId: number,
    collectionId: number,
  ): Promise<{ passage: Passage; moved: boolean }> {
    const passage = await this.getPassage(passageId);
    if (!passage) throw new Error('That passage no longer exists.');
    if (passage.collectionId === collectionId) return { passage, moved: false };

    const existing = await this.db.queryOne<PassageRow>(
      `SELECT * FROM memory_passage
        WHERE collection_id = ? AND module_id = ?
          AND start_verse_id = ? AND end_verse_id = ?
          AND deleted_at IS NULL`,
      [collectionId, passage.moduleId, passage.startVerseId, passage.endVerseId],
    );
    if (existing) return { passage: toPassage(existing), moved: false };

    // A soft-deleted twin in the target would trip the unique index.
    await this.db.run(
      `DELETE FROM memory_passage
        WHERE collection_id = ? AND module_id = ?
          AND start_verse_id = ? AND end_verse_id = ?
          AND deleted_at IS NOT NULL`,
      [collectionId, passage.moduleId, passage.startVerseId, passage.endVerseId],
    );
    await this.db.run(`UPDATE memory_passage SET collection_id = ? WHERE id = ?`, [
      collectionId,
      passageId,
    ]);
    const moved = await this.getPassage(passageId);
    return { passage: moved as Passage, moved: true };
  }

  // -- settings ---------------------------------------------------------------

  async getSetting(key: string): Promise<string | undefined> {
    const row = await this.db.queryOne<{ value: string }>(
      `SELECT value FROM memory_setting WHERE key = ?`,
      [key],
    );
    return row?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.run(`INSERT OR REPLACE INTO memory_setting (key, value) VALUES (?, ?)`, [key, value]);
  }

  async getDefaultAnswerMode(): Promise<AnswerMode> {
    const value = await this.getSetting(SETTING_DEFAULT_ANSWER_MODE);
    return value === 'fullWord' ? 'fullWord' : DEFAULT_ANSWER_MODE;
  }

  async setDefaultAnswerMode(mode: AnswerMode): Promise<void> {
    await this.setSetting(SETTING_DEFAULT_ANSWER_MODE, mode);
  }

  async getPassageSortOrder(): Promise<PassageSortOrder> {
    const value = await this.getSetting(SETTING_PASSAGE_SORT_ORDER);
    return value === 'need' ? 'need' : DEFAULT_PASSAGE_SORT_ORDER;
  }

  async setPassageSortOrder(order: PassageSortOrder): Promise<void> {
    await this.setSetting(SETTING_PASSAGE_SORT_ORDER, order);
  }

  /**
   * The panel's persisted practice scope, defaulting to `'all'`.
   *
   * This is the one place a stale scope is caught: `practiceScope` can name a
   * list that a *different* call path has since deleted (or moved everything
   * out of and deleted - see `deleteCollection`), and a scope pointing at
   * nothing must not silently produce an empty or broken plan. So a `'list'`
   * scope is verified against the `collection` table on every read, and
   * treated as `'all'` the moment its list is gone - not written back here,
   * since a read should not mutate, but `setScope` overwrites it the next
   * time the panel actually chooses a scope.
   */
  async getScope(): Promise<Scope> {
    const raw = await this.getSetting(SETTING_SCOPE);
    if (!raw) return { kind: 'all' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: 'all' };
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { kind?: unknown }).kind !== 'list' ||
      typeof (parsed as { id?: unknown }).id !== 'number'
    ) {
      return { kind: 'all' };
    }

    const id = (parsed as { id: number }).id;
    const exists = await this.db.queryOne<{ id: number }>(`SELECT id FROM memory_collection WHERE id = ?`, [
      id,
    ]);
    return exists ? { kind: 'list', id } : { kind: 'all' };
  }

  async setScope(scope: Scope): Promise<void> {
    await this.setSetting(SETTING_SCOPE, JSON.stringify(scope));
  }

  // -- cards ----------------------------------------------------------------

  async listCards(passageId: number): Promise<Card[]> {
    const rows = await this.db.query<CardRow>(
      `SELECT * FROM memory_card WHERE passage_id = ? AND rung <> 'recall' ORDER BY id`,
      [passageId],
    );
    return rows.map(toCard);
  }

  async getCard(passageId: number, rung: Rung): Promise<Card | undefined> {
    const row = await this.db.queryOne<CardRow>(
      `SELECT * FROM memory_card WHERE passage_id = ? AND rung = ?`,
      [passageId, rung],
    );
    return row ? toCard(row) : undefined;
  }

  /**
   * Make every passage's card rows match the ladder its shape currently
   * implies.
   *
   * A rung that stops applying is **not deleted**. Removing the second
   * passage from a collection makes `refmatch` meaningless again, but the
   * user's attempts at it were real. The row stays and is reported as
   * inapplicable; it simply stops being offered.
   *
   * Unlike v0, a newly-applicable rung's card is inserted ready to practise
   * immediately (`due_at = NULL`, meaning "never attempted" rather than
   * "locked"): nothing gates it. `now` is no longer needed here because there
   * is no unlocking decision left to make at sync time.
   */
  async syncLadders(collectionId: number): Promise<void> {
    const passages = await this.listPassages(collectionId);

    for (const passage of passages) {
      // `materialRungs`, NOT `applicableRungs`. A card is where a history
      // hangs, so one exists for every activity the material could ever be
      // asked - including the two reference activities, whose 25-verse gate
      // is a fact about the plan today and will stop being true the moment
      // the user adds more. Freezing that gate into rows is exactly the
      // mistake this method's header warns about: the card would have to be
      // retro-inserted later, and the day it was inserted would silently
      // become the day the user's history with it began.
      const wanted = materialRungs(passage.verseCount);
      const existing = await this.listCards(passage.id);
      const have = new Set(existing.map((c) => c.rung));

      for (const rung of wanted) {
        if (have.has(rung)) continue;
        await this.db.run(
          `INSERT INTO memory_card (passage_id, rung, state, interval_step, due_at, streak, last_score)
           VALUES (?, ?, 'new', -1, NULL, 0, NULL)`,
          [passage.id, rung],
        );
      }
    }
  }

  /**
   * Apply a scheduling decision to a card.
   *
   * Every finished attempt reaches here now - there is no replay branch that
   * skips it. `card.state` is written for humans reading the database
   * directly; nothing in this extension reads it back (see the note in
   * `db.ts`'s v2 migration). It is written from `levelFromScore` rather than
   * from the new `levelForActivity` on purpose: it is a coarse label for
   * someone with a SQL prompt open, and giving it the tier-aware level would
   * make it look like the number the UI shows without being maintained as
   * one.
   */
  async applySchedule(cardId: number, result: ScheduleResult, score: number): Promise<void> {
    await this.db.run(
      `UPDATE memory_card
          SET interval_step = ?, due_at = ?, streak = ?, last_score = ?, state = ?
        WHERE id = ?`,
      [result.intervalStep, result.dueAt, result.streak, score, stateLabelFor(levelFromScore(score)), cardId],
    );
  }

  /**
   * Reset every card of one passage: the only action that can lower a level.
   *
   * Two separate things happen, and both are needed for "start this passage
   * again" to mean what the user thinks it means:
   *
   *   1. `progress_reset_at = now` on each card, so every attempt recorded at
   *      or before this instant stops counting towards the level. The rows
   *      are kept - the never-prune rule holds - they simply fall outside the
   *      window `listTierProgress` reads.
   *   2. The schedule returns to untouched (`interval_step = -1`,
   *      `due_at = NULL`, `streak = 0`, `last_score = NULL`) and any paused
   *      activity is discarded. A card that kept a six-month interval while
   *      claiming no history would be the worst of both.
   *
   * In one transaction because a half-applied reset - history hidden but the
   * schedule left at level-5 intervals, or the reverse - is a state no code
   * path knows how to describe.
   */
  async resetPassageProgress(passageId: number, now: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run(
        `UPDATE memory_card
            SET progress_reset_at = ?,
                interval_step = -1,
                due_at = NULL,
                streak = 0,
                last_score = NULL,
                state = ?
          WHERE passage_id = ?`,
        [now, stateLabelFor(0), passageId],
      );
      await tx.run(
        `DELETE FROM memory_resume_state
          WHERE card_id IN (SELECT id FROM memory_card WHERE passage_id = ?)`,
        [passageId],
      );
      await tx.run(
        `DELETE FROM memory_recite_detail
          WHERE card_id IN (SELECT id FROM memory_card WHERE passage_id = ?)`,
        [passageId],
      );
    });
  }

  // -- resume -----------------------------------------------------------------

  async getResume(cardId: number): Promise<ResumeRow | undefined> {
    const row = await this.db.queryOne<ResumeSqlRow>(
      `SELECT * FROM memory_resume_state WHERE card_id = ?`,
      [cardId],
    );
    return row ? toResume(row) : undefined;
  }

  async saveResume(
    cardId: number,
    state: { cursor: number; correctFirst: number; gradedUnits: number; tier?: number },
    now: number,
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO memory_resume_state (card_id, cursor, correct_first, graded_units, tier, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(card_id) DO UPDATE SET
         cursor = excluded.cursor,
         correct_first = excluded.correct_first,
         graded_units = excluded.graded_units,
         tier = excluded.tier,
         updated_at = excluded.updated_at`,
      [cardId, state.cursor, state.correctFirst, state.gradedUnits, state.tier ?? 0, now],
    );
  }

  async clearResume(cardId: number): Promise<void> {
    await this.db.run(`DELETE FROM memory_resume_state WHERE card_id = ?`, [cardId]);
  }

  // -- attempts -------------------------------------------------------------

  /**
   * Record one finished attempt.
   *
   * `tier` defaults to 0 rather than being required, and that default is the
   * same claim the v3 migration's `DEFAULT 0` makes: an attempt that does not
   * say which rendering it answered was the only rendering there was.
   */
  async recordAttempt(a: Omit<AttemptRow, 'id' | 'tier'> & { tier?: number }): Promise<number> {
    const res = await this.db.run(
      `INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps, replay, duration_ms, tier)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [a.cardId, a.at, a.score, a.correctFirst, a.totalSteps, a.durationMs, a.tier ?? 0],
    );
    return Number(res.lastInsertRowid);
  }

  /**
   * Store the per-word detail of one recite attempt, then keep only the
   * card's 20 most recent detail rows - in one transaction. Never stores any
   * heard text: verdict letters, credits and counts only.
   */
  async recordReciteDetail(
    attemptId: number,
    cardId: number,
    at: number,
    detail: ReciteDetailInput,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT OR REPLACE INTO memory_recite_detail
           (attempt_id, card_id, at, verdicts, credits, verse_scores, extras, strictness, engine_id, model_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          attemptId,
          cardId,
          at,
          detail.verdicts,
          JSON.stringify(detail.credits),
          JSON.stringify(detail.verseScores),
          detail.extras,
          detail.strictness,
          detail.engineId ?? null,
          detail.modelId ?? null,
        ],
      );
      await tx.run(
        `DELETE FROM memory_recite_detail
          WHERE card_id = ?
            AND attempt_id NOT IN (
              SELECT attempt_id FROM memory_recite_detail
               WHERE card_id = ?
               ORDER BY at DESC, attempt_id DESC
               LIMIT ?)`,
        [cardId, cardId, RECITE_DETAIL_KEEP],
      );
    });
  }

  /** Erase all per-word recite detail. Attempts, scores and schedule stay. */
  async deleteReciteHistory(): Promise<void> {
    await this.db.run(`DELETE FROM memory_recite_detail`);
  }

  /**
   * Recite cards due now: tried and due, or untried on a passage switched on
   * for recite. Kept apart from `dueCount`, which never counts recite.
   */
  async reciteDueCount(scope: Scope, now: number): Promise<number> {
    const scopeFilter = scope.kind === 'list' ? `AND p.collection_id = ?` : '';
    const row = await this.db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM memory_card c
         JOIN memory_passage p ON p.id = c.passage_id
        WHERE c.rung = 'recite' AND p.deleted_at IS NULL ${scopeFilter}
          AND ((c.due_at IS NOT NULL AND c.due_at <= ?) OR (c.due_at IS NULL AND p.recite_on = 1))`,
      scope.kind === 'list' ? [scope.id, now] : [now],
    );
    return row ? row.n : 0;
  }

  /** The next recite card due, skipping the passage ids in `exclude`. */
  async nextDueRecite(
    scope: Scope,
    now: number,
    exclude: number[],
  ): Promise<{ card: Card; passage: Passage } | undefined> {
    const scopeFilter = scope.kind === 'list' ? `AND p.collection_id = ?` : '';
    const excludeFilter =
      exclude.length > 0 ? `AND p.id NOT IN (${exclude.map(() => '?').join(', ')})` : '';
    const params: number[] = [];
    if (scope.kind === 'list') params.push(scope.id);
    params.push(now, ...exclude);
    const row = await this.db.queryOne<CardRow>(
      `SELECT c.* FROM memory_card c
         JOIN memory_passage p ON p.id = c.passage_id
        WHERE c.rung = 'recite' AND p.deleted_at IS NULL ${scopeFilter}
          AND ((c.due_at IS NOT NULL AND c.due_at <= ?) OR (c.due_at IS NULL AND p.recite_on = 1))
          ${excludeFilter}
        ORDER BY (c.due_at IS NULL), c.due_at, p.id
        LIMIT 1`,
      params,
    );
    if (!row) return undefined;
    const passage = await this.getPassage(row.passage_id);
    if (!passage) return undefined;
    return { card: toCard(row), passage };
  }

  /**
   * Best score, attempt count and recency per (card, tier), for a set of
   * passages - the one read the whole derived-progress model is built on.
   *
   * One query, not one per card: a plan of thirty passages has ~150 cards and
   * the level of every one of them is needed to draw a single plan row's worth
   * of squares.
   *
   * The reset window lives on `card`, not on `attempt`, so the filter is a
   * join: an attempt counts when its card has never been reset, or when it
   * happened **strictly after** the reset. Strictly is deliberate. A reset and
   * an attempt can land in the same millisecond - the panel sends "reset" and
   * the worker is still finishing the session that was open - and the attempt
   * in that tie belongs to the history being discarded, not to the fresh
   * start. `>=` would let the last attempt of the old run survive its own
   * reset.
   *
   * The `IN` list is built from the *count* of ids, never from their values:
   * the ids themselves still travel as bound parameters, one `?` each.
   */
  async listTierProgress(passageIds: number[]): Promise<TierProgressRow[]> {
    if (passageIds.length === 0) return [];
    const placeholders = passageIds.map(() => '?').join(', ');

    return this.db.query<TierProgressRow>(
      `SELECT a.card_id       AS cardId,
              a.tier          AS tier,
              MAX(a.score)    AS bestScore,
              COUNT(*)        AS attempts,
              MAX(a.at)       AS lastAt
         FROM memory_attempt a
         JOIN memory_card c ON c.id = a.card_id
        WHERE c.passage_id IN (${placeholders})
          AND (c.progress_reset_at IS NULL OR a.at > c.progress_reset_at)
        GROUP BY a.card_id, a.tier
        ORDER BY a.card_id, a.tier`,
      passageIds,
    );
  }

  // -- scheduling queries ---------------------------------------------------

  /**
   * How many applicable-or-not cards are due, filtered to `scope`.
   *
   * Was silently global before T5 - every caller happened to have exactly one
   * collection, so a missing `WHERE collection_id = ?` was invisible. Now that
   * a plan can hold several lists, an unscoped count would double as "due
   * across every list" even when the caller asked about one, so `scope` is
   * required rather than defaulted.
   */
  async dueCount(scope: Scope, now: number): Promise<number> {
    if (scope.kind === 'all') {
      const row = await this.db.queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n
           FROM memory_card c
           JOIN memory_passage p ON p.id = c.passage_id
          WHERE c.due_at IS NOT NULL AND c.due_at <= ? AND c.rung NOT IN ('recite', 'recall') AND p.deleted_at IS NULL`,
        [now],
      );
      return row ? row.n : 0;
    }
    const row = await this.db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM memory_card c
         JOIN memory_passage p ON p.id = c.passage_id
        WHERE c.due_at IS NOT NULL AND c.due_at <= ? AND p.collection_id = ?
          AND c.rung NOT IN ('recite', 'recall') AND p.deleted_at IS NULL`,
      [now, scope.id],
    );
    return row ? row.n : 0;
  }

  /**
   * The next card to practise, filtered to `scope` - see `dueCount` for why
   * scoping is no longer optional.
   *
   * Ordered by due date, then by rung position so that a passage with two
   * rungs due is worked from the bottom up rather than in row order - being
   * asked for first letters before the ordering rung of the same passage
   * would be backwards.
   */
  async nextDueCard(scope: Scope, now: number): Promise<{ card: Card; passage: Passage } | undefined> {
    const scopeFilter = scope.kind === 'list' ? `AND p.collection_id = ?` : '';
    const params = scope.kind === 'list' ? [now, scope.id] : [now];
    const row = await this.db.queryOne<CardRow>(
      `SELECT c.* FROM memory_card c
         JOIN memory_passage p ON p.id = c.passage_id
        WHERE c.due_at IS NOT NULL AND c.due_at <= ? AND c.rung NOT IN ('recite', 'recall') AND p.deleted_at IS NULL ${scopeFilter}
        ORDER BY c.due_at ASC,
                 CASE c.rung
                   WHEN 'ordering' THEN 0
                   WHEN 'refmatch' THEN 0
                   WHEN 'blanks' THEN 1
                   WHEN 'firstletters' THEN 2
                   WHEN 'refprovide' THEN 3
                   ELSE 4
                 END ASC
        LIMIT 1`,
      params,
    );
    if (!row) return undefined;
    const passage = await this.getPassage(row.passage_id);
    if (!passage) return undefined;
    return { card: toCard(row), passage };
  }

  // -- push cards (task 0072) ---------------------------------------------------

  async getRecallCard(passageId: number): Promise<Card | undefined> {
    const row = await this.db.queryOne<CardRow>(
      `SELECT * FROM memory_card WHERE passage_id = ? AND rung = ?`,
      [passageId, RECALL_RUNG],
    );
    return row ? toCard(row) : undefined;
  }

  /** Create the passage's recall card if missing, and return it. Idempotent. */
  async ensureRecallCard(passageId: number): Promise<Card> {
    await this.db.run(
      `INSERT OR IGNORE INTO memory_card (passage_id, rung, state, interval_step, due_at, streak, last_score)
       VALUES (?, ?, 'new', -1, NULL, 0, NULL)`,
      [passageId, RECALL_RUNG],
    );
    return (await this.getRecallCard(passageId)) as Card;
  }

  async setCardDueAt(cardId: number, dueAt: number | null): Promise<void> {
    await this.db.run(`UPDATE memory_card SET due_at = ? WHERE id = ?`, [dueAt, cardId]);
  }

  /** Live passages across every list, with the facts push selection needs. */
  async listPushCandidateFacts(): Promise<PushCandidateFacts[]> {
    const rows = await this.db.query<{
      passageId: number;
      reference: string;
      lastAttemptAt: number | null;
      recallDueAt: number | null;
    }>(
      `SELECT p.id AS passageId,
              p.reference AS reference,
              (SELECT MAX(a.at) FROM memory_attempt a JOIN memory_card c ON c.id = a.card_id
                WHERE c.passage_id = p.id) AS lastAttemptAt,
              (SELECT c.due_at FROM memory_card c
                WHERE c.passage_id = p.id AND c.rung = ?) AS recallDueAt
         FROM memory_passage p
        WHERE p.deleted_at IS NULL
        ORDER BY p.id`,
      [RECALL_RUNG],
    );
    return rows;
  }

  async getPushSettingsRaw(): Promise<string | undefined> {
    return this.getSetting('pushCards');
  }

  async setPushSettingsRaw(json: string): Promise<void> {
    await this.setSetting('pushCards', json);
  }

  async listPushCards(states?: PushCardState[]): Promise<PushCardRow[]> {
    if (states && states.length === 0) return [];
    const where = states ? `WHERE state IN (${states.map(() => '?').join(', ')})` : '';
    const rows = await this.db.query<PushCardSqlRow>(
      `SELECT * FROM memory_push_card ${where} ORDER BY fire_at ASC, key ASC`,
      states ?? [],
    );
    return rows.map(toPushCard);
  }

  async getPushCard(key: string): Promise<PushCardRow | undefined> {
    const row = await this.db.queryOne<PushCardSqlRow>(`SELECT * FROM memory_push_card WHERE key = ?`, [key]);
    return row ? toPushCard(row) : undefined;
  }

  /** Insert rows, ignoring keys that already exist. */
  async insertPushCards(rows: PushCardRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const r of rows) {
        await tx.run(
          `INSERT OR IGNORE INTO memory_push_card (key, passage_id, fire_at, origin, state, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [r.key, r.passageId, r.fireAt, r.origin, r.state, r.updatedAt],
        );
      }
    });
  }

  /** Delete scheduled rows of `origin` that fire after `now`. */
  async deleteFutureScheduled(now: number, origin: 'plan' | 'snooze'): Promise<number> {
    const res = await this.db.run(
      `DELETE FROM memory_push_card WHERE state = 'scheduled' AND origin = ? AND fire_at > ?`,
      [origin, now],
    );
    return res.changes;
  }

  /** Delete every scheduled row regardless of origin. */
  async deleteAllScheduled(): Promise<void> {
    await this.db.run(`DELETE FROM memory_push_card WHERE state = 'scheduled'`);
  }

  async setPushCardState(key: string, state: PushCardState, now: number): Promise<boolean> {
    const res = await this.db.run(`UPDATE memory_push_card SET state = ?, updated_at = ? WHERE key = ?`, [
      state,
      now,
      key,
    ]);
    return res.changes > 0;
  }

  /** Mark scheduled rows with fire_at <= now as `state`; returns the affected rows (before change). */
  async promoteScheduled(now: number, state: PushCardState): Promise<PushCardRow[]> {
    const rows = await this.db.query<PushCardSqlRow>(
      `SELECT * FROM memory_push_card WHERE state = 'scheduled' AND fire_at <= ? ORDER BY fire_at`,
      [now],
    );
    if (rows.length > 0) {
      await this.db.run(
        `UPDATE memory_push_card SET state = ?, updated_at = ? WHERE state = 'scheduled' AND fire_at <= ?`,
        [state, now, now],
      );
    }
    return rows.map(toPushCard);
  }

  /**
   * Passage ids that already have a card on each local day, for rows whose
   * fire_at is at or after `fromDayStart`. `dayStartOf` maps a timestamp to its
   * local day start (injected: the store has no calendar).
   */
  async usedPassageIdsByDay(
    fromDayStart: number,
    dayStartOf: (ms: number) => number,
  ): Promise<Map<number, Set<number>>> {
    const rows = await this.db.query<{ passage_id: number; fire_at: number }>(
      `SELECT passage_id, fire_at FROM memory_push_card
        WHERE fire_at >= ? AND state <> 'dropped'`,
      [fromDayStart],
    );
    const out = new Map<number, Set<number>>();
    for (const r of rows) {
      const day = dayStartOf(r.fire_at);
      const set = out.get(day);
      if (set) set.add(r.passage_id);
      else out.set(day, new Set([r.passage_id]));
    }
    return out;
  }

  async waitingCount(): Promise<number> {
    const row = await this.db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM memory_push_card pc JOIN memory_passage p ON p.id = pc.passage_id
        WHERE pc.state = 'waiting' AND p.deleted_at IS NULL`,
    );
    return row ? row.n : 0;
  }

  /** Delete fired/done/dropped rows last touched more than `maxAgeMs` ago. */
  async prunePushCards(now: number, maxAgeMs: number): Promise<number> {
    const res = await this.db.run(
      `DELETE FROM memory_push_card WHERE state IN ('fired', 'done', 'dropped') AND updated_at < ?`,
      [now - maxAgeMs],
    );
    return res.changes;
  }

  // -- analytics --------------------------------------------------------------

  /**
   * Encouragement-oriented aggregates for the Analytics screen.
   *
   * Deliberately narrower than the old "Progress" screen: "rungs mastered"
   * and "where the effort went" were dropped per the task 0004 review in
   * favour of numbers a user studying scripture actually wants to see move -
   * see `AnalyticsView`.
   */
  async analytics(scope: Scope, now: number): Promise<AnalyticsView> {
    const passages = await this.listPassagesInScope(scope);
    const facts = scopeOf(passages);
    const tierRows = byCard(await this.listTierProgress(passages.map((p) => p.id)));

    let versesLearned = 0;
    let passagesWellLearned = 0;
    for (const p of passages) {
      // The new rule, not `max(level) >= 4`: every applicable activity has to
      // be satisfied, so a passage whose `firstletters` was aced once but
      // whose ordering has never been opened no longer counts itself learned.
      const cards = await this.listCards(p.id);
      const levels = activityLevels(p, cards, tierRows, facts);
      if (passageWellLearned(levels)) {
        versesLearned += p.verseCount;
        passagesWellLearned += 1;
      }
    }

    const streakDays = await this.streakDays(now);
    const calendar = await this.calendar(now);
    const recentlyReached = await this.recentlyReached(passages);
    const nextTarget = (Math.floor(versesLearned / 5) + 1) * 5;

    return {
      streakDays,
      versesLearned,
      passagesWellLearned,
      calendar,
      recentlyReached,
      nextMilestone: { versesLearned: nextTarget, toGo: nextTarget - versesLearned },
    };
  }

  /** Consecutive calendar days, ending today, with at least one attempt. */
  private async streakDays(now: number): Promise<number> {
    const rows = await this.db.query<{ day: string }>(
      `SELECT DISTINCT date(at / 1000, 'unixepoch', 'localtime') AS day FROM memory_attempt`,
    );
    const days = new Set(rows.map((r) => r.day));
    let streak = 0;
    const cursor = new Date(now);
    for (;;) {
      const key = localDateKey(cursor);
      if (!days.has(key)) break;
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  /** The last 35 days, oldest first, marked for whether anything was attempted. */
  private async calendar(now: number): Promise<AnalyticsView['calendar']> {
    const rows = await this.db.query<{ day: string }>(
      `SELECT DISTINCT date(at / 1000, 'unixepoch', 'localtime') AS day FROM memory_attempt`,
    );
    const practicedDays = new Set(rows.map((r) => r.day));

    const days: AnalyticsView['calendar'] = [];
    const cursor = new Date(now);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - 34);
    for (let i = 0; i < 35; i += 1) {
      days.push({ date: cursor.getTime(), practiced: practicedDays.has(localDateKey(cursor)) });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  /**
   * The most recent times a *tier* was passed for the first time, newest
   * first, capped at five.
   *
   * The milestone event changed with the model. It used to be "an attempt
   * scored level 4 or better", which under a derived, tier-weighted level is
   * no longer an event at all - a single strong attempt on the easy tier of a
   * two-tier activity does not reach level 4 and never will on its own, so
   * the old rule would have quietly stopped producing anything for most
   * activities. A tier passing `PASS_THRESHOLD` for the first time is the
   * event that actually corresponds to the user getting somewhere, and it
   * fires once per (card, tier) - never twice for the same ground.
   *
   * `level` is the activity's level *as of that moment*, replayed forward
   * from the attempts, rather than the level it has today: a milestone is a
   * record of where the user stood when they passed, and backdating today's
   * level onto it would make the list re-write itself every session.
   *
   * Still a full scan of attempts per card rather than a maintained table:
   * attempt volume for one user's plan is small (see the never-prune rule in
   * `db.ts`) and a milestone is inherently a derived fact, not a written one.
   */
  private async recentlyReached(passages: Passage[]): Promise<Milestone[]> {
    const found: Milestone[] = [];

    for (const passage of passages) {
      const cards = await this.listCards(passage.id);
      for (const card of cards) {
        // Same reset window as `listTierProgress`, and the same strictly-
        // greater boundary: a reset discards the run it ends.
        const attempts = await this.db.query<{ at: number; score: number; tier: number }>(
          `SELECT a.at AS at, a.score AS score, a.tier AS tier
             FROM memory_attempt a
             JOIN memory_card c ON c.id = a.card_id
            WHERE a.card_id = ?
              AND (c.progress_reset_at IS NULL OR a.at > c.progress_reset_at)
            ORDER BY a.at ASC, a.id ASC`,
          [card.id],
        );

        // Replayed rather than aggregated, because the level at the instant
        // of the pass is part of what is being recorded.
        const seen = new Map<number, TierBest>();
        for (const a of attempts) {
          const before = seen.get(a.tier);
          const alreadyPassed = before !== undefined && before.bestScore >= PASS_THRESHOLD;
          seen.set(a.tier, {
            tier: a.tier,
            bestScore: before ? Math.max(before.bestScore, a.score) : a.score,
            attempts: (before?.attempts ?? 0) + 1,
          });
          if (alreadyPassed || a.score < PASS_THRESHOLD) continue;

          found.push({
            passageId: passage.id,
            reference: passage.reference,
            rung: card.rung,
            level: levelForActivity(summarizeActivity(card.rung, [...seen.values()])),
            at: a.at,
          });
        }
      }
    }

    found.sort((a, b) => b.at - a.at);
    return found.slice(0, 5);
  }
}

// ---------------------------------------------------------------------------
// Derived progress helpers
// ---------------------------------------------------------------------------

/**
 * Group `listTierProgress` rows by card id.
 *
 * Exported because `main.ts#buildPlanView` reads the same query - the plan
 * view and the analytics screen must not end up with two ways of turning rows
 * into levels.
 */
export function byCard(rows: readonly TierProgressRow[]): Map<number, TierProgressRow[]> {
  const grouped = new Map<number, TierProgressRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.cardId);
    if (list) list.push(row);
    else grouped.set(row.cardId, [row]);
  }
  return grouped;
}

/** The collection-wide facts `applicableRungs` reads. */
export interface ScopeFacts {
  siblingCount: number;
  scopeVerseCount: number;
}

/** The scope one collection's passages add up to. */
export function scopeOf(passages: readonly Passage[]): ScopeFacts {
  return {
    siblingCount: passages.length,
    scopeVerseCount: passages.reduce((total, p) => total + p.verseCount, 0),
  };
}

/**
 * One passage's activities, each with its derived level and whether it applies
 * - the input `ladder.ts#passageWellLearned` wants.
 */
export function activityLevels(
  passage: Passage,
  cards: readonly Card[],
  tierRows: Map<number, TierProgressRow[]>,
  scope: ScopeFacts,
): ActivityLevel[] {
  const applicable = new Set(
    applicableRungs(passage.verseCount, scope.siblingCount, scope.scopeVerseCount),
  );
  return cards.map((card) => ({
    rung: card.rung,
    level: levelForActivity(summarizeActivity(card.rung, tierRows.get(card.id) ?? [])),
    applicable: applicable.has(card.rung),
  }));
}

/** `YYYY-MM-DD` in local time, for grouping attempts by calendar day. */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The id of the list new passages land in, creating one named `name` when
 * the table is empty. Idempotent: a second call returns the same id.
 */
export async function ensureDefaultCollection(
  db: MemorySql,
  name: string,
  now: number,
): Promise<number> {
  const existing = await db.queryOne<{ id: number }>(
    `SELECT id FROM memory_collection ORDER BY id LIMIT 1`,
  );
  if (existing) return existing.id;

  const res = await db.run(`INSERT INTO memory_collection (name, created_at) VALUES (?, ?)`, [
    name,
    now,
  ]);
  return Number(res.lastInsertRowid);
}
