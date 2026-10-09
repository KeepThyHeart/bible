/**
 * The memory service: start-up, status, and the request methods that the
 * extension's `main.test.ts` drove over the panel channel (now direct calls).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMockApi } from '@bible/extension-testing';

import { MEMORY_API_METHODS } from '../src/core/api';
import type { MemoryApi } from '../src/core/api';
import type { MemorySql } from '../src/core/ports';
import { MemoryService } from '../src/core/service';
import type { PanelRequest, PassageView, PlanView, RungView } from '../src/core/types';
import { LEGACY_SOURCE_KEY } from '../src/core/legacyImport';
import { createFakeReminders } from './fakeReminders';
import { createMemoryTestDb } from './helpers/sqlite';
import { call, disposeAll, quietLog, startTestService } from './helpers/service';

afterEach(disposeAll);

describe('start', () => {
  it('completes against a mock host, with the default list in place', async () => {
    const { svc } = await startTestService();
    const plan = await svc.getPlan();
    expect(plan.lists.map((l) => l.name)).toEqual(['Default']);
    expect(plan.collectionName).toBe('Default');
  });

  it('completes when the host has a reminders API, and when it is broken', async () => {
    const fake = createFakeReminders();
    await expect(startTestService({ reminders: fake.api as never })).resolves.toBeDefined();
    const broken = createFakeReminders({ throwOnCapabilities: true });
    await expect(startTestService({ reminders: broken.api as never })).resolves.toBeDefined();
  });

  it('fails when storage is unusable (the caller handles it)', async () => {
    const sql = {
      queryOne: async () => {
        throw new Error('no storage');
      },
    } as unknown as MemorySql;
    const mockApi = createMockApi();
    await expect(
      MemoryService.start({ sql, host: { bible: mockApi.bible }, emit: () => undefined, log: quietLog }),
    ).rejects.toThrow(/no storage/);
  });

  it('implements every method of the API', async () => {
    const { svc } = await startTestService();
    for (const name of MEMORY_API_METHODS) {
      expect(typeof (svc as unknown as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('disposes without throwing, twice', async () => {
    const { svc } = await startTestService();
    expect(() => svc.dispose()).not.toThrow();
    expect(() => svc.dispose()).not.toThrow();
  });

  it('renames a lone legacy "My plan" list to Default', async () => {
    const db = createMemoryTestDb();
    await db.sql.run(`INSERT INTO memory_collection (name, created_at) VALUES ('My plan', 0)`);
    const { svc } = await startTestService({ db });
    expect((await svc.getPlan()).lists.map((l) => l.name)).toEqual(['Default']);
  });
});

describe('status', () => {
  it('emits the status on start and again only when it changes', async () => {
    const { svc, db, pushes } = await startTestService();
    const statuses = () => pushes.filter((p) => p.type === 'status');
    expect(statuses()).toEqual([{ type: 'status', status: { due: 0, waiting: 0 } }]);
    expect(pushes).toContainEqual({ type: 'dueCountChanged', count: 0 });

    // Nothing changed: removing a passage that is not there still refreshes, and repeats nothing.
    await svc.removePassage({ passageId: 999 });
    expect(statuses()).toHaveLength(1);

    // A due card changes it, once.
    await svc.addVerses({ verseIds: [43003016] });
    await db.sql.run(`UPDATE memory_card SET due_at = 1 WHERE rung = 'blanks'`);
    await svc.removePassage({ passageId: 999 });
    await svc.removePassage({ passageId: 999 });
    expect(statuses().pop()).toEqual({ type: 'status', status: { due: 1, waiting: 0 } });
    expect(pushes.filter((p) => p.type === 'dueCountChanged' && p.count === 1)).toHaveLength(1);
    expect(await svc.getStatus()).toEqual({ due: 1, waiting: 0 });
  });

  it('practiceDue says so when nothing is due, and opens the app when something is', async () => {
    const openApp = vi.fn();
    const { svc, db, notices } = await startTestService({ openApp });
    expect(await svc.practiceDue()).toEqual({ due: false });
    expect(notices()).toEqual(['Nothing is due right now.']);
    expect(openApp).not.toHaveBeenCalled();

    await svc.addVerses({ verseIds: [43003016] });
    await db.sql.run(`UPDATE memory_card SET due_at = 1 WHERE rung = 'blanks'`);
    expect(await svc.practiceDue()).toEqual({ due: true });
    expect(openApp).toHaveBeenCalledTimes(1);
  });

  it('reports the one-time import status, empty until recorded', async () => {
    const { svc, db } = await startTestService();
    expect(await svc.getImportStatus()).toEqual({ status: null, recordedAt: null, counts: null, sourceAvailable: false });

    await db.sql.run(
      `INSERT INTO memory_import (source, status, source_version, recorded_at, counts) VALUES (?, 'imported', 7, 123, ?)`,
      [LEGACY_SOURCE_KEY, JSON.stringify({ passages: 2 })],
    );
    expect(await svc.getImportStatus()).toEqual({ status: 'imported', recordedAt: 123, counts: { passages: 2 }, sourceAvailable: false });
  });

  it('navigateTo and openHostSettings call through to the host', async () => {
    const navigateToVerse = vi.fn().mockResolvedValue(undefined);
    const openSettings = vi.fn();
    const { svc } = await startTestService({ bible: { navigateToVerse }, openSettings });
    await svc.navigateTo({ verseId: 43003016 });
    expect(navigateToVerse).toHaveBeenCalledWith(43003016);
    await svc.openHostSettings();
    expect(openSettings).toHaveBeenCalled();
  });
});

/**
 * Mastery, as the panel actually receives it.
 *
 * `buildPlanView`, `isPassageWellLearned` and the `resetPassageProgress`
 * dispatch case are not exported, so these drive them the way the panel does:
 * `activate` against a real `MemorySql`, then `getPlan` over the panel
 * svc. Rows are inserted with SQL rather than through `addPassage`,
 * because what is under test is how a *history* is read back, and going
 * through the reference parser and the host's verse ranges to arrange one
 * would put two unrelated subsystems between the fixture and the assertion.
 *
 * Deliberately placed before the `verse labels` block below: its last test
 * permanently downgrades `verseIdEncodingTrusted`, which is module-level state
 * that never comes back.
 */
describe('derived mastery through the panel protocol', () => {
  async function activateWithStore() {
    const t = await startTestService();
    return { db: t.sql, svc: t.svc };
  }

  /** A passage row plus a card for each rung named. */
  async function seedPassage(
    db: MemorySql,
    opts: { verseCount: number; reference: string; startVerseId: number; rungs: string[] },
  ): Promise<number> {
    const collection = await db.queryOne<{ id: number }>('SELECT id FROM memory_collection LIMIT 1');
    const res = await db.run(
      `INSERT INTO memory_passage
         (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
       VALUES (?, 'KJV', ?, ?, ?, ?, 0)`,
      [
        collection?.id,
        opts.startVerseId,
        opts.startVerseId + opts.verseCount - 1,
        opts.reference,
        opts.verseCount,
      ],
    );
    const passageId = Number(res.lastInsertRowid);
    for (const rung of opts.rungs) {
      await db.run(
        `INSERT INTO memory_card (passage_id, rung, state, interval_step, due_at, streak, last_score)
         VALUES (?, ?, 'new', -1, NULL, 0, NULL)`,
        [passageId, rung],
      );
    }
    return passageId;
  }

  async function cardIdFor(db: MemorySql, passageId: number, rung: string): Promise<number> {
    const row = await db.queryOne<{ id: number }>(
      `SELECT id FROM memory_card WHERE passage_id = ? AND rung = ?`,
      [passageId, rung],
    );
    return row!.id;
  }

  async function attempt(
    db: MemorySql,
    cardId: number,
    opts: { score: number; tier: number; at?: number },
  ): Promise<void> {
    await db.run(
      `INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps, replay, duration_ms, tier)
       VALUES (?, ?, ?, 1, 1, 0, 1000, ?)`,
      [cardId, opts.at ?? 1_700_000_000_000 + opts.tier, opts.score, opts.tier],
    );
  }

  /** Pass every tier of one activity at `score` - what mastery now takes. */
  async function master(
    db: MemorySql,
    passageId: number,
    rung: 'ordering' | 'blanks' | 'firstletters',
    score = 1,
  ): Promise<void> {
    const id = await cardIdFor(db, passageId, rung);
    for (let tier = 0; tier < 2; tier += 1) await attempt(db, id, { score, tier });
  }

  const getPlan = (svc: MemoryApi): Promise<PlanView> => svc.getPlan();

  const rungOf = (plan: PlanView, rung: string): RungView =>
    plan.passages[0]!.rungs.find((r) => r.rung === rung) as RungView;

  const TEXT_RUNGS = ['ordering', 'blanks', 'firstletters'];

  it('reports one perfect tier-0 attempt on a two-tier activity as level 3', async () => {
    // The resolved formula's worked example, all the way out to the panel:
    // completeness 1/2 times accuracy 1.0 is 0.5, which is the middle of the
    // 1-5 scale, not the top. Under v1 this same history lit all five boxes.
    const { db, svc } = await activateWithStore();
    const passageId = await seedPassage(db, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
      rungs: TEXT_RUNGS,
    });
    await attempt(db, await cardIdFor(db, passageId, 'blanks'), { score: 1, tier: 0 });

    const blanks = rungOf(await getPlan(svc), 'blanks');
    expect(blanks.level).toBe(3);
    expect(blanks).toMatchObject({ tiers: 2, tiersPassed: 1, attempts: 1, bestScore: 1 });
    // And the next session should serve the tier that has not been passed.
    expect(blanks.nextTier).toBe(1);
  });

  it('does not lower a level after a bad session, but does bring the due date closer', async () => {
    const { db, svc } = await activateWithStore();
    const passageId = await seedPassage(db, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
      rungs: TEXT_RUNGS,
    });
    const blanks = await cardIdFor(db, passageId, 'blanks');
    await attempt(db, blanks, { score: 1, tier: 0 });
    // A card a few passes up the ladder, so its interval has room to fall.
    await db.run(`UPDATE memory_card SET interval_step = 3, streak = 3, due_at = ? WHERE id = ?`, [
      2_000_000_000_000,
      blanks,
    ]);
    const before = rungOf(await getPlan(svc), 'blanks');

    await attempt(db, blanks, { score: 0.2, tier: 0, at: 1_800_000_000_000 });
    await db.run(`UPDATE memory_card SET interval_step = 0, streak = 0, due_at = ? WHERE id = ?`, [
      1_800_000_100_000,
      blanks,
    ]);
    const after = rungOf(await getPlan(svc), 'blanks');

    expect(after.level).toBeGreaterThanOrEqual(before.level);
    expect(after.level).toBe(3);
    expect(after.dueAt!).toBeLessThan(before.dueAt!);
    expect(after.attempts).toBe(2);
  });

  it('does NOT call a passage well learned when only its EASIEST activity is mastered', async () => {
    // The direction of "harder carries down", pinned explicitly. `ordering`
    // is first in `TEXT_RECALL_CHAIN`, so mastering it says nothing about
    // `blanks` or `firstletters` - which have never been opened - and the
    // passage is not learned. The old `bestLevel >= 4` rule said it was.
    const { db, svc } = await activateWithStore();
    const passageId = await seedPassage(db, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
      rungs: TEXT_RUNGS,
    });
    await master(db, passageId, 'ordering');

    const plan = await getPlan(svc);
    expect(rungOf(plan, 'ordering').level).toBe(5);
    expect(rungOf(plan, 'blanks').level).toBe(0);
    expect(plan.passages[0]!.bestLevel).toBe(5);
    expect(plan.passages[0]!.wellLearned).toBe(false);
  });

  it('DOES call it well learned when the HARDEST activity is mastered, without conferring a level', async () => {
    // The other direction, and the distinction the plan is explicit about:
    // `firstletters` carries down to satisfy `blanks` and `ordering`, but
    // those two keep their own level of 0. "Satisfied for the passage's sake"
    // is not "has a score".
    const { db, svc } = await activateWithStore();
    const passageId = await seedPassage(db, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
      rungs: TEXT_RUNGS,
    });
    await master(db, passageId, 'firstletters');

    const plan = await getPlan(svc);
    expect(plan.passages[0]!.wellLearned).toBe(true);
    expect(rungOf(plan, 'firstletters').level).toBe(5);
    expect(rungOf(plan, 'ordering').level).toBe(0);
    expect(rungOf(plan, 'blanks').level).toBe(0);
    expect(rungOf(plan, 'blanks').attempts).toBe(0);
  });

  it('holds the reference activities inapplicable while the plan is small', async () => {
    // The 25-verse scope gate, read at plan-build time. The cards exist - a
    // history has to have somewhere to live - but neither activity is
    // offered, and neither is counted towards the passage being learned.
    const { db, svc } = await activateWithStore();
    const passageId = await seedPassage(db, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
      rungs: [...TEXT_RUNGS, 'refmatch', 'refprovide'],
    });
    await master(db, passageId, 'firstletters');

    const plan = await getPlan(svc);
    expect(rungOf(plan, 'refmatch').applicable).toBe(false);
    expect(rungOf(plan, 'refprovide').applicable).toBe(false);
    // Inapplicable activities do not hold the passage back...
    expect(plan.passages[0]!.wellLearned).toBe(true);
    // ...and `refprovide` is single-tier, which the panel needs to know.
    expect(rungOf(plan, 'refprovide').tiers).toBe(1);
  });

  it('applies the reference activities once the plan crosses the scope gate', async () => {
    const { db, svc } = await activateWithStore();
    await seedPassage(db, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
      rungs: [...TEXT_RUNGS, 'refmatch', 'refprovide'],
    });
    // A second, long passage takes the whole collection past 25 verses.
    await seedPassage(db, {
      verseCount: 30,
      reference: 'Psalm 119:1-30',
      startVerseId: 19119001,
      rungs: [...TEXT_RUNGS, 'refmatch', 'refprovide'],
    });

    const plan = await getPlan(svc);
    expect(rungOf(plan, 'refmatch').applicable).toBe(true);
    expect(rungOf(plan, 'refprovide').applicable).toBe(true);
    // And they now have to be earned on their own merits - nothing in the
    // text-recall chain carries into them.
    expect(plan.passages[0]!.wellLearned).toBe(false);
  });

  it('resets a passage back to nothing, and answers with the rebuilt plan', async () => {
    const { db, svc } = await activateWithStore();
    const passageId = await seedPassage(db, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
      rungs: TEXT_RUNGS,
    });
    await master(db, passageId, 'firstletters');
    await db.run(`UPDATE memory_card SET due_at = ?, interval_step = 4, streak = 3 WHERE passage_id = ?`, [
      2_000_000_000_000,
      passageId,
    ]);
    expect((await getPlan(svc)).passages[0]!.wellLearned).toBe(true);

    // The reply carries the new view, so the screen that asked can redraw
    // without waiting for the `planChanged` push to come round.
    const plan = await svc.resetPassageProgress({ passageId });
    expect(plan.passages[0]!.wellLearned).toBe(false);
    for (const rung of plan.passages[0]!.rungs) {
      expect(rung).toMatchObject({ level: 0, attempts: 0, dueAt: null, streak: 0, bestScore: null });
    }
    expect(plan.totalDue).toBe(0);
    // And the next `getPlan` agrees - the reply was not a one-off view built
    // from something that had not been written.
    expect(await getPlan(svc)).toEqual(plan);
  });

  it('survives a second reset with nothing left to reset', async () => {
    const { db, svc } = await activateWithStore();
    const passageId = await seedPassage(db, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
      rungs: TEXT_RUNGS,
    });
    await master(db, passageId, 'blanks');

    await svc.resetPassageProgress({ passageId });
    const second = await svc.resetPassageProgress({ passageId });

    expect(second.passages[0]!.rungs.every((r) => r.level === 0)).toBe(true);
  });
});

/**
 * T5: multiple lists and scope, driven the same way the "derived mastery"
 * block above drives the panel protocol - `activate` against a real
 * `MemorySql`, then `svc.deliver` for every request. Rows are seeded
 * with SQL rather than `addPassage` for the same reason as that block: what
 * is under test is list management and scope, not reference resolution.
 */
describe('multiple lists through the panel protocol', () => {
  async function activateWithStore() {
    const t = await startTestService();
    return { db: t.sql, svc: t.svc };
  }

  const ALL_RUNGS = ['ordering', 'refmatch', 'blanks', 'firstletters', 'refprovide'];

  /** A passage row plus a card for every rung, in the given list. */
  async function seedPassage(
    db: MemorySql,
    collectionId: number,
    opts: { verseCount: number; reference: string; startVerseId: number },
  ): Promise<number> {
    const res = await db.run(
      `INSERT INTO memory_passage
         (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
       VALUES (?, 'KJV', ?, ?, ?, ?, 0)`,
      [
        collectionId,
        opts.startVerseId,
        opts.startVerseId + opts.verseCount - 1,
        opts.reference,
        opts.verseCount,
      ],
    );
    const passageId = Number(res.lastInsertRowid);
    for (const rung of ALL_RUNGS) {
      await db.run(
        `INSERT INTO memory_card (passage_id, rung, state, interval_step, due_at, streak, last_score)
         VALUES (?, ?, 'new', -1, NULL, 0, NULL)`,
        [passageId, rung],
      );
    }
    return passageId;
  }

  /** A former panel request as the matching method call. */
  const deliver = <T>(svc: MemoryApi, req: PanelRequest): Promise<T> => call<T>(svc, req);

  it('creates a list, renames it, and setScope filters the plan to just that list', async () => {
    const { db, svc } = await activateWithStore();
    const plan = await deliver<PlanView>(svc, { type: 'getPlan' });
    const defaultListId = plan.collectionId;

    const created = await deliver<PlanView>(svc, { type: 'createList', name: 'Topical' });
    const secondList = created.lists.find((l) => l.name === 'Topical');
    expect(secondList).toBeDefined();

    await deliver<PlanView>(svc, {
      type: 'renameList',
      id: secondList!.id,
      name: 'Topical verses',
    });

    await seedPassage(db, defaultListId, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
    });
    await seedPassage(db, secondList!.id, {
      verseCount: 1,
      reference: 'John 3:16',
      startVerseId: 43003016,
    });

    const allScope = await deliver<PlanView>(svc, { type: 'getPlan' });
    expect(allScope.passages).toHaveLength(2);
    expect(allScope.scope).toBe('all');

    const scoped = await deliver<PlanView>(svc, {
      type: 'setScope',
      scope: { kind: 'list', id: secondList!.id },
    });
    expect(scoped.passages).toHaveLength(1);
    expect(scoped.passages[0]!.passage.reference).toBe('John 3:16');
    expect(scoped.collectionName).toBe('Topical verses');
    expect(scoped.scope).toBe(secondList!.id);

    // The scope is persisted, so the next `getPlan` (a fresh panel opening,
    // say) still sees just this list without setting scope again.
    expect((await deliver<PlanView>(svc, { type: 'getPlan' })).passages).toHaveLength(1);
  });

  it('persists the passage sort order over the protocol, broadcasts planChanged, and reports it on the plan', async () => {
    const t = await startTestService();
    expect((await deliver<PlanView>(t.svc, { type: 'getPlan' })).sortOrder).toBe('bible');

    const { svc, pushes } = t;
    const before = pushes.length;
    await deliver(svc, { type: 'setPassageSortOrder', order: 'need' });

    expect(pushes.slice(before)).toContainEqual({ type: 'planChanged' });
    expect((await deliver<PlanView>(svc, { type: 'getPlan' })).sortOrder).toBe('need');

    await deliver(svc, { type: 'setPassageSortOrder', order: 'bible' });
    expect((await deliver<PlanView>(svc, { type: 'getPlan' })).sortOrder).toBe('bible');
  });

  it('refuses to delete the only list, with a readable error rather than a thrown SQL failure', async () => {
    const { svc } = await activateWithStore();
    const plan = await deliver<PlanView>(svc, { type: 'getPlan' });

    await expect(
      svc.deleteList({ id: plan.collectionId, movePassagesTo: plan.collectionId }),
    ).rejects.toThrow(/only list/i);
  });

  it('moves passages, cards AND attempt history to the target list when a list is deleted', async () => {
    const { db, svc } = await activateWithStore();
    const plan = await deliver<PlanView>(svc, { type: 'getPlan' });
    const defaultListId = plan.collectionId;

    const created = await deliver<PlanView>(svc, { type: 'createList', name: 'Temp' });
    const tempList = created.lists.find((l) => l.name === 'Temp')!;

    const passageId = await seedPassage(db, tempList.id, {
      verseCount: 1,
      reference: 'John 3:16',
      startVerseId: 43003016,
    });
    const blanksCard = await db.queryOne<{ id: number }>(
      `SELECT id FROM memory_card WHERE passage_id = ? AND rung = 'blanks'`,
      [passageId],
    );
    await db.run(
      `INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps, replay, duration_ms, tier)
       VALUES (?, ?, 1, 1, 1, 0, 1000, 0)`,
      [blanksCard!.id, 1_700_000_000_000],
    );

    const afterDelete = await deliver<PlanView>(svc, {
      type: 'deleteList',
      id: tempList.id,
      movePassagesTo: defaultListId,
    });

    const moved = afterDelete.passages.find((p) => p.passage.id === passageId);
    expect(moved?.passage.reference).toBe('John 3:16');
    expect(moved?.passage.collectionId).toBe(defaultListId);

    const attemptRows = await db.query(`SELECT * FROM memory_attempt WHERE card_id = ?`, [blanksCard!.id]);
    expect(attemptRows).toHaveLength(1);

    expect(afterDelete.lists.find((l) => l.id === tempList.id)).toBeUndefined();
  });

  it('getListPracticeStats reports total and practiced passages of a list', async () => {
    const { db, svc } = await activateWithStore();
    const plan = await deliver<PlanView>(svc, { type: 'getPlan' });
    const first = await seedPassage(db, plan.collectionId, { verseCount: 1, reference: 'John 3:16', startVerseId: 43003016 });
    await seedPassage(db, plan.collectionId, { verseCount: 1, reference: 'Romans 8:28', startVerseId: 45008028 });
    const card = await db.queryOne<{ id: number }>(`SELECT id FROM memory_card WHERE passage_id = ? AND rung = 'blanks'`, [first]);
    await db.run(
      `INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps, replay, duration_ms, tier)
       VALUES (?, ?, 1, 1, 1, 0, 1000, 0)`,
      [card!.id, 1_700_000_000_000],
    );
    expect(await deliver(svc, { type: 'getListPracticeStats', id: plan.collectionId })).toEqual({ total: 2, practiced: 1 });
  });

  it('falls back to scope "all" once the scoped list is deleted out from under the panel', async () => {
    const { svc } = await activateWithStore();
    const plan = await deliver<PlanView>(svc, { type: 'getPlan' });
    const defaultListId = plan.collectionId;

    const created = await deliver<PlanView>(svc, { type: 'createList', name: 'Temp' });
    const tempList = created.lists.find((l) => l.name === 'Temp')!;

    const scoped = await deliver<PlanView>(svc, {
      type: 'setScope',
      scope: { kind: 'list', id: tempList.id },
    });
    expect(scoped.scope).toBe(tempList.id);

    // Simulated as if a different call path deleted the scoped list.
    await deliver<PlanView>(svc, {
      type: 'deleteList',
      id: tempList.id,
      movePassagesTo: defaultListId,
    });

    const after = await deliver<PlanView>(svc, { type: 'getPlan' });
    expect(after.scope).toBe('all');
  });

  it('the same reference in two lists is two independent passage rows with independent progress', async () => {
    const { db, svc } = await activateWithStore();
    const plan = await deliver<PlanView>(svc, { type: 'getPlan' });
    const defaultListId = plan.collectionId;

    const created = await deliver<PlanView>(svc, { type: 'createList', name: 'Second' });
    const secondList = created.lists.find((l) => l.name === 'Second')!;

    const a = await seedPassage(db, defaultListId, {
      verseCount: 1,
      reference: 'John 3:16',
      startVerseId: 43003016,
    });
    const b = await seedPassage(db, secondList.id, {
      verseCount: 1,
      reference: 'John 3:16',
      startVerseId: 43003016,
    });
    expect(a).not.toBe(b);

    const allScope = await deliver<PlanView>(svc, { type: 'getPlan' });
    const rows = allScope.passages.filter((p) => p.passage.reference === 'John 3:16');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.passage.collectionId))).toEqual(
      new Set([defaultListId, secondList.id]),
    );
  });

  it('sums verses, not passage rows, in scopeVerseCount and lists[].verseCount', async () => {
    const { db, svc } = await activateWithStore();
    const plan = await deliver<PlanView>(svc, { type: 'getPlan' });
    const defaultListId = plan.collectionId;

    await seedPassage(db, defaultListId, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
    });
    await seedPassage(db, defaultListId, {
      verseCount: 1,
      reference: 'John 3:16',
      startVerseId: 43003016,
    });

    const after = await deliver<PlanView>(svc, { type: 'getPlan' });
    expect(after.scopeVerseCount).toBe(4);
    expect(after.lists.find((l) => l.id === defaultListId)?.verseCount).toBe(4);
  });

  it('moves a passage to another list through the protocol', async () => {
    const { db, svc } = await activateWithStore();
    const plan = await deliver<PlanView>(svc, { type: 'getPlan' });
    const defaultListId = plan.collectionId;

    const created = await deliver<PlanView>(svc, { type: 'createList', name: 'Second' });
    const secondList = created.lists.find((l) => l.name === 'Second')!;
    const passageId = await seedPassage(db, defaultListId, {
      verseCount: 1,
      reference: 'John 3:16',
      startVerseId: 43003016,
    });

    const after = await deliver<PlanView>(svc, {
      type: 'movePassage',
      passageId,
      collectionId: secondList.id,
    });
    const movedRow = after.passages.find((p) => p.passage.id === passageId);
    expect(movedRow?.passage.collectionId).toBe(secondList.id);
  });

  it('answers getPassageView for one passage without requiring the whole plan', async () => {
    const { db, svc } = await activateWithStore();
    const plan = await deliver<PlanView>(svc, { type: 'getPlan' });
    const defaultListId = plan.collectionId;
    const passageId = await seedPassage(db, defaultListId, {
      verseCount: 3,
      reference: 'Psalm 23:1-3',
      startVerseId: 19023001,
    });

    const view = await deliver<PassageView>(svc, { type: 'getPassageView', passageId });
    expect(view.passage.id).toBe(passageId);
    expect(view.rungs.map((r) => r.rung).sort()).toEqual([...ALL_RUNGS].sort());
  });
});

/**
 * Verse labels: "3:16" vs bare "16" in the margin.
 *
 * `labelFor`/the labeller factory are not exported, so these drive the real
 * thing through `activate` + the panel protocol, exactly as the panel does:
 * `getContext` (`buildContext`) and `startSession` (its own `fetchVerses`
 * call). A real `MemorySql` backs storage so `store.getPassage` and
 * `store.getCard` see real rows, not the inert defaults `createMockApi`'s own
 * in-memory database mock returns.
 *
 * `bible.getRange` is backed by a small id -> text map per test rather than a
 * filled-in contiguous range: the verse id encoding jumps by 1000 at every
 * chapter boundary regardless of how many verses the chapter actually has, so
 * "fill every integer between start and end" would manufacture thousands of
 * nonexistent verses for a range that crosses a chapter. A real host never
 * returns an id nothing was asked to invent, and neither does this mock.
 */
describe('verse labels', () => {
  const JOHN = 43;
  const GENESIS = 1;

  function verseId(book: number, chapter: number, verse: number): number {
    return book * 1_000_000 + chapter * 1_000 + verse;
  }

  function dto(id: number): { verseId: number; text: string; textPlain: string } {
    const text = `Verse text for ${id}.`;
    return { verseId: id, text, textPlain: text };
  }

  /** `bible.getRange` that only knows about the ids named in `known`. */
  function getRangeOf(known: number[]) {
    const byId = new Map(known.map((id) => [id, dto(id)]));
    return async (start: number, end: number) =>
      known
        .filter((id) => id >= start && id <= end)
        .sort((a, b) => a - b)
        .map((id) => byId.get(id));
  }

  /**
   * Activate against a real (in-memory) sqlite-backed store, with `getRange`
   * limited to `knownVerseIds` and the encoding check passing (John's chapter
   * 3 fixture matches the expected `firstVerseId`, so `verseIdEncodingTrusted`
   * stays `true` unless a test overrides `listChapters`).
   */
  async function activateForLabels(knownVerseIds: number[], bibleOverrides: Record<string, unknown> = {}) {
    const t = await startTestService({
      bible: { getRange: getRangeOf(knownVerseIds), ...bibleOverrides },
    });
    return { db: t.sql, svc: t.svc };
  }

  /** Insert a passage row directly, bypassing `addPassage`'s reference parser
   * and its `MAX_PASSAGE_VERSES` cap - which is computed as a raw
   * `endVerseId - startVerseId` difference and so cannot represent a real
   * cross-chapter passage (the 1000-per-chapter gap dwarfs it). That cap is
   * unrelated to what is under test here: how `buildContext`/`startSession`
   * label whatever passage the store already holds. */
  async function insertPassage(
    db: MemorySql,
    over: { startVerseId: number; endVerseId: number; reference: string; verseCount: number },
  ): Promise<number> {
    const collection = await db.queryOne<{ id: number }>('SELECT id FROM memory_collection LIMIT 1');
    const res = await db.run(
      `INSERT INTO memory_passage
         (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
       VALUES (?, 'KJV', ?, ?, ?, ?, 0)`,
      [collection?.id, over.startVerseId, over.endVerseId, over.reference, over.verseCount],
    );
    return Number(res.lastInsertRowid);
  }

  const getContext = (svc: MemoryApi, passageId: number) => svc.getContext({ passageId });

  it('renders bare verse numbers for a single-chapter passage, in the passage and its context', async () => {
    const start = verseId(GENESIS, 1, 14);
    const end = verseId(GENESIS, 1, 16);
    const known = [11, 12, 13, 14, 15, 16, 17, 18, 19].map((v) => verseId(GENESIS, 1, v));
    const { db, svc } = await activateForLabels(known);
    const passageId = await insertPassage(db, {
      startVerseId: start,
      endVerseId: end,
      reference: 'Genesis 1:14-16',
      verseCount: 3,
    });

    const ctx = await getContext(svc, passageId);

    expect(ctx.verses.map((v) => v.label)).toEqual(['14', '15', '16']);
    expect(ctx.before.map((v) => v.label)).toEqual(['11', '12', '13']);
    expect(ctx.after.map((v) => v.label)).toEqual(['17', '18', '19']);
  });

  it('sanity-checks the boundary: a passage starting at verse 1 still renders bare', async () => {
    const start = verseId(GENESIS, 1, 1);
    const end = verseId(GENESIS, 1, 2);
    const known = [1, 2, 3].map((v) => verseId(GENESIS, 1, v));
    const { db, svc } = await activateForLabels(known);
    const passageId = await insertPassage(db, {
      startVerseId: start,
      endVerseId: end,
      reference: 'Genesis 1:1-2',
      verseCount: 2,
    });

    const ctx = await getContext(svc, passageId);

    expect(ctx.verses.map((v) => v.label)).toEqual(['1', '2']);
  });

  it('renders chapter:verse throughout a passage spanning chapters', async () => {
    const start = verseId(JOHN, 3, 35);
    const end = verseId(JOHN, 4, 2);
    const known = [verseId(JOHN, 3, 35), verseId(JOHN, 3, 36), verseId(JOHN, 4, 1), verseId(JOHN, 4, 2)];
    const { db, svc } = await activateForLabels(known);
    const passageId = await insertPassage(db, {
      startVerseId: start,
      endVerseId: end,
      reference: 'John 3:35-4:2',
      verseCount: 4,
    });

    const ctx = await getContext(svc, passageId);

    expect(ctx.verses.map((v) => v.label)).toEqual(['3:35', '3:36', '4:1', '4:2']);
  });

  it('labels context verses from the chapter before a single-chapter passage as chapter:verse, not bare', async () => {
    // The key correctness case: a passage confined to chapter 3 must not make
    // a chapter-2 context verse read as if it belonged to chapter 3.
    const start = verseId(JOHN, 3, 1);
    const end = verseId(JOHN, 3, 3);
    const before = [verseId(JOHN, 2, 998), verseId(JOHN, 2, 999)];
    const { db, svc } = await activateForLabels([...before, start, start + 1, end]);
    const passageId = await insertPassage(db, {
      startVerseId: start,
      endVerseId: end,
      reference: 'John 3:1-3',
      verseCount: 3,
    });

    const ctx = await getContext(svc, passageId);

    expect(ctx.verses.map((v) => v.label)).toEqual(['1', '2', '3']);
    expect(ctx.before.map((v) => v.label)).toEqual(['2:998', '2:999']);
  });

  it('labels context verses from the chapter after a single-chapter passage as chapter:verse, not bare', async () => {
    // Same case, the other direction: the passage's own tail verse is bare,
    // but the moment context crosses into chapter 4 it must read "4:1".
    const start = verseId(JOHN, 3, 990);
    const end = verseId(JOHN, 3, 998);
    const after = [verseId(JOHN, 3, 999), verseId(JOHN, 4, 1)];
    const { db, svc } = await activateForLabels([start, end, ...after]);
    const passageId = await insertPassage(db, {
      startVerseId: start,
      endVerseId: end,
      reference: 'John 3:990-998',
      verseCount: 9,
    });

    const ctx = await getContext(svc, passageId);

    expect(ctx.verses[ctx.verses.length - 1]?.label).toBe('998');
    expect(ctx.after.map((v) => v.label)).toEqual(['999', '4:1']);
  });

  it('uses the same chapter:verse labelling in startSession as in getContext', async () => {
    const start = verseId(JOHN, 3, 35);
    const end = verseId(JOHN, 4, 2);
    const known = [verseId(JOHN, 3, 35), verseId(JOHN, 3, 36), verseId(JOHN, 4, 1), verseId(JOHN, 4, 2)];
    const { db, svc } = await activateForLabels(known);
    const passageId = await insertPassage(db, {
      startVerseId: start,
      endVerseId: end,
      reference: 'John 3:35-4:2',
      verseCount: 4,
    });

    // `startSession` requires a card row for the rung it is asked to start -
    // normally created by `syncLadders` inside `addPassage`, which
    // `insertPassage` bypasses along with the reference parser.
    await db.run(
      `INSERT INTO memory_card (passage_id, rung, state, interval_step, due_at, streak, last_score)
       VALUES (?, 'blanks', 'new', -1, NULL, 0, NULL)`,
      [passageId],
    );

    const view = await svc.startSession({ passageId, rung: 'blanks', restart: false });

    // Cursor starts at 0: the first verse of the passage, chapter 3.
    expect((view.step as { verses: { label: string }[] }).verses[0]?.label).toBe('3:35');
  });

  // Kept last in this file: `verseIdEncodingTrusted` is only ever downgraded to
  // `false` by `verifyVerseIdEncoding`, never back (per service now, so this
  // ordering is no longer load-bearing).
  it('falls back to raw ids everywhere when the verse id encoding is not trusted', async () => {
    const start = verseId(JOHN, 3, 35);
    const end = verseId(JOHN, 4, 2);
    const known = [verseId(JOHN, 3, 35), verseId(JOHN, 3, 36), verseId(JOHN, 4, 1), verseId(JOHN, 4, 2)];
    // A `listChapters` answer that does not match the expected
    // `book*1e6 + chapter*1e3 + 1` shape flips `verseIdEncodingTrusted` to
    // false at activation - the same "downgrade rather than show a wrong
    // label" path `verifyVerseIdEncoding` takes in production.
    const { db, svc } = await activateForLabels(known, {
      listChapters: async (bookNumber: number) =>
        bookNumber === JOHN ? [{ chapter: 3, firstVerseId: 999, lastVerseId: 999, verseCount: 1 }] : [],
    });
    const passageId = await insertPassage(db, {
      startVerseId: start,
      endVerseId: end,
      reference: 'John 3:35-4:2',
      verseCount: 4,
    });

    const ctx = await getContext(svc, passageId);

    expect(ctx.verses.map((v) => v.label)).toEqual([String(start), String(start + 1), String(end - 1), String(end)]);
  });
});

describe('start purges old soft-deleted passages', () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function seededDb() {
    const db = createMemoryTestDb();
    await db.sql.run(`INSERT INTO memory_collection (name, created_at) VALUES ('My plan', 0)`);
    const now = Date.now();
    for (const [start, deletedAt] of [
      [43003016, now - 8 * DAY],
      [45008028, now - 6 * DAY],
    ] as const) {
      await db.sql.run(
        `INSERT INTO memory_passage (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at, deleted_at)
         VALUES (1, 'KJV', ?, ?, 'x', 1, 0, ?)`,
        [start, start, deletedAt],
      );
    }
    return db;
  }

  it('purges passages deleted over 7 days ago and keeps newer ones', async () => {
    const db = await seededDb();
    await startTestService({ db });
    const rows = await db.sql.query<{ start_verse_id: number }>(`SELECT start_verse_id FROM memory_passage`);
    expect(rows.map((r) => r.start_verse_id)).toEqual([45008028]);
  });

  it('still starts when the purge fails, and logs it', async () => {
    const db = await seededDb();
    const failing = new Proxy(db.sql, {
      get(target, prop) {
        if (prop === 'run') {
          return async (sql: string, params?: unknown[]) => {
            if (sql.includes('DELETE FROM memory_passage WHERE deleted_at')) throw new Error('disk full');
            return target.run(sql, params);
          };
        }
        const v = (target as unknown as Record<string | symbol, unknown>)[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as MemorySql;
    const log = { warn: vi.fn(), error: vi.fn() };
    const { svc } = await startTestService({ db, sql: failing, log });
    expect(svc).toBeDefined();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });
});
