/**
 * Store and schema tests, run against a REAL SQLite database.
 *
 * Everything asserted here is a claim about SQL, not about TypeScript: whether
 * a cascade actually removes the attempts of a deleted passage, whether the
 * unique index really lets a duplicate add through as an existing row, whether
 * `ORDER BY ... CASE rung` genuinely beats row order, whether the values
 * written come back as the same types they went in as. A hand-written
 * in-memory double would encode my belief about each of those and then agree
 * with me, which is the failure mode that makes a green suite worthless. So
 * a real SQLite test database is used throughout and no method on it is stubbed.
 *
 * ## v1: nothing is locked
 *
 * Task 0004 dropped the whole locked/unlocked distinction: every applicable
 * rung's card is created ready to practise, with `due_at = NULL` meaning
 * "never attempted" rather than "gated behind an earlier rung". A card only
 * becomes due once it has actually been scheduled by a real attempt - see
 * `dueCount and nextDueCard` below, which used to rely on v0's auto-unlock to
 * get a due card for free and now schedules one explicitly.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryTestDb } from './helpers/sqlite';
import { ensureDefaultCollection, MemoryStore } from '../src/core/store';
import { schedule, makeRng } from '../src/core/scheduler';
import {
  applicableRungs,
  levelForActivity,
  summarizeActivity,
  TIERS,
  MIN_VERSES_FOR_REFERENCE_ACTIVITIES,
} from '../src/core/ladder';
import type { Passage, Rung } from '../src/core/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A fixed instant, so no assertion here depends on when the suite runs. */
const NOW = Date.UTC(2026, 0, 15, 9, 0, 0);

const KJV = 'kjv';

/** A fresh database with the default collection, as the worker leaves it. */
async function freshStore() {
  const harness = createMemoryTestDb().sql;
  const collectionId = await ensureDefaultCollection(harness, 'My plan', NOW);
  return { harness, collectionId, store: new MemoryStore(harness) };
}

/** Passage input in the shape `addPassage` wants, with sensible defaults. */
function passageInput(
  collectionId: number,
  startVerseId: number,
  verseCount: number,
  reference: string,
): Omit<Passage, 'id' | 'answerMode' | 'reciteOn'> {
  return {
    collectionId,
    moduleId: KJV,
    startVerseId,
    endVerseId: startVerseId + verseCount - 1,
    reference,
    verseCount,
    addedAt: NOW,
  };
}

const rungsOf = (cards: { rung: Rung }[]) => cards.map((c) => c.rung).sort();

/**
 * Pass every tier of one activity at `score`, which is what "mastered" now
 * takes: a level of 4 or better needs completeness AND accuracy, so a single
 * strong attempt on the easy tier is not enough on its own (it is level 3).
 */
async function masterActivity(
  store: MemoryStore,
  passageId: number,
  rung: Rung,
  score: number,
  at = NOW,
): Promise<void> {
  const card = await store.getCard(passageId, rung);
  for (let tier = 0; tier < TIERS[rung]; tier += 1) {
    await store.recordAttempt({
      cardId: card!.id,
      at: at + tier,
      score,
      correctFirst: 19,
      totalSteps: 20,
      durationMs: 1000,
      tier,
    });
  }
}

/** The level one activity currently reads, straight through the real query. */
async function levelOf(store: MemoryStore, passageId: number, rung: Rung): Promise<number> {
  const card = await store.getCard(passageId, rung);
  const rows = (await store.listTierProgress([passageId])).filter((r) => r.cardId === card!.id);
  return levelForActivity(summarizeActivity(rung, rows));
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe('schema', () => {
  it('creates the memory_* tables', async () => {
    const harness = createMemoryTestDb().sql;
    const tables = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'memory_attempt',
        'memory_card',
        'memory_collection',
        'memory_passage',
        'memory_setting',
        'memory_resume_state',
      ]),
    );
  });

  it('has the v2 columns', async () => {
    // `answer_mode` and `duration_ms`: every read through `MemoryStore` would
    // throw "no such column" if either were missing from the schema.
    const harness = createMemoryTestDb().sql;
    const passageCols = await harness.query<{ name: string }>(`PRAGMA table_info(memory_passage)`);
    expect(passageCols.map((c) => c.name)).toContain('answer_mode');
    const attemptCols = await harness.query<{ name: string }>(`PRAGMA table_info(memory_attempt)`);
    expect(attemptCols.map((c) => c.name)).toContain('duration_ms');
  });

  it('has the v3 columns and the tier index', async () => {
    const harness = createMemoryTestDb().sql;

    const attemptCols = await harness.query<{ name: string }>(`PRAGMA table_info(memory_attempt)`);
    expect(attemptCols.map((c) => c.name)).toContain('tier');
    const cardCols = await harness.query<{ name: string }>(`PRAGMA table_info(memory_card)`);
    expect(cardCols.map((c) => c.name)).toContain('progress_reset_at');

    const indexes = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index'`,
    );
    expect(indexes.map((i) => i.name)).toContain('memory_attempt_card_tier');
  });

  it('keeps foreign keys enforceable, which the cascades depend on', async () => {
    // The delete cascades below are declared in the schema but only take
    // effect when `foreign_keys` is on. The host opens the file that way and
    // the test db mirrors it; asserting the constraint actually bites here
    // means a later cascade failure can be read as a store bug rather than as
    // a pragma that was never set.
    const harness = createMemoryTestDb().sql;
    await expect(
      harness.run(
        `INSERT INTO memory_card (passage_id, rung, state, interval_step, due_at, streak, last_score)
         VALUES (?, ?, ?, -1, NULL, 0, NULL)`,
        [9999, 'blanks', 'new'],
      ),
    ).rejects.toThrow();
  });

  it('rolls back a transaction body that throws, through the real SqlPort', async () => {
    const harness = createMemoryTestDb().sql;
    const store = new MemoryStore(harness);
    const a = await ensureDefaultCollection(harness, 'My plan', NOW);
    const b = (await store.createCollection('Second', NOW)).id;

    // Raw transaction: a write followed by a failing statement leaves nothing.
    const { passage: p1 } = await store.addPassage(passageInput(a, 43003016, 1, 'John 3:16'));
    await expect(
      harness.transaction(async (tx) => {
        await tx.run(`UPDATE memory_passage SET collection_id = ? WHERE id = ?`, [b, p1.id]);
        await tx.run(`INSERT INTO memory_no_such_table (x) VALUES (1)`);
      }),
    ).rejects.toThrow();
    expect(await store.listPassages(a)).toHaveLength(1);
    expect(await store.listPassages(b)).toHaveLength(0);

    // The store's own transaction: deleteCollection first clears a
    // soft-deleted twin, then its move UPDATE hits the unique range index
    // (an active duplicate in the target) and the whole deletion must undo.
    await store.addPassage(passageInput(b, 19023001, 1, 'Psalm 23:1')); // active twin in `b`
    const { passage: twin } = await store.addPassage(passageInput(a, 19023001, 1, 'Psalm 23:1'));
    await store.removePassage(twin.id, NOW); // soft-deleted in `a`
    await store.addPassage(passageInput(b, 43003016, 1, 'John 3:16')); // collides with p1
    await expect(store.deleteCollection(a, b)).rejects.toThrow();

    expect(await harness.query(`SELECT * FROM memory_collection`)).toHaveLength(2);
    expect(await store.listPassages(a)).toHaveLength(1);
    const softDeleted = await harness.query(
      `SELECT id FROM memory_passage WHERE collection_id = ? AND deleted_at IS NOT NULL`,
      [a],
    );
    expect(softDeleted).toHaveLength(1);

    // The port's lock was released: it is usable afterwards.
    expect(await harness.query(`SELECT 1 FROM memory_collection`)).toHaveLength(2);
  });
});

describe('ensureDefaultCollection', () => {
  it('creates one collection and returns the same id afterwards', async () => {
    // Called on every worker start. A second row would split the plan in two
    // and hide half the user's passages behind a collection id nothing looks
    // at, with no error anywhere.
    const harness = createMemoryTestDb().sql;
    const first = await ensureDefaultCollection(harness, 'My plan', NOW);
    const second = await ensureDefaultCollection(harness, 'Something else', NOW + DAY_MS);
    expect(second).toBe(first);
    expect(await harness.query(`SELECT * FROM memory_collection`)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Adding passages
// ---------------------------------------------------------------------------

describe('addPassage', () => {
  it('gives a multi-verse passage a card for every rung the material allows', async () => {
    // v2: cards exist for every activity the *material* could ever be asked,
    // from the moment the passage is added - including the two reference
    // activities, whose 25-verse scope gate is a read-time fact that will stop
    // being true as the plan grows. See `ladder.ts#materialRungs`.
    const { store, collectionId } = await freshStore();
    const { passage, created } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    expect(created).toBe(true);

    const cards = await store.listCards(passage.id);
    expect(rungsOf(cards)).toEqual([
      'blanks',
      'firstletters',
      'ordering',
      'recite',
      'refmatch',
      'refprovide',
    ]);
    expect(cards).toHaveLength(6);
  });

  it('withholds only the card the material itself rules out', async () => {
    // A single verse has no order and never will, however the plan grows, so
    // `ordering` is the one rung it is right to never create a card for. That
    // is the whole difference between `materialRungs` and `applicableRungs`:
    // this one is permanent, the scope gates are not.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const cards = await store.listCards(passage.id);
    expect(rungsOf(cards)).toEqual(['blanks', 'firstletters', 'recite', 'refmatch', 'refprovide']);
    expect(rungsOf(cards)).not.toContain('ordering');
  });

  it('creates every applicable rung ready to practise, none of them due yet', async () => {
    // Task 0004: nothing is locked, so there is no "first rung" special case
    // any more - every card starts identically, at `dueAt: null` ("never
    // attempted"), and stays that way until a real attempt schedules it.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    const cards = await store.listCards(passage.id);
    for (const card of cards) {
      expect(card.dueAt).toBeNull();
      expect(card.intervalStep).toBe(-1);
      expect(card.lastScore).toBeNull();
      expect(card.streak).toBe(0);
    }
  });

  it('returns the existing passage when the same range is added twice', async () => {
    // A unique index sits on (collection, module, start, end). Hitting it
    // would surface in the panel as an opaque RPC failure, but adding a
    // passage twice is a user slip rather than an error worth a dialog - the
    // second add should simply land on the passage they already have. This is
    // asserted against real SQL because the pre-check and the index have to
    // agree on what "the same range" means.
    const { store, collectionId } = await freshStore();
    const input = passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3');

    const first = await store.addPassage(input);
    const second = await store.addPassage({ ...input, addedAt: NOW + DAY_MS });

    expect(second.created).toBe(false);
    expect(second.passage.id).toBe(first.passage.id);
    // The original row is returned untouched rather than overwritten: the
    // first add is when the user started learning it, and resetting `addedAt`
    // would rewrite their history because they typed the reference again.
    expect(second.passage.addedAt).toBe(NOW);
    expect(await store.listPassages(collectionId)).toHaveLength(1);
    // And no second ladder was built on top of the first.
    expect(await store.listCards(first.passage.id)).toHaveLength(6);
  });

  it('treats the same range in a different module as a different passage', async () => {
    // The words differ between translations, so the cards differ - the same
    // reference in two modules is two memorisation tasks. The module is part
    // of the uniqueness key precisely so this add is not swallowed as a
    // duplicate.
    const { store, collectionId } = await freshStore();
    const input = passageInput(collectionId, 43003016, 1, 'John 3:16');
    await store.addPassage(input);
    const other = await store.addPassage({ ...input, moduleId: 'esv' });
    expect(other.created).toBe(true);
    expect(await store.listPassages(collectionId)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The ladder is derived, not frozen
// ---------------------------------------------------------------------------

describe('syncLadders - the ladder re-syncs when the collection changes', () => {
  it('gives a lone verse the reference activities once the plan grows past the gate', async () => {
    // The reason applicability is derived on read rather than frozen into
    // rows. The card exists from day one, but the activity is not offered
    // until there is enough material in scope for it to be a real question -
    // and the day that becomes true, nothing has to be migrated. Nothing else
    // in the system would notice if this stopped happening; the activity
    // would just quietly never appear.
    const { store, collectionId } = await freshStore();
    const { passage: first } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    // The card is there immediately...
    expect(rungsOf(await store.listCards(first.id))).toContain('refmatch');

    const small = await store.listPassages(collectionId);
    const smallScope = small.reduce((n, p) => n + p.verseCount, 0);
    expect(smallScope).toBeLessThan(MIN_VERSES_FOR_REFERENCE_ACTIVITIES);
    expect(applicableRungs(first.verseCount, small.length, smallScope)).not.toContain('refmatch');

    // ...and one big passage later, the same rows mean something different.
    await store.addPassage(
      passageInput(collectionId, 19119001, MIN_VERSES_FOR_REFERENCE_ACTIVITIES, 'Psalm 119:1-25'),
    );
    const grown = await store.listPassages(collectionId);
    const grownScope = grown.reduce((n, p) => n + p.verseCount, 0);
    expect(applicableRungs(first.verseCount, grown.length, grownScope)).toContain('refmatch');
    expect(applicableRungs(first.verseCount, grown.length, grownScope)).toContain('refprovide');

    // No new cards were created to make that happen - the rows were already
    // there, and only the read-time answer changed.
    expect(rungsOf(await store.listCards(first.id))).toEqual([
      'blanks',
      'firstletters',
      'recite',
      'refmatch',
      'refprovide',
    ]);
  });

  it('creates a newly-applicable rung ready to practise, whether or not the passage has already been worked', async () => {
    // Nothing is locked any more, so there is no distinction left between "a
    // passage that has never been practised" and one that has: a rung that
    // just became applicable always starts at `dueAt: null`, full stop. This
    // replaces v0's two-sided test of that special case, which no longer
    // exists.
    const { store, collectionId } = await freshStore();
    const { passage: untouched } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const { passage: practised } = await store.addPassage(
      passageInput(collectionId, 45008028, 1, 'Romans 8:28'),
    );

    // Practise `practised`'s own blanks card for real before it gains
    // `refmatch` - this is the scenario where v0 would have kept a new rung
    // locked.
    const blanks = await store.getCard(practised.id, 'blanks');
    const result = schedule({
      intervalStep: blanks!.intervalStep,
      streak: blanks!.streak,
      score: 1,
      now: NOW,
      rng: makeRng(1),
    });
    await store.applySchedule(blanks!.id, result, 1);

    // A third passage gives BOTH existing passages a `refmatch` rung for the
    // first time.
    await store.addPassage(passageInput(collectionId, 45008030, 1, 'Romans 8:30'));

    const untouchedRefmatch = await store.getCard(untouched.id, 'refmatch');
    const practisedRefmatch = await store.getCard(practised.id, 'refmatch');
    expect(untouchedRefmatch).toMatchObject({ dueAt: null, intervalStep: -1 });
    expect(practisedRefmatch).toMatchObject({ dueAt: null, intervalStep: -1 });
  });

  it('does NOT delete a rung that has stopped applying', async () => {
    // Removing the second passage makes `refmatch` meaningless again - but
    // the user's attempts at it were real work on real material, and attempt
    // rows are never pruned. The row stays and is reported as inapplicable;
    // it simply stops being scheduled. A `syncLadders` that reconciled in
    // both directions would silently delete history every time a plan shrank.
    const { store, collectionId, harness } = await freshStore();
    const { passage: first } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const { passage: second } = await store.addPassage(
      passageInput(collectionId, 45008028, 1, 'Romans 8:28'),
    );

    const refmatch = await store.getCard(first.id, 'refmatch');
    expect(refmatch).toBeDefined();
    await store.recordAttempt({
      cardId: refmatch!.id,
      at: NOW,
      score: 1,
      correctFirst: 1,
      totalSteps: 1,
      durationMs: 4000,
    });

    await store.removePassage(second.id, NOW);

    const survivor = await store.getCard(first.id, 'refmatch');
    expect(survivor).toBeDefined();
    expect(survivor!.id).toBe(refmatch!.id);

    const attempts = await harness.query<{ id: number }>(
      `SELECT id FROM memory_attempt WHERE card_id = ?`,
      [refmatch!.id],
    );
    expect(attempts).toHaveLength(1);
  });

  it('does not duplicate rows when run repeatedly', async () => {
    // `syncLadders` runs on every add and every remove, so it runs many times
    // over a plan's life. The `card_passage_rung_unique` index would throw on
    // a duplicate insert rather than corrupting anything, but that throw
    // would reach the panel as an opaque failure on an ordinary "add
    // passage", so the guard is asserted rather than relied on.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    await store.syncLadders(collectionId);
    await store.syncLadders(collectionId);
    expect(await store.listCards(passage.id)).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

describe('removePassage', () => {
  it('soft-deletes: row, cards and attempts survive but are hidden from normal reads', async () => {
    // Soft delete (migration v5): the row, its cards and attempts stay and
    // only `deleted_at` hides it, so re-adding the reference restores progress.
    const { store, collectionId, harness } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    const cards = await store.listCards(passage.id);
    for (const card of cards) {
      await store.recordAttempt({
        cardId: card.id,
        at: NOW,
        score: 0.9,
        correctFirst: 9,
        totalSteps: 10,
        durationMs: 12000,
      });
    }
    expect(await harness.query(`SELECT id FROM memory_attempt`)).toHaveLength(cards.length);

    await store.removePassage(passage.id, NOW);

    expect(await store.getPassage(passage.id)).toBeUndefined();
    expect(await harness.query(`SELECT id FROM memory_card WHERE passage_id = ?`, [passage.id])).toHaveLength(cards.length);
    // Soft delete keeps the attempt history too, so re-adding restores it.
    expect(await harness.query(`SELECT id FROM memory_attempt`)).toHaveLength(cards.length);
  });

  it('leaves other passages and their history untouched', async () => {
    const { store, collectionId, harness } = await freshStore();
    const { passage: keep } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const { passage: drop } = await store.addPassage(
      passageInput(collectionId, 45008028, 1, 'Romans 8:28'),
    );
    const keepCard = await store.getCard(keep.id, 'blanks');
    await store.recordAttempt({
      cardId: keepCard!.id,
      at: NOW,
      score: 1,
      correctFirst: 3,
      totalSteps: 3,
      durationMs: null,
    });

    await store.removePassage(drop.id, NOW);

    expect(await store.getPassage(keep.id)).toBeDefined();
    expect(
      await harness.query(`SELECT id FROM memory_attempt WHERE card_id = ?`, [keepCard!.id]),
    ).toHaveLength(1);
  });

  it('is a no-op for a passage that is already gone', async () => {
    // Two panels open on the same plan can both send `removePassage` for the
    // same row. The second must not throw across the RPC boundary.
    const { store } = await freshStore();
    await expect(store.removePassage(4242, NOW)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Answer mode
// ---------------------------------------------------------------------------

describe('passage sort order', () => {
  it('defaults to bible order with no setting written', async () => {
    const { store } = await freshStore();
    expect(await store.getPassageSortOrder()).toBe('bible');
  });

  it('persists a changed sort order and round-trips back', async () => {
    const { store } = await freshStore();
    await store.setPassageSortOrder('need');
    expect(await store.getPassageSortOrder()).toBe('need');
    await store.setPassageSortOrder('bible');
    expect(await store.getPassageSortOrder()).toBe('bible');
  });

  it('treats an unrecognised stored value as bible order', async () => {
    const { store } = await freshStore();
    await store.setSetting('passageSortOrder', 'nonsense');
    expect(await store.getPassageSortOrder()).toBe('bible');
  });
});

describe('answer mode', () => {
  it('defaults to firstLetter with no setting written', async () => {
    const { store } = await freshStore();
    expect(await store.getDefaultAnswerMode()).toBe('firstLetter');
  });

  it('persists a changed global default', async () => {
    const { store } = await freshStore();
    await store.setDefaultAnswerMode('fullWord');
    expect(await store.getDefaultAnswerMode()).toBe('fullWord');
  });

  it('lets a passage override the global default, and clear the override', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    expect(passage.answerMode).toBeNull();

    await store.setPassageAnswerMode(passage.id, 'fullWord');
    expect((await store.getPassage(passage.id))!.answerMode).toBe('fullWord');

    await store.setPassageAnswerMode(passage.id, null);
    expect((await store.getPassage(passage.id))!.answerMode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resume state
// ---------------------------------------------------------------------------

describe('resume state', () => {
  it('is absent until a session saves one', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    const card = await store.getCard(passage.id, 'blanks');
    expect(await store.getResume(card!.id)).toBeUndefined();
  });

  it('is written, overwritten and cleared by card id', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    const card = await store.getCard(passage.id, 'blanks');

    await store.saveResume(card!.id, { cursor: 1, correctFirst: 1, gradedUnits: 1 }, NOW);
    expect(await store.getResume(card!.id)).toMatchObject({ cursor: 1, correctFirst: 1, gradedUnits: 1 });

    // A later verse overwrites the row rather than accumulating a second one -
    // one row per card is the whole contract `resume_state`'s primary key
    // enforces.
    await store.saveResume(card!.id, { cursor: 2, correctFirst: 2, gradedUnits: 2 }, NOW + 1000);
    const updated = await store.getResume(card!.id);
    expect(updated?.cursor).toBe(2);

    await store.clearResume(card!.id);
    expect(await store.getResume(card!.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tiers and derived progress
// ---------------------------------------------------------------------------

describe('listTierProgress', () => {
  it('returns nothing for an empty id list without touching the database', async () => {
    // `IN ()` is a syntax error in SQLite, so the empty case has to be caught
    // before the statement is built. A plan with no passages is the state of
    // every install on day one, and `buildPlanView` calls this unconditionally.
    const { store } = await freshStore();
    expect(await store.listTierProgress([])).toEqual([]);
  });

  it('aggregates best score, attempt count and recency per (card, tier)', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');

    await store.recordAttempt({ cardId: blanks!.id, at: NOW, score: 0.4, correctFirst: 4, totalSteps: 10, durationMs: 1000, tier: 0 });
    await store.recordAttempt({ cardId: blanks!.id, at: NOW + 1000, score: 0.9, correctFirst: 9, totalSteps: 10, durationMs: 1000, tier: 0 });
    await store.recordAttempt({ cardId: blanks!.id, at: NOW + 2000, score: 0.5, correctFirst: 5, totalSteps: 10, durationMs: 1000, tier: 1 });

    const rows = await store.listTierProgress([passage.id]);
    const forCard = rows.filter((r) => r.cardId === blanks!.id);
    expect(forCard).toHaveLength(2);
    expect(forCard[0]).toEqual({
      cardId: blanks!.id,
      tier: 0,
      bestScore: 0.9,
      attempts: 2,
      lastAt: NOW + 1000,
    });
    expect(forCard[1]).toMatchObject({ tier: 1, bestScore: 0.5, attempts: 1 });
  });

  it('spans several passages in one query', async () => {
    // The plan screen needs the level of every card in the plan to draw one
    // list, so this is read once per plan view rather than once per card.
    const { store, collectionId } = await freshStore();
    const { passage: a } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    const { passage: b } = await store.addPassage(passageInput(collectionId, 45008028, 1, 'Romans 8:28'));
    const aCard = await store.getCard(a.id, 'blanks');
    const bCard = await store.getCard(b.id, 'firstletters');
    await store.recordAttempt({ cardId: aCard!.id, at: NOW, score: 1, correctFirst: 1, totalSteps: 1, durationMs: null, tier: 0 });
    await store.recordAttempt({ cardId: bCard!.id, at: NOW, score: 1, correctFirst: 1, totalSteps: 1, durationMs: null, tier: 0 });

    const rows = await store.listTierProgress([a.id, b.id]);
    expect(rows.map((r) => r.cardId).sort()).toEqual([aCard!.id, bCard!.id].sort());
  });

  it('excludes attempts at or before a progress reset, strictly', async () => {
    // The boundary, as a real test rather than as an intention. A reset and a
    // session finishing can land in the same millisecond - the panel sends
    // "reset" while the worker is still closing an open session - and the
    // attempt in that tie belongs to the run being discarded. `>=` here would
    // let the last attempt of the old run survive its own reset and keep the
    // level it earned.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');
    const attempt = (at: number, score: number) =>
      store.recordAttempt({ cardId: blanks!.id, at, score, correctFirst: 1, totalSteps: 1, durationMs: null, tier: 0 });

    await attempt(NOW - 1, 1); // before the reset
    await attempt(NOW, 1); // EXACTLY at it
    await attempt(NOW + 1, 0.25); // after it

    await store.resetPassageProgress(passage.id, NOW);

    const rows = await store.listTierProgress([passage.id]);
    const forCard = rows.filter((r) => r.cardId === blanks!.id);
    expect(forCard).toHaveLength(1);
    // Only the single post-reset attempt survives - so one attempt, and a
    // best of 0.25 rather than the 1.0 the two discarded ones scored.
    expect(forCard[0]).toMatchObject({ attempts: 1, bestScore: 0.25, lastAt: NOW + 1 });
  });

  it('keeps the discarded rows on disk - a reset hides history, it does not prune it', async () => {
    const { store, collectionId, harness } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');
    await store.recordAttempt({ cardId: blanks!.id, at: NOW - 1, score: 1, correctFirst: 1, totalSteps: 1, durationMs: null, tier: 0 });

    await store.resetPassageProgress(passage.id, NOW);

    expect(await store.listTierProgress([passage.id])).toEqual([]);
    expect(await harness.query(`SELECT id FROM memory_attempt WHERE card_id = ?`, [blanks!.id])).toHaveLength(1);
  });

  it('defaults an attempt with no tier to tier 0', async () => {
    // The same claim the v3 migration's `DEFAULT 0` makes: an attempt that
    // does not say which rendering it answered was the only rendering there
    // was. Asserted through the store rather than the schema because every
    // pre-v3 row reaches the new model through this path.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');
    await store.recordAttempt({ cardId: blanks!.id, at: NOW, score: 1, correctFirst: 1, totalSteps: 1, durationMs: null });

    const rows = await store.listTierProgress([passage.id]);
    expect(rows.filter((r) => r.cardId === blanks!.id)[0]?.tier).toBe(0);
  });
});

describe('derived level - non-regression', () => {
  it('reads a single perfect attempt at tier 0 of a two-tier activity as level 3', async () => {
    // The worked example from the resolved decision, end to end through real
    // SQL: completeness 1/2, accuracy 1.0, score 0.5, level 3. Half the
    // activity done perfectly is half the activity, and the middle of the
    // scale is where that belongs - not the top.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');
    await store.recordAttempt({ cardId: blanks!.id, at: NOW, score: 1, correctFirst: 10, totalSteps: 10, durationMs: 1000, tier: 0 });

    expect(await levelOf(store, passage.id, 'blanks')).toBe(3);
  });

  it('does not lower the level when a later attempt goes badly - but does move the due date closer', async () => {
    // Both halves matter. The level is what the user is told about their
    // memory of the passage and a bad day must not rewrite it; the interval
    // is what the software does about it, and it has to react or the whole
    // point of scheduling is lost.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');

    // A card a few passes into the ladder, so the interval has somewhere to
    // fall from - at the bottom rung a pass and a failure are both one day.
    await store.recordAttempt({ cardId: blanks!.id, at: NOW, score: 1, correctFirst: 10, totalSteps: 10, durationMs: 1000, tier: 0 });
    await store.applySchedule(blanks!.id, schedule({ intervalStep: 2, streak: 3, score: 1, now: NOW, rng: makeRng(7) }), 1);
    const good = await store.getCard(passage.id, 'blanks');
    const levelBefore = await levelOf(store, passage.id, 'blanks');

    // A bad session on the SAME tier a day later.
    await store.recordAttempt({ cardId: blanks!.id, at: NOW + DAY_MS, score: 0.2, correctFirst: 2, totalSteps: 10, durationMs: 1000, tier: 0 });
    await store.applySchedule(
      blanks!.id,
      schedule({ intervalStep: good!.intervalStep, streak: good!.streak, score: 0.2, now: NOW + DAY_MS, rng: makeRng(7) }),
      0.2,
    );
    const bad = await store.getCard(passage.id, 'blanks');

    expect(await levelOf(store, passage.id, 'blanks')).toBeGreaterThanOrEqual(levelBefore);
    // Measured from each attempt's own instant, so the comparison is about
    // the interval rather than about a day having passed.
    expect(bad!.dueAt! - (NOW + DAY_MS)).toBeLessThan(good!.dueAt! - NOW);
    expect(bad!.streak).toBe(0);
  });

  it('rises as the harder tier is passed', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');
    await store.recordAttempt({ cardId: blanks!.id, at: NOW, score: 1, correctFirst: 10, totalSteps: 10, durationMs: 1000, tier: 0 });
    expect(await levelOf(store, passage.id, 'blanks')).toBe(3);

    await store.recordAttempt({ cardId: blanks!.id, at: NOW + 1000, score: 1, correctFirst: 10, totalSteps: 10, durationMs: 1000, tier: 1 });
    expect(await levelOf(store, passage.id, 'blanks')).toBe(5);
  });
});

describe('resetPassageProgress', () => {
  it('returns every card of the passage to a fresh scheduling state', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    for (const card of await store.listCards(passage.id)) {
      await store.applySchedule(
        card.id,
        schedule({ intervalStep: 3, streak: 4, score: 1, now: NOW - DAY_MS, rng: makeRng(2) }),
        1,
      );
    }

    await store.resetPassageProgress(passage.id, NOW);

    for (const card of await store.listCards(passage.id)) {
      expect(card).toMatchObject({ intervalStep: -1, dueAt: null, streak: 0, lastScore: null });
    }
    // A card that kept a six-month interval while claiming no history would
    // be the worst of both.
    expect(await store.dueCount({ kind: 'all' }, NOW + 365 * DAY_MS)).toBe(0);
  });

  it('discards any paused activity along with the progress', async () => {
    // Resuming into the middle of a run the user has just declared over would
    // be the opposite of what "start again" means.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');
    await store.saveResume(blanks!.id, { cursor: 2, correctFirst: 5, gradedUnits: 6 }, NOW);

    await store.resetPassageProgress(passage.id, NOW);

    expect(await store.getResume(blanks!.id)).toBeUndefined();
  });

  it('leaves other passages alone', async () => {
    const { store, collectionId } = await freshStore();
    const { passage: reset } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    const { passage: keep } = await store.addPassage(passageInput(collectionId, 45008028, 1, 'Romans 8:28'));
    await masterActivity(store, keep.id, 'firstletters', 1);
    await masterActivity(store, reset.id, 'firstletters', 1);

    await store.resetPassageProgress(reset.id, NOW + DAY_MS);

    expect(await levelOf(store, reset.id, 'firstletters')).toBe(0);
    expect(await levelOf(store, keep.id, 'firstletters')).toBe(5);
  });

  it('is safe to run twice, and the second run still clears the schedule', async () => {
    // Two panels open on the same passage can both send it, and a user who
    // does not see anything change may well click it again. Neither may
    // throw, and the second must still leave the passage in the reset state -
    // even though there is no new history for it to discard.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    await masterActivity(store, passage.id, 'blanks', 1);

    await store.resetPassageProgress(passage.id, NOW + DAY_MS);
    const afterFirst = await store.listCards(passage.id);

    // Something is practised in between, so the second reset has real work.
    const blanks = await store.getCard(passage.id, 'blanks');
    await store.recordAttempt({ cardId: blanks!.id, at: NOW + 2 * DAY_MS, score: 1, correctFirst: 1, totalSteps: 1, durationMs: null, tier: 0 });
    await store.applySchedule(blanks!.id, schedule({ intervalStep: -1, streak: 0, score: 1, now: NOW + 2 * DAY_MS, rng: makeRng(1) }), 1);
    expect(await levelOf(store, passage.id, 'blanks')).toBe(3);

    await expect(store.resetPassageProgress(passage.id, NOW + 3 * DAY_MS)).resolves.toBeUndefined();

    expect(await levelOf(store, passage.id, 'blanks')).toBe(0);
    for (const card of await store.listCards(passage.id)) {
      expect(card).toMatchObject({ intervalStep: -1, dueAt: null, streak: 0, lastScore: null });
    }
    expect(afterFirst).toHaveLength((await store.listCards(passage.id)).length);
  });

  it('is the only thing that lowers a level, and it lowers it all the way', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    await masterActivity(store, passage.id, 'firstletters', 1);
    expect(await levelOf(store, passage.id, 'firstletters')).toBe(5);
    expect((await store.analytics({ kind: 'list', id: collectionId }, NOW)).passagesWellLearned).toBe(1);

    await store.resetPassageProgress(passage.id, NOW + DAY_MS);

    expect(await levelOf(store, passage.id, 'firstletters')).toBe(0);
    expect((await store.analytics({ kind: 'list', id: collectionId }, NOW)).passagesWellLearned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Due queries
// ---------------------------------------------------------------------------

describe('dueCount and nextDueCard', () => {
  it('never counts a card until it has been attempted, because its due date starts NULL', async () => {
    const { store, collectionId, harness } = await freshStore();
    await store.addPassage(passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'));

    const all = await harness.query<{ n: number }>(`SELECT COUNT(*) AS n FROM memory_card`);
    expect(all[0]!.n).toBe(6);
    expect(await store.dueCount({ kind: 'all' }, NOW)).toBe(0);
  });

  it('does not count a card whose due date is still in the future', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    const card = await store.getCard(passage.id, 'ordering');
    const result = schedule({
      intervalStep: -1,
      streak: 0,
      score: 1,
      now: NOW,
      rng: makeRng(3),
    });
    await store.applySchedule(card!.id, result, 1);

    expect(await store.dueCount({ kind: 'all' }, NOW)).toBe(0);
    // One day out plus jitter; well inside two days at the lowest rung.
    expect(await store.dueCount({ kind: 'all' }, NOW + 2 * DAY_MS)).toBe(1);
    expect(await store.nextDueCard({ kind: 'all' }, NOW)).toBeUndefined();
  });

  it('works a passage bottom-up rather than in row order', async () => {
    // The scenario is constructed so that row order and ladder order
    // disagree: the `refmatch` card is recreated so that it holds a HIGHER
    // row id than `blanks` while sitting LOWER on the ladder. (That happens
    // naturally whenever a card row is rebuilt - and happened on every plan
    // under v1, where `refmatch` was inserted only once a sibling existed.)
    // Both are scheduled due at the same instant. Ordering by id would ask
    // for the missing words before asking which reference this even is, which
    // is backwards - hence the CASE expression this test exists to protect.
    const { store, collectionId, harness } = await freshStore();
    const { passage: first } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    await store.addPassage(passageInput(collectionId, 45008028, 1, 'Romans 8:28'));

    const original = await store.getCard(first.id, 'refmatch');
    await harness.run(`DELETE FROM memory_card WHERE id = ?`, [original!.id]);
    await harness.run(
      `INSERT INTO memory_card (passage_id, rung, state, interval_step, due_at, streak, last_score)
       VALUES (?, 'refmatch', 'new', -1, NULL, 0, NULL)`,
      [first.id],
    );

    const blanks = await store.getCard(first.id, 'blanks');
    const refmatch = await store.getCard(first.id, 'refmatch');
    expect(refmatch!.id).toBeGreaterThan(blanks!.id);

    await store.applySchedule(blanks!.id, schedule({ intervalStep: -1, streak: 0, score: 1, now: NOW, rng: makeRng(1) }), 1);
    await store.applySchedule(refmatch!.id, schedule({ intervalStep: -1, streak: 0, score: 1, now: NOW, rng: makeRng(1) }), 1);
    const blanksAfter = await store.getCard(first.id, 'blanks');
    const refmatchAfter = await store.getCard(first.id, 'refmatch');
    expect(blanksAfter!.dueAt).toBe(refmatchAfter!.dueAt);

    const next = await store.nextDueCard({ kind: 'all' }, blanksAfter!.dueAt!);
    expect(next?.card.rung).toBe('refmatch');
    expect(next?.card.id).toBe(refmatch!.id);
    // And the passage travels with the card, so the caller never has to look
    // it up separately and risk a null it did not expect.
    expect(next?.passage.id).toBe(first.id);
  });

  it('prefers the earliest due date across passages', async () => {
    // Due date dominates rung position: an overdue `firstletters` on one
    // passage comes before a just-due `ordering` on another. Otherwise the
    // rung ordering would silently become a passage priority.
    const { store, collectionId, harness } = await freshStore();
    const { passage: a } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    const { passage: b } = await store.addPassage(
      passageInput(collectionId, 45008028, 2, 'Romans 8:28-29'),
    );

    const aFirstLetters = await store.getCard(a.id, 'firstletters');
    await harness.run(`UPDATE memory_card SET due_at = ? WHERE id = ?`, [NOW - DAY_MS, aFirstLetters!.id]);

    const next = await store.nextDueCard({ kind: 'all' }, NOW);
    expect(next?.card.id).toBe(aFirstLetters!.id);
    expect(next?.passage.id).toBe(a.id);
    expect(b.id).not.toBe(a.id);
  });

  it('counts every due card across the whole plan', async () => {
    const { store, collectionId, harness } = await freshStore();
    const { passage: a } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    const { passage: b } = await store.addPassage(passageInput(collectionId, 45008028, 1, 'Romans 8:28'));

    // Three cards, across both passages, made due by hand.
    const aBlanks = await store.getCard(a.id, 'blanks');
    const aRefmatch = await store.getCard(a.id, 'refmatch');
    const bRefmatch = await store.getCard(b.id, 'refmatch');
    await harness.run(`UPDATE memory_card SET due_at = ? WHERE id IN (?, ?, ?)`, [
      NOW,
      aBlanks!.id,
      aRefmatch!.id,
      bRefmatch!.id,
    ]);

    expect(await store.dueCount({ kind: 'all' }, NOW)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe('analytics', () => {
  it('reports zeros and empties on a plan with no attempts', async () => {
    const { store, collectionId } = await freshStore();
    await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    const view = await store.analytics({ kind: 'list', id: collectionId }, NOW);
    expect(view.streakDays).toBe(0);
    expect(view.versesLearned).toBe(0);
    expect(view.passagesWellLearned).toBe(0);
    expect(view.recentlyReached).toEqual([]);
    expect(view.calendar).toHaveLength(35);
  });

  it('counts a passage as well learned, and its verses, once the HARDEST activity is mastered', async () => {
    // "Harder carries down", now as the whole rule rather than as a headline:
    // mastering `firstletters` satisfies `blanks` and `ordering` too, because
    // reciting a passage from first letters demonstrates both as a
    // by-product. Every applicable activity is therefore satisfied, and the
    // passage counts.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    await masterActivity(store, passage.id, 'firstletters', 0.95);

    const view = await store.analytics({ kind: 'list', id: collectionId }, NOW);
    expect(view.passagesWellLearned).toBe(1);
    expect(view.versesLearned).toBe(3);
  });

  it('does NOT count a passage whose only mastered activity is the easiest one', async () => {
    // The direction that matters, and the case the old `max(level) >= 4` rule
    // got wrong. Putting verses in order says nothing about recalling their
    // words, so a mastered `ordering` leaves `blanks` and `firstletters` as
    // untested as they were - and the passage is not learned.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    await masterActivity(store, passage.id, 'ordering', 1);

    const view = await store.analytics({ kind: 'list', id: collectionId }, NOW);
    expect(view.passagesWellLearned).toBe(0);
    expect(view.versesLearned).toBe(0);
  });

  it('does not count a passage whose best activity is still below level 4', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');
    await store.recordAttempt({
      cardId: blanks!.id,
      at: NOW,
      score: 0.6,
      correctFirst: 6,
      totalSteps: 10,
      durationMs: 1000,
      tier: 0,
    });

    const view = await store.analytics({ kind: 'list', id: collectionId }, NOW);
    expect(view.passagesWellLearned).toBe(0);
    expect(view.versesLearned).toBe(0);
  });

  it('counts a run of consecutive days ending today as the streak', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');
    await store.recordAttempt({ cardId: blanks!.id, at: NOW, score: 1, correctFirst: 1, totalSteps: 1, durationMs: 1000 });
    await store.recordAttempt({ cardId: blanks!.id, at: NOW - DAY_MS, score: 1, correctFirst: 1, totalSteps: 1, durationMs: 1000 });
    await store.recordAttempt({ cardId: blanks!.id, at: NOW - 2 * DAY_MS, score: 1, correctFirst: 1, totalSteps: 1, durationMs: 1000 });
    // A gap: no attempt three days ago breaks the streak there.
    await store.recordAttempt({ cardId: blanks!.id, at: NOW - 4 * DAY_MS, score: 1, correctFirst: 1, totalSteps: 1, durationMs: 1000 });

    const view = await store.analytics({ kind: 'list', id: collectionId }, NOW);
    expect(view.streakDays).toBe(3);
  });

  it('records the first pass of each tier, and only the first', async () => {
    // The milestone event changed with the model: a tier passing 0.8 for the
    // first time, rather than an attempt reaching level 4. Under a
    // completeness-weighted level, a single strong attempt on the easy tier
    // of a two-tier activity is level 3 and cannot reach 4 on its own, so the
    // old event would have quietly stopped firing for most activities.
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');
    const attempt = (at: number, score: number, tier: number) =>
      store.recordAttempt({ cardId: blanks!.id, at, score, correctFirst: 19, totalSteps: 20, durationMs: 1000, tier });

    await attempt(NOW - 3 * DAY_MS, 0.5, 0); // below the bar: not a milestone
    await attempt(NOW - 2 * DAY_MS, 0.95, 0); // first pass of tier 0
    await attempt(NOW - DAY_MS, 1, 0); // same ground, no second milestone
    await attempt(NOW, 0.9, 1); // first pass of tier 1

    const view = await store.analytics({ kind: 'list', id: collectionId }, NOW);
    expect(view.recentlyReached).toHaveLength(2);
    // Newest first.
    expect(view.recentlyReached[0]).toMatchObject({
      passageId: passage.id,
      reference: 'John 3:16',
      rung: 'blanks',
      at: NOW,
    });
    expect(view.recentlyReached[1]).toMatchObject({ rung: 'blanks', at: NOW - 2 * DAY_MS });

    // The level recorded is the one the activity stood at when it passed, not
    // the one it has today - half the tiers at 0.95 is level 3, and it stays
    // 3 in the history even after the second tier took the activity to 5.
    expect(view.recentlyReached[1]?.level).toBe(3);
    expect(view.recentlyReached[0]?.level).toBe(5);
  });

  it('reports the next round-five milestone and how far off it is', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    await masterActivity(store, passage.id, 'firstletters', 1);

    const view = await store.analytics({ kind: 'list', id: collectionId }, NOW);
    expect(view.versesLearned).toBe(3);
    expect(view.nextMilestone).toEqual({ versesLearned: 5, toGo: 2 });
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('persistence across a restart', () => {
  it('reads every field back identically through a fresh store on the same database', async () => {
    // This is the assertion a fake database cannot make. Everything above
    // could pass against an in-memory object graph that never serialised
    // anything; only a real round trip catches a REAL column that comes back
    // as a string, a boolean written as `true` into an INTEGER column, or a
    // null that becomes a zero. `last_score` in particular is a float, and
    // `due_at` a nullable integer - both are exactly the shapes that survive
    // a fake and change under SQLite.
    const { harness, store, collectionId } = await freshStore();

    const { passage } = await store.addPassage(
      passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'),
    );
    const ordering = await store.getCard(passage.id, 'ordering');
    const result = schedule({
      intervalStep: 2,
      streak: 1,
      score: 0.875,
      now: NOW,
      rng: makeRng(5),
    });
    await store.applySchedule(ordering!.id, result, 0.875);
    await store.recordAttempt({
      cardId: ordering!.id,
      at: NOW,
      score: 0.875,
      correctFirst: 7,
      totalSteps: 8,
      durationMs: 45000,
    });
    await store.recordAttempt({
      cardId: ordering!.id,
      at: NOW + 1,
      score: 0.25,
      correctFirst: 2,
      totalSteps: 8,
      durationMs: null,
    });

    const before = {
      passages: await store.listPassages(collectionId),
      cards: await store.listCards(passage.id),
      due: await store.dueCount({ kind: 'all' }, NOW + 30 * DAY_MS),
      analytics: await store.analytics({ kind: 'list', id: collectionId }, NOW),
      attemptRows: await harness.query(`SELECT * FROM memory_attempt WHERE card_id = ? ORDER BY id`, [ordering!.id]),
    };

    // A fresh wrapper and a fresh store over the SAME database file - the
    // worker restarting, with nothing carried over in memory.
    const reopened = harness;
    const restarted = new MemoryStore(reopened);

    expect(await restarted.listPassages(collectionId)).toEqual(before.passages);
    expect(await restarted.listCards(passage.id)).toEqual(before.cards);
    expect(await restarted.dueCount({ kind: 'all' }, NOW + 30 * DAY_MS)).toBe(before.due);
    expect(await restarted.analytics({ kind: 'list', id: collectionId }, NOW)).toEqual(before.analytics);
    expect(
      await reopened.query(`SELECT * FROM memory_attempt WHERE card_id = ? ORDER BY id`, [ordering!.id]),
    ).toEqual(before.attemptRows);

    // Spot-check the types themselves, not just equality with a value that
    // could have been wrong in the same way on both sides of the restart.
    const card = await restarted.getCard(passage.id, 'ordering');
    expect(typeof card!.dueAt).toBe('number');
    expect(typeof card!.lastScore).toBe('number');
    expect(card!.lastScore).toBeCloseTo(0.875, 10);
    expect(card!.intervalStep).toBe(result.intervalStep);
    expect(card!.streak).toBe(result.streak);
  });

  it('keeps an unattempted card\'s null due date null across a restart', async () => {
    // A null that came back as 0 would make every untouched rung in the plan
    // due at the epoch, i.e. due now, on the first restart after the user
    // added anything. That is a silent, total collapse of the schedule and it
    // is only observable through a real column.
    const { harness, store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );

    const restarted = new MemoryStore(harness);
    const untouched = await restarted.getCard(passage.id, 'firstletters');
    expect(untouched!.dueAt).toBeNull();
    expect(untouched!.lastScore).toBeNull();
    // Nothing was ever scheduled, so nothing is ever due - not even a year on.
    expect(await restarted.dueCount({ kind: 'all' }, NOW + 365 * DAY_MS)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T5: multiple lists and scope
// ---------------------------------------------------------------------------

describe('lists (collections)', () => {
  it('sums VERSES, not passage rows, in listCollections', async () => {
    // The plan's own worked example: one three-verse passage must read as 3,
    // not 1, or the reference-activities scope gate would be counting the
    // wrong thing everywhere it is displayed.
    const { store, collectionId } = await freshStore();
    await store.addPassage(passageInput(collectionId, 19023001, 3, 'Psalm 23:1-3'));
    await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));

    const lists = await store.listCollections();
    const list = lists.find((l) => l.id === collectionId);
    expect(list).toMatchObject({ passageCount: 2, verseCount: 4 });
  });

  it('creates and renames a list', async () => {
    const { store } = await freshStore();
    const created = await store.createCollection('Memory verses', NOW);
    expect(created.name).toBe('Memory verses');

    await store.renameCollection(created.id, 'Topical list');
    const lists = await store.listCollections();
    expect(lists.find((l) => l.id === created.id)?.name).toBe('Topical list');
  });

  it('refuses to delete the only list, with a readable error', async () => {
    const { store, collectionId } = await freshStore();
    await expect(store.deleteCollection(collectionId, collectionId)).rejects.toThrow(
      /only list/i,
    );
  });

  it('moves passages, cards AND attempt history to the target when a list with passages is deleted', async () => {
    const { store, collectionId } = await freshStore();
    const second = await store.createCollection('Second list', NOW);
    const { passage } = await store.addPassage(
      passageInput(second.id, 43003016, 1, 'John 3:16'),
    );
    const blanks = await store.getCard(passage.id, 'blanks');
    await store.recordAttempt({
      cardId: blanks!.id,
      at: NOW,
      score: 1,
      correctFirst: 1,
      totalSteps: 1,
      durationMs: 1000,
      tier: 0,
    });

    await store.deleteCollection(second.id, collectionId);

    const moved = await store.getPassage(passage.id);
    expect(moved?.collectionId).toBe(collectionId);
    // The card survived (same id - it was never touched, only its owning
    // passage's collection changed) and so did its attempt history.
    const rows = await store.listTierProgress([passage.id]);
    expect(rows.find((r) => r.cardId === blanks!.id)).toMatchObject({ bestScore: 1, attempts: 1 });
    // And the list itself is gone.
    const lists = await store.listCollections();
    expect(lists.find((l) => l.id === second.id)).toBeUndefined();
  });

  it('lets the same reference live in two lists as two independent passage rows', async () => {
    // Resolved decision D2(i): one list per passage. Adding "the same" verse
    // to a second list is not a link to the first - it is a second,
    // independent row with its own progress.
    const { store, collectionId } = await freshStore();
    const second = await store.createCollection('Second list', NOW);

    const { passage: a, created: aCreated } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const { passage: b, created: bCreated } = await store.addPassage(
      passageInput(second.id, 43003016, 1, 'John 3:16'),
    );

    expect(aCreated).toBe(true);
    expect(bCreated).toBe(true);
    expect(a.id).not.toBe(b.id);

    await masterActivity(store, a.id, 'blanks', 1);
    expect(await levelOf(store, a.id, 'blanks')).toBe(5);
    // The second list's identical passage has its own, untouched history.
    expect(await levelOf(store, b.id, 'blanks')).toBe(0);
  });

  describe('movePassage', () => {
    it('reassigns a passage to another list', async () => {
      const { store, collectionId } = await freshStore();
      const second = await store.createCollection('Second list', NOW);
      const { passage } = await store.addPassage(
        passageInput(collectionId, 43003016, 1, 'John 3:16'),
      );

      const { passage: moved, moved: didMove } = await store.movePassage(passage.id, second.id);
      expect(didMove).toBe(true);
      expect(moved.collectionId).toBe(second.id);
    });

    it('mirrors addPassage: a collision with an existing row in the target returns it rather than throwing', async () => {
      const { store, collectionId } = await freshStore();
      const second = await store.createCollection('Second list', NOW);
      const { passage: source } = await store.addPassage(
        passageInput(collectionId, 43003016, 1, 'John 3:16'),
      );
      const { passage: target } = await store.addPassage(
        passageInput(second.id, 43003016, 1, 'John 3:16'),
      );

      const { passage: result, moved } = await store.movePassage(source.id, second.id);
      expect(moved).toBe(false);
      expect(result.id).toBe(target.id);
      // The source passage is untouched - still in its original list.
      expect((await store.getPassage(source.id))?.collectionId).toBe(collectionId);
    });
  });
});

describe('scope', () => {
  it('defaults to all, and round-trips a chosen list', async () => {
    const { store, collectionId } = await freshStore();
    expect(await store.getScope()).toEqual({ kind: 'all' });

    await store.setScope({ kind: 'list', id: collectionId });
    expect(await store.getScope()).toEqual({ kind: 'list', id: collectionId });

    await store.setScope({ kind: 'all' });
    expect(await store.getScope()).toEqual({ kind: 'all' });
  });

  it('falls back to all when the scoped list has been deleted', async () => {
    const { store, collectionId } = await freshStore();
    const second = await store.createCollection('Second list', NOW);
    await store.setScope({ kind: 'list', id: second.id });
    expect(await store.getScope()).toEqual({ kind: 'list', id: second.id });

    // Simulated as if another panel deleted it out from under this one.
    await store.deleteCollection(second.id, collectionId);

    expect(await store.getScope()).toEqual({ kind: 'all' });
  });

  it('filters dueCount and nextDueCard to one list', async () => {
    const { store, collectionId, harness } = await freshStore();
    const second = await store.createCollection('Second list', NOW);
    const { passage: inFirst } = await store.addPassage(
      passageInput(collectionId, 43003016, 1, 'John 3:16'),
    );
    const { passage: inSecond } = await store.addPassage(
      passageInput(second.id, 45008028, 1, 'Romans 8:28'),
    );

    const firstBlanks = await store.getCard(inFirst.id, 'blanks');
    const secondBlanks = await store.getCard(inSecond.id, 'blanks');
    await harness.run(`UPDATE memory_card SET due_at = ? WHERE id IN (?, ?)`, [
      NOW,
      firstBlanks!.id,
      secondBlanks!.id,
    ]);

    expect(await store.dueCount({ kind: 'list', id: collectionId }, NOW)).toBe(1);
    expect(await store.dueCount({ kind: 'list', id: second.id }, NOW)).toBe(1);
    expect(await store.dueCount({ kind: 'all' }, NOW)).toBe(2);

    const nextInFirst = await store.nextDueCard({ kind: 'list', id: collectionId }, NOW);
    expect(nextInFirst?.passage.id).toBe(inFirst.id);
    const nextInSecond = await store.nextDueCard({ kind: 'list', id: second.id }, NOW);
    expect(nextInSecond?.passage.id).toBe(inSecond.id);
  });

  it('filters listPassagesInScope to one list, and to everything for all', async () => {
    const { store, collectionId } = await freshStore();
    const second = await store.createCollection('Second list', NOW);
    await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    await store.addPassage(passageInput(second.id, 45008028, 1, 'Romans 8:28'));

    expect(await store.listPassagesInScope({ kind: 'list', id: collectionId })).toHaveLength(1);
    expect(await store.listPassagesInScope({ kind: 'list', id: second.id })).toHaveLength(1);
    expect(await store.listPassagesInScope({ kind: 'all' })).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Soft delete (migration v5)
// ---------------------------------------------------------------------------

describe('soft delete', () => {
  const scopeAll = { kind: 'all' } as const;

  async function practise(store: MemoryStore, passageId: number, rung: Rung, at: number) {
    const card = await store.getCard(passageId, rung);
    await store.applySchedule(
      card!.id,
      schedule({ intervalStep: card!.intervalStep, streak: card!.streak, score: 0.9, now: at, rng: makeRng(1) }),
      0.9,
    );
    await store.recordAttempt({
      cardId: card!.id,
      at,
      score: 0.9,
      correctFirst: 1,
      totalSteps: 1,
      durationMs: 1000,
    });
    return card!;
  }

  it('hides a removed passage from every read, list count and due query', async () => {
    const { store, collectionId } = await freshStore();
    const { passage: gone } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    const { passage: kept } = await store.addPassage(passageInput(collectionId, 45008028, 1, 'Romans 8:28'));
    await practise(store, gone.id, 'blanks', NOW);
    await practise(store, kept.id, 'blanks', NOW + 1000);
    const later = NOW + 30 * DAY_MS;
    expect(await store.dueCount(scopeAll, later)).toBeGreaterThan(0);

    await store.removePassage(gone.id, NOW);

    expect(await store.getPassage(gone.id)).toBeUndefined();
    expect((await store.listPassages(collectionId)).map((p) => p.id)).toEqual([kept.id]);
    expect((await store.listPassagesInScope(scopeAll)).map((p) => p.id)).toEqual([kept.id]);
    expect((await store.listPassagesInScope({ kind: 'list', id: collectionId })).map((p) => p.id)).toEqual([kept.id]);
    const list = (await store.listCollections()).find((l) => l.id === collectionId);
    expect(list).toMatchObject({ passageCount: 1, verseCount: 1 });
    // Only the survivor's due cards count, in both scope shapes.
    const keptDue = (await store.listCards(kept.id)).filter((c) => c.dueAt !== null && c.dueAt <= later).length;
    expect(await store.dueCount(scopeAll, later)).toBe(keptDue);
    expect(await store.dueCount({ kind: 'list', id: collectionId }, later)).toBe(keptDue);
    // The soft-deleted card is due earlier; it must not be the "next" one.
    expect((await store.nextDueCard(scopeAll, later))?.passage.id).toBe(kept.id);
    expect((await store.nextDueCard({ kind: 'list', id: collectionId }, later))?.passage.id).toBe(kept.id);
  });

  it('keeps an empty list visible in listCollections when its only passage is removed', async () => {
    const { store, collectionId } = await freshStore();
    const { passage } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    await store.removePassage(passage.id, NOW);
    expect(await store.listCollections()).toEqual([
      { id: collectionId, name: 'My plan', passageCount: 0, verseCount: 0 },
    ]);
  });

  it('revives with the same row, cards and attempts, reporting revived not created', async () => {
    const { store, collectionId, harness } = await freshStore();
    const other = await store.createCollection('List B', NOW);
    const { passage } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    const card = await practise(store, passage.id, 'blanks', NOW);
    await store.removePassage(passage.id, NOW + 1);

    const res = await store.addPassage(passageInput(other.id, 43003016, 1, 'John 3:16'));

    expect(res).toMatchObject({ created: false, revived: true });
    expect(res.passage.id).toBe(passage.id);
    expect(res.passage.collectionId).toBe(other.id);
    expect((await store.getCard(passage.id, 'blanks'))!.id).toBe(card.id);
    expect(await harness.query(`SELECT id FROM memory_attempt WHERE card_id = ?`, [card.id])).toHaveLength(1);
    expect(await store.listPassages(other.id)).toHaveLength(1);
  });

  it('revive prefers a soft-deleted twin in the target list', async () => {
    const { store, collectionId } = await freshStore();
    const other = await store.createCollection('List B', NOW);
    const { passage: inOther } = await store.addPassage(passageInput(other.id, 43003016, 1, 'John 3:16'));
    const { passage: inMain } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    await store.removePassage(inMain.id, NOW);
    await store.removePassage(inOther.id, NOW + 5); // newer id order would otherwise win

    const res = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    expect(res.revived).toBe(true);
    expect(res.passage.id).toBe(inMain.id);
  });

  it('movePassage hard-deletes a soft-deleted twin in the target', async () => {
    const { store, collectionId, harness } = await freshStore();
    const other = await store.createCollection('List B', NOW);
    const { passage: src } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    const { passage: twin } = await store.addPassage(passageInput(other.id, 43003016, 1, 'John 3:16'));
    await store.removePassage(twin.id, NOW);

    const { moved } = await store.movePassage(src.id, other.id);

    expect(moved).toBe(true);
    expect((await store.getPassage(src.id))?.collectionId).toBe(other.id);
    expect(await harness.query(`SELECT id FROM memory_passage WHERE id = ?`, [twin.id])).toHaveLength(0);
  });

  it('deleteCollection handles soft-deleted collisions in either direction', async () => {
    const { store, collectionId, harness } = await freshStore();
    const other = await store.createCollection('List B', NOW);
    // Active in source, soft twin in target.
    const { passage: a } = await store.addPassage(passageInput(other.id, 43003016, 1, 'John 3:16'));
    const { passage: aTwin } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    await store.removePassage(aTwin.id, NOW);
    // Soft in source, active in target.
    const { passage: bSoft } = await store.addPassage(passageInput(other.id, 45008028, 1, 'Romans 8:28'));
    const { passage: bActive } = await store.addPassage(passageInput(collectionId, 45008028, 1, 'Romans 8:28'));
    await store.removePassage(bSoft.id, NOW);
    // Soft in both.
    const { passage: cSrc } = await store.addPassage(passageInput(other.id, 19023001, 1, 'Psalm 23:1'));
    const { passage: cDst } = await store.addPassage(passageInput(collectionId, 19023001, 1, 'Psalm 23:1'));
    await store.removePassage(cSrc.id, NOW);
    await store.removePassage(cDst.id, NOW);

    await store.deleteCollection(other.id, collectionId);

    expect((await store.listPassages(collectionId)).map((p) => p.id).sort()).toEqual([a.id, bActive.id].sort());
    expect(await harness.query(`SELECT id FROM memory_passage WHERE id IN (?, ?)`, [aTwin.id, bSoft.id])).toHaveLength(0);
    // Exactly one soft-deleted Psalm row remains; no unique violation occurred.
    expect(
      await harness.query(`SELECT id FROM memory_passage WHERE start_verse_id = 19023001`),
    ).toHaveLength(1);
  });

  it('listPracticeStats counts live passages and those with attempts, ignoring soft-deleted ones', async () => {
    const { store, collectionId } = await freshStore();
    const { passage: a } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    await store.addPassage(passageInput(collectionId, 45008028, 1, 'Romans 8:28'));
    const { passage: gone } = await store.addPassage(passageInput(collectionId, 19023001, 1, 'Psalm 23:1'));
    await practise(store, a.id, 'blanks', NOW);
    await practise(store, gone.id, 'blanks', NOW);
    await store.removePassage(gone.id, NOW);

    expect(await store.listPracticeStats(collectionId)).toEqual({ total: 2, practiced: 1 });
    const other = await store.createCollection('Empty', NOW);
    expect(await store.listPracticeStats(other.id)).toEqual({ total: 0, practiced: 0 });
  });

  it('deleteCollection still refuses an active-vs-active collision', async () => {
    const { store, collectionId } = await freshStore();
    const other = await store.createCollection('List B', NOW);
    await store.addPassage(passageInput(other.id, 43003016, 1, 'John 3:16'));
    await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    await expect(store.deleteCollection(other.id, collectionId)).rejects.toThrow();
  });

  it('purgeOldDeletedPassages removes only rows older than the cutoff, cascading history', async () => {
    const { store, collectionId, harness } = await freshStore();
    const { passage: old } = await store.addPassage(passageInput(collectionId, 43003016, 1, 'John 3:16'));
    const { passage: recent } = await store.addPassage(passageInput(collectionId, 45008028, 1, 'Romans 8:28'));
    const { passage: live } = await store.addPassage(passageInput(collectionId, 19023001, 1, 'Psalm 23:1'));
    await practise(store, old.id, 'blanks', NOW);
    await store.removePassage(old.id, NOW - 8 * DAY_MS);
    await store.removePassage(recent.id, NOW - 6 * DAY_MS);

    const purged = await store.purgeOldDeletedPassages(NOW, 7 * DAY_MS);

    expect(purged).toBe(1);
    expect(await harness.query(`SELECT id FROM memory_passage WHERE id = ?`, [old.id])).toHaveLength(0);
    expect(await harness.query(`SELECT id FROM memory_card WHERE passage_id = ?`, [old.id])).toHaveLength(0);
    expect(await harness.query(`SELECT id FROM memory_attempt`)).toHaveLength(0);
    expect(await harness.query(`SELECT id FROM memory_passage WHERE id = ?`, [recent.id])).toHaveLength(1);
    expect(await store.getPassage(live.id)).toBeDefined();
  });
});

describe('sqlPort failures', () => {
  it('marks database failures as MemoryStorageError and keeps the original error over a failing rollback', async () => {
    const { createSqlPort, MemoryStorageError } = await import('../src/core/sqlPort');
    const { TestSql } = await import('./helpers/sqlite');
    const { installMemorySchema } = await import('../src/core/schema');
    const host = new TestSql();
    installMemorySchema(host);
    const port = createSqlPort(host);
    await expect(port.query('SELECT * FROM no_such_table')).rejects.toBeInstanceOf(MemoryStorageError);
    const boom = new Error('original');
    await expect(
      port.transaction(async (tx) => {
        await tx.run("INSERT INTO memory_collection (name, created_at) VALUES ('x', 1)");
        host.execute('ROLLBACK'); // SQLite rolled back on its own
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await port.query('SELECT * FROM memory_collection')).toEqual([]);
    // The port still works afterwards.
    await port.transaction(async (tx) => tx.run("INSERT INTO memory_collection (name, created_at) VALUES ('y', 1)"));
    expect(await port.query('SELECT name FROM memory_collection')).toEqual([{ name: 'y' }]);
  });
});
