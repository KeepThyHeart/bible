/**
 * A memory database as it existed before the Memory redesign (task 0219):
 * raw rows at the current schema, written without any of the new features.
 *
 * Two lists with a focus set (`practiceScope` -> list 1), a single verse and
 * 6-verse passages, attempts on several tiers, a verse that is well learned
 * only through carry-down, a reset card, a soft-deleted passage, a paused
 * resume row (on Psalm 23, since a single verse has no mid-way point) and push cards. `test/preRedesign.test.ts` opens it with the real
 * service and checks nothing is migrated and nothing is lost.
 */

import type { TestSql } from '../helpers/sqlite';

export const DAY = 24 * 60 * 60 * 1000;
/** The fixture's "now": noon, local time. */
export const FIXTURE_NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();

const MODULE = 'bible_kjv';
const RUNGS_SINGLE = ['refmatch', 'blanks', 'firstletters', 'refprovide', 'recite'] as const;
const RUNGS_MULTI = ['ordering', ...RUNGS_SINGLE] as const;

export const LIST_FOCUS = 1;
export const LIST_OTHER = 2;

/** Passage ids, named for the scenario each one covers. */
export const P = {
  learningDue: 1, // John 3:16: attempts on blanks, due
  carryDown: 2, // Psalm 23:1-6: firstletters passed on both tiers -> known by carry-down; paused resume row
  fresh: 3, // Romans 8:28: never practised
  otherList: 4, // Genesis 1:1 (second list): learning, due
  reset: 5, // Proverbs 3:5-10: old attempts, then progress reset -> new again
  deleted: 6, // Hebrews 11:1: soft-deleted
  otherNew: 7, // Isaiah 41:10 (second list): never practised
} as const;

export const REFERENCES: Record<number, string> = {
  [P.learningDue]: 'John 3:16',
  [P.carryDown]: 'Psalm 23:1-6',
  [P.fresh]: 'Romans 8:28',
  [P.otherList]: 'Genesis 1:1',
  [P.reset]: 'Proverbs 3:5-10',
  [P.deleted]: 'Hebrews 11:1',
  [P.otherNew]: 'Isaiah 41:10',
};

/** Every table the fixture fills, for before/after row-count checks. */
export const FIXTURE_TABLES = [
  'memory_collection',
  'memory_passage',
  'memory_card',
  'memory_attempt',
  'memory_setting',
  'memory_resume_state',
  'memory_push_card',
] as const;

export function rowCounts(db: TestSql): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of FIXTURE_TABLES) {
    out[t] = db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n;
  }
  return out;
}

export function seedPreRedesignDb(db: TestSql, now: number = FIXTURE_NOW): void {
  const run = (sql: string, ...params: Array<string | number | null>) => void db.execute(sql, params);

  run(`INSERT INTO memory_collection (id, name, created_at) VALUES (?, 'Default', ?)`, LIST_FOCUS, now - 60 * DAY);
  run(`INSERT INTO memory_collection (id, name, created_at) VALUES (?, 'Psalms and more', ?)`, LIST_OTHER, now - 50 * DAY);

  const passage = (
    id: number,
    collectionId: number,
    verseCount: number,
    addedAgo: number,
    deletedAt: number | null = null,
  ) => {
    run(
      `INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, collectionId, MODULE, 1000 * id, 1000 * id + verseCount - 1, REFERENCES[id]!, verseCount, now - addedAgo * DAY, deletedAt,
    );
  };
  passage(P.learningDue, LIST_FOCUS, 1, 20);
  passage(P.carryDown, LIST_FOCUS, 6, 30);
  passage(P.fresh, LIST_FOCUS, 1, 10);
  passage(P.otherList, LIST_OTHER, 1, 25);
  passage(P.reset, LIST_FOCUS, 6, 9);
  passage(P.deleted, LIST_FOCUS, 1, 15, now - 1 * DAY);
  passage(P.otherNew, LIST_OTHER, 1, 5);

  // One card per material activity, as `syncLadders` leaves them. Ids are fixed so attempts can point at them.
  const cardId = (passageId: number, rung: string) => passageId * 10 + RUNGS_MULTI.indexOf(rung as never);
  const card = (
    passageId: number,
    rung: string,
    o: { state?: string; step?: number; dueAt?: number | null; streak?: number; score?: number | null; resetAt?: number | null } = {},
  ) => {
    run(
      `INSERT OR REPLACE INTO memory_card (id, passage_id, rung, state, interval_step, due_at, streak, last_score, progress_reset_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cardId(passageId, rung), passageId, rung, o.state ?? 'new', o.step ?? -1, o.dueAt ?? null,
      o.streak ?? 0, o.score ?? null, o.resetAt ?? null,
    );
  };
  const attempt = (passageId: number, rung: string, ago: number, score: number, tier: number, steps = 8) => {
    run(
      `INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps, replay, duration_ms, tier)
       VALUES (?, ?, ?, ?, ?, 0, 20000, ?)`,
      cardId(passageId, rung), now - ago * DAY, score, Math.round(score * steps), steps, tier,
    );
  };

  for (const id of [P.learningDue, P.fresh, P.otherList, P.deleted, P.otherNew]) {
    for (const rung of RUNGS_SINGLE) card(id, rung);
  }
  for (const id of [P.carryDown, P.reset]) {
    for (const rung of RUNGS_MULTI) card(id, rung);
  }

  // John 3:16: blanks tried on tier 0 (88%) three days ago, due since.
  card(P.learningDue, 'blanks', { state: 'learning', step: 0, dueAt: now - 2 * DAY, streak: 1, score: 0.88 });
  attempt(P.learningDue, 'blanks', 3, 0.88, 0);

  // Psalm 23: first letters passed on both tiers; ordering and blanks never opened (carry-down).
  card(P.carryDown, 'firstletters', { state: 'learning', step: 2, dueAt: now + 10 * DAY, streak: 2, score: 1 });
  attempt(P.carryDown, 'firstletters', 12, 0.9, 0);
  attempt(P.carryDown, 'firstletters', 5, 1, 1);
  // A second go at first letters was left half done (3 of 6 verses).
  run(
    `INSERT INTO memory_resume_state (card_id, cursor, correct_first, graded_units, updated_at, tier) VALUES (?, 3, 2, 3, ?, 1)`,
    cardId(P.carryDown, 'firstletters'), now - 1 * DAY,
  );

  // Genesis 1:1 (other list): two attempts on blanks (tiers 0 and 1), due yesterday.
  card(P.otherList, 'blanks', { state: 'learning', step: 1, dueAt: now - 1 * DAY, streak: 2, score: 0.85 });
  attempt(P.otherList, 'blanks', 9, 0.8, 0);
  attempt(P.otherList, 'blanks', 4, 0.85, 1);

  // Proverbs 3:5-10: ordering was practised, then progress was reset; history is kept but no longer counts.
  card(P.reset, 'ordering', { state: 'new', step: -1, dueAt: null, resetAt: now - 15 * DAY });
  attempt(P.reset, 'ordering', 40, 0.95, 0);
  attempt(P.reset, 'ordering', 30, 1, 1);

  // Hebrews 11:1: soft-deleted, history intact.
  card(P.deleted, 'blanks', { state: 'learning', step: 0, dueAt: now - 3 * DAY, streak: 1, score: 0.9 });
  attempt(P.deleted, 'blanks', 6, 0.9, 0);

  // Settings: the focus (practiceScope -> list 1) and two preferences.
  run(`INSERT INTO memory_setting (key, value) VALUES ('practiceScope', ?)`, JSON.stringify({ kind: 'list', id: LIST_FOCUS }));
  run(`INSERT INTO memory_setting (key, value) VALUES ('passageSortOrder', 'need')`);

  // Push cards: one waiting to be recalled, one scheduled for later.
  run(
    `INSERT INTO memory_push_card (key, passage_id, fire_at, origin, state, updated_at) VALUES ('push-1', ?, ?, 'daily', 'waiting', ?)`,
    P.learningDue, now - 2 * 3600_000, now - 2 * 3600_000,
  );
  run(
    `INSERT INTO memory_push_card (key, passage_id, fire_at, origin, state, updated_at) VALUES ('push-2', ?, ?, 'daily', 'scheduled', ?)`,
    P.carryDown, now + 20 * 3600_000, now - 1 * DAY,
  );
}
