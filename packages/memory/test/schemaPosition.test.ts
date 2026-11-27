/**
 * Stored order within a list (schema v4 `position`), and the list-aware add requests
 * (`reorderList`, `getAddTargets`, `addVerses` list args, `lastAddList`, `autoAdvance`).
 */

import { describe, it, expect, afterEach } from 'vitest';

import { createMemoryTestDb } from './helpers/sqlite';
import type { TestSql } from './helpers/sqlite';
import { disposeAll, startTestService, MODULE_KJV } from './helpers/service';
import { FIXTURE_NOW, LIST_FOCUS, LIST_OTHER, P, seedPreRedesignDb } from './fixtures/preRedesignDb';
import type { PlanView } from '../src/core/types';

afterEach(disposeAll);

const V = (n: number) => 19023000 + n; // Psalm 23:n

function positions(host: TestSql, listId: number): Array<{ id: number; position: number | null }> {
  return host.queryAll<{ id: number; position: number | null }>(
    `SELECT id, position FROM memory_passage WHERE collection_id = ? AND deleted_at IS NULL ORDER BY position IS NULL, position, id`,
    [listId],
  );
}

function listOrder(plan: PlanView, listId: number): number[] {
  return plan.passages
    .filter((p) => p.passage.collectionId === listId)
    .map((p) => p.passage.id);
}

describe('position backfill', () => {
  it('init numbers a v3-style database per list in (added_at, id) order, and a second start changes nothing', async () => {
    const db = createMemoryTestDb();
    seedPreRedesignDb(db.host);
    const before = db.host.queryAll<{ id: number; position: number | null }>('SELECT id, position FROM memory_passage');
    expect(before.every((r) => r.position === null)).toBe(true);

    await startTestService({ db, now: () => FIXTURE_NOW });
    const rows = db.host.queryAll<{ id: number; position: number }>(
      'SELECT id, position FROM memory_passage ORDER BY collection_id, position',
    );
    // list 1 by age: carryDown(30d), learningDue(20d), deleted(15d), fresh(10d), reset(9d); list 2: otherList, otherNew
    expect(rows.filter((r) => [P.carryDown, P.learningDue, P.deleted, P.fresh, P.reset].includes(r.id as never)).map((r) => r.id)).toEqual([
      P.carryDown, P.learningDue, P.deleted, P.fresh, P.reset,
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 0, 1]);

    disposeAll();
    await startTestService({ db, now: () => FIXTURE_NOW });
    const again = db.host.queryAll<{ id: number; position: number }>('SELECT id, position FROM memory_passage ORDER BY id');
    expect(again).toEqual(rows.slice().sort((a, b) => a.id - b.id));
  });

  it('rows with NULL position in a list that has positions are appended after the max', async () => {
    const db = createMemoryTestDb();
    seedPreRedesignDb(db.host);
    await startTestService({ db, now: () => FIXTURE_NOW });
    disposeAll();
    db.host.execute(
      `INSERT INTO memory_passage (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
       VALUES (?, 'bible_kjv', 777001, 777001, 'X 1:1', 1, 1)`,
      [LIST_OTHER],
    );
    await startTestService({ db, now: () => FIXTURE_NOW });
    const row = db.host.queryOne<{ position: number }>(`SELECT position FROM memory_passage WHERE start_verse_id = 777001`);
    expect(row?.position).toBe(2);
  });

  it('Passage.position is read into the plan', async () => {
    const { svc } = await startTestService();
    await svc.addVerses({ verseIds: [V(1)] });
    const plan = await svc.getPlan({ scope: { kind: 'all' } } as never);
    expect(plan.passages[0]!.passage.position).toBe(0);
  });
});

describe('positions on add, move, delete-with-move and reorder', () => {
  it('appends at MAX+1 within the list, and a moved passage goes to the end of the target', async () => {
    const { svc, db } = await startTestService();
    const a = await svc.addVerses({ verseIds: [V(1)] });
    const b = await svc.addVerses({ verseIds: [V(2)] });
    const c = await svc.addVerses({ verseIds: [V(3)] });
    expect(positions(db.host, a.collectionId).map((r) => r.position)).toEqual([0, 1, 2]);

    const plan = await svc.createList({ name: 'Other' });
    const other = plan.lists.find((l) => l.name === 'Other')!.id;
    await svc.addVerses({ verseIds: [V(9)], collectionId: other });
    await svc.movePassage({ passageId: a.passageId, collectionId: other });
    expect(positions(db.host, other).map((r) => r.id)).toEqual([expect.any(Number), a.passageId]);
    expect(positions(db.host, other).map((r) => r.position)).toEqual([0, 1]);
    void b; void c;
  });

  it('deleting a list appends its passages after the target in their old order', async () => {
    const { svc, db } = await startTestService();
    const created = await svc.createList({ name: 'Src' });
    const src = created.lists.find((l) => l.name === 'Src')!.id;
    const x = await svc.addVerses({ verseIds: [V(1)] });
    const s1 = await svc.addVerses({ verseIds: [V(2)], collectionId: src });
    const s2 = await svc.addVerses({ verseIds: [V(3)], collectionId: src });
    await svc.reorderList({ collectionId: src, passageIds: [s2.passageId, s1.passageId] });
    await svc.deleteList({ id: src, movePassagesTo: x.collectionId });
    expect(positions(db.host, x.collectionId).map((r) => r.id)).toEqual([x.passageId, s2.passageId, s1.passageId]);
    expect(positions(db.host, x.collectionId).map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it('reorderList reorders, keeps unlisted rows after, writes only changed rows and returns the all-scope plan', async () => {
    const { svc, db } = await startTestService();
    const a = await svc.addVerses({ verseIds: [V(1)] });
    const b = await svc.addVerses({ verseIds: [V(2)] });
    const c = await svc.addVerses({ verseIds: [V(3)] });
    const list = a.collectionId;

    const plan = await svc.reorderList({ collectionId: list, passageIds: [c.passageId, a.passageId] });
    expect(listOrder(plan, list)).toEqual([c.passageId, a.passageId, b.passageId]);
    expect(plan.scope).toBe('all');

    // Only changed rows are updated: same order again touches nothing.
    db.host.execute(`CREATE TABLE IF NOT EXISTS upd_log (id INTEGER)`);
    db.host.execute(`CREATE TRIGGER IF NOT EXISTS upd_t AFTER UPDATE OF position ON memory_passage BEGIN INSERT INTO upd_log VALUES (NEW.id); END`);
    await svc.reorderList({ collectionId: list, passageIds: [c.passageId, a.passageId, b.passageId] });
    expect(db.host.queryAll('SELECT * FROM upd_log')).toHaveLength(0);
    await svc.reorderList({ collectionId: list, passageIds: [c.passageId, b.passageId, a.passageId] });
    expect(db.host.queryAll<{ id: number }>('SELECT id FROM upd_log').map((r) => r.id).sort()).toEqual([a.passageId, b.passageId].sort());
  });

  it('reorderList rejects foreign, soft-deleted, unknown and repeated ids without changing anything', async () => {
    const { svc, db } = await startTestService();
    const a = await svc.addVerses({ verseIds: [V(1)] });
    const b = await svc.addVerses({ verseIds: [V(2)] });
    const created = await svc.createList({ name: 'Elsewhere' });
    const other = created.lists.find((l) => l.name === 'Elsewhere')!.id;
    const f = await svc.addVerses({ verseIds: [V(5)], collectionId: other });
    await svc.removePassage({ passageId: b.passageId });
    const before = positions(db.host, a.collectionId);
    for (const ids of [[f.passageId], [b.passageId], [999999], [a.passageId, a.passageId]]) {
      await expect(svc.reorderList({ collectionId: a.collectionId, passageIds: ids })).rejects.toThrow();
    }
    expect(positions(db.host, a.collectionId)).toEqual(before);
  });
});

describe('getAddTargets and lastAddList', () => {
  it('lists the lists, the default, the label and where the range already is', async () => {
    const { svc } = await startTestService();
    const a = await svc.addVerses({ verseIds: [V(1), V(2)] });
    const t = await svc.getAddTargets({ verseIds: [V(1), V(2)] });
    expect(t.reference).toBe(a.reference);
    expect(t.existingIn).toEqual([a.collectionId]);
    expect(t.lastListId).toBeNull(); // no explicit add yet
    expect(t.defaultListId).toBe(a.collectionId);
    expect((await svc.getAddTargets()).reference).toBeNull();
    expect((await svc.getAddTargets({ verseIds: [V(7)] })).existingIn).toEqual([]);
  });

  it('an explicit add records lastAddList; a deleted last list reads as null', async () => {
    const { svc } = await startTestService();
    const r = await svc.addVerses({ verseIds: [V(1)], newListName: 'Favorites' });
    expect(r.listName).toBe('Favorites');
    expect((await svc.getAddTargets()).lastListId).toBe(r.collectionId);
    expect((await svc.getPlan()).lastAddListId).toBe(r.collectionId);

    const plan = await svc.getPlan();
    const def = plan.lists.find((l) => l.name === 'Default')!.id;
    await svc.deleteList({ id: r.collectionId, movePassagesTo: def });
    expect((await svc.getAddTargets()).lastListId).toBeNull();
    expect((await svc.getPlan()).lastAddListId).toBeNull();
  });

  it('stores the list NAME; renamed -> null, same name in another case resolves', async () => {
    const { svc, db } = await startTestService();
    const r = await svc.addVerses({ verseIds: [V(1)], newListName: 'Psalms' });
    const stored = db.host.queryAll<{ value: string }>(`SELECT value FROM memory_setting WHERE key = 'lastAddList'`);
    expect(stored[0]!.value).toBe('Psalms');
    db.host.execute(`UPDATE memory_setting SET value = 'psalms' WHERE key = 'lastAddList'`);
    expect((await svc.getAddTargets()).lastListId).toBe(r.collectionId);
    await svc.renameList({ id: r.collectionId, name: 'Hymns' });
    expect((await svc.getAddTargets()).lastListId).toBeNull();
  });

  it('a corrupt stored value reads as null', async () => {
    const { svc, db } = await startTestService();
    db.host.execute(`INSERT OR REPLACE INTO memory_setting (key, value) VALUES ('lastAddList', 'abc')`);
    expect((await svc.getAddTargets()).lastListId).toBeNull();
  });
});

describe('addVerses list arguments', () => {
  it('adds to a chosen list; the name reaches the result', async () => {
    const { svc } = await startTestService();
    const created = await svc.createList({ name: 'Psalms' });
    const id = created.lists.find((l) => l.name === 'Psalms')!.id;
    const r = await svc.addVerses({ verseIds: [V(1)], collectionId: id });
    expect(r).toMatchObject({ outcome: 'added', collectionId: id, listName: 'Psalms' });
    const again = await svc.addVerses({ verseIds: [V(1)], collectionId: id });
    expect(again.outcome).toBe('exists');
  });

  it('newListName is trimmed and matched case-insensitively against existing lists', async () => {
    const { svc } = await startTestService();
    const first = await svc.addVerses({ verseIds: [V(1)], newListName: '  Favorites ' });
    expect(first.listName).toBe('Favorites');
    const second = await svc.addVerses({ verseIds: [V(2)], newListName: 'FAVORITES' });
    expect(second.collectionId).toBe(first.collectionId);
    const plan = await svc.getPlan();
    expect(plan.lists.filter((l) => l.name.toLowerCase() === 'favorites')).toHaveLength(1);
  });

  it('an empty or blank new-list name throws and creates nothing', async () => {
    const { svc } = await startTestService();
    const before = (await svc.getPlan()).lists.length;
    await expect(svc.addVerses({ verseIds: [V(1)], newListName: '   ' })).rejects.toThrow(/name/i);
    await expect(svc.addVerses({ verseIds: [V(1)], newListName: '' })).rejects.toThrow(/name/i);
    expect((await svc.getPlan()).lists.length).toBe(before);
  });

  it('addPassageRange with a list also records the last list', async () => {
    const chapters = [31, 25];
    const { svc } = await startTestService({
      bible: {
        listModules: async () => [MODULE_KJV],
        listChapters: async (book: number) =>
          book !== 1 ? [] : chapters.map((n, i) => ({
            bookNumber: 1, chapter: i + 1, verseCount: n,
            firstVerseId: 1_000_000 + (i + 1) * 1000 + 1, lastVerseId: 1_000_000 + (i + 1) * 1000 + n,
          })),
      },
    });
    const r = await svc.addPassageRange({ startVerseId: 1_001_001, endVerseId: 1_001_002, newListName: 'Range list' });
    expect((await svc.getAddTargets()).lastListId).toBe(r.passage.collectionId);
  });
});

describe('autoAdvance setting', () => {
  it('defaults to true and toggles', async () => {
    const { svc } = await startTestService();
    expect((await svc.getSettings()).autoAdvance).toBe(true);
    await svc.setAutoAdvance({ on: false });
    expect((await svc.getSettings()).autoAdvance).toBe(false);
    await svc.setAutoAdvance({ on: true });
    expect((await svc.getSettings()).autoAdvance).toBe(true);
  });
});

void LIST_FOCUS;
