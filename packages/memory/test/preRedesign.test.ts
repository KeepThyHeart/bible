/**
 * @vitest-environment jsdom
 *
 * A database from before the redesign opens unchanged: same verses, statuses
 * derived from existing progress, today's queue per the spec, the focus kept,
 * and nothing migrated (task 0219, design.md section 6).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { todayQueue, verseStatus } from '../src/core/today';
import type { PanelReply, PanelRequest, PlanView, RequestMap } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import { WordMeasurer } from '../src/ui/measure';
import { renderToday } from '../src/ui/todayView';
import { FIXTURE_NOW, FIXTURE_TABLES, P, REFERENCES, rowCounts, seedPreRedesignDb } from './fixtures/preRedesignDb';
import { createMemoryTestDb } from './helpers/sqlite';
import { disposeAll, startTestService } from './helpers/service';

afterEach(disposeAll);

async function openFixture() {
  const db = createMemoryTestDb();
  seedPreRedesignDb(db.host);
  const before = rowCounts(db.host);
  const { svc } = await startTestService({ db, now: () => FIXTURE_NOW });
  return { db, svc, before };
}

const refs = (items: Array<{ reference: string }>) => items.map((i) => i.reference);

describe('a pre-redesign database', () => {
  it('keeps the focus list and reports it in the plan', async () => {
    const { svc } = await openFixture();
    const plan = await svc.getPlan();
    expect(plan.scope).toBe(1);
    expect(plan.collectionName).toBe('Default');
    expect(plan.lists.map((l) => l.name)).toEqual(['Default', 'Psalms and more']);
    // A one-off scope override does not persist.
    expect((await svc.getPlan({ scope: { kind: 'all' } })).scope).toBe('all');
    expect((await svc.getPlan()).scope).toBe(1);
  });

  it('shows the same references, without the soft-deleted one', async () => {
    const { svc } = await openFixture();
    const focus = await svc.getPlan();
    expect(refs(focus.passages.map((p) => p.passage)).sort()).toEqual(
      [REFERENCES[P.learningDue], REFERENCES[P.carryDown], REFERENCES[P.fresh], REFERENCES[P.reset]].sort(),
    );
    const all = await svc.getPlan({ scope: { kind: 'all' } });
    expect(refs(all.passages.map((p) => p.passage)).sort()).toEqual(
      Object.entries(REFERENCES).filter(([id]) => Number(id) !== P.deleted).map(([, r]) => r).sort(),
    );
    expect(all.passages.find((p) => p.passage.id === P.carryDown)!.passage.verseCount).toBe(6);
  });

  it('derives statuses from existing progress', async () => {
    const { svc } = await openFixture();
    const all = await svc.getPlan({ scope: { kind: 'all' } });
    const status = (id: number) => verseStatus(all.passages.find((p) => p.passage.id === id)!, FIXTURE_NOW);
    expect(status(P.learningDue).status).toBe('learning');
    expect(status(P.learningDue).dueNow).toBe(true);
    const psalm = all.passages.find((p) => p.passage.id === P.carryDown)!;
    expect(psalm.rungs.find((r) => r.rung === 'firstletters')!.resume).toMatchObject({ stepsDone: 3, totalSteps: 6 });
    expect(status(P.carryDown).status).toBe('known'); // carried down from first letters
    expect(status(P.carryDown).dueNow).toBe(false);
    expect(status(P.fresh).status).toBe('new');
    expect(status(P.reset).status).toBe('new'); // reset hides the older attempts
    expect(status(P.otherList).status).toBe('learning');
    expect(status(P.otherNew).status).toBe('new');
    for (const id of [P.learningDue, P.carryDown, P.fresh, P.reset, P.otherList, P.otherNew]) {
      expect(status(id).doneToday).toBe(false);
    }
  });

  it("builds today's queue for the focus list only", async () => {
    const { svc } = await openFixture();
    const plan = await svc.getPlan();
    const q = todayQueue(plan.passages, FIXTURE_NOW);
    // Due reviews first, then new verses oldest first.
    expect(q.items.map((i) => [i.reference, i.kind])).toEqual([
      ['John 3:16', 'review'],
      ['Romans 8:28', 'new'],
      ['Proverbs 3:5-10', 'new'],
    ]);
    expect(q.items[0]!.rung).toBe('blanks');
    expect(q.items[2]!.rung).toBe('ordering');
    expect([q.reviewCount, q.newCount, q.doneToday, q.totalVerses]).toEqual([1, 2, 0, 4]);
    expect(q.nextNewAvailable).toBeNull();
    // Psalm 23 is known and next due in ten days.
    expect(q.upcoming).not.toBeNull();
    expect(q.upcoming!.count).toBe(1);
    expect(q.upcoming!.day).toBe(new Date(FIXTURE_NOW + 10 * 86_400_000).setHours(0, 0, 0, 0));
  });

  it('with all lists in scope, the other list joins the queue', async () => {
    const { svc } = await openFixture();
    const all = await svc.getPlan({ scope: { kind: 'all' } });
    const q = todayQueue(all.passages, FIXTURE_NOW);
    expect(q.items.map((i) => i.reference)).toEqual([
      'John 3:16', 'Genesis 1:1', 'Romans 8:28', 'Proverbs 3:5-10', 'Isaiah 41:10',
    ]);
    expect(q.newCount).toBe(3);
    expect(q.nextNewAvailable).toBeNull();
  });

  it('counts push cards and the due badge as before', async () => {
    const { svc } = await openFixture();
    const plan = await svc.getPlan({ scope: { kind: 'all' } });
    expect(plan.cardsWaiting).toBeGreaterThanOrEqual(0);
    expect(plan.totalDue).toBe(2); // John 3:16 and Genesis 1:1
  });

  it('migrates nothing: row counts are unchanged after open and reads', async () => {
    const { db, svc, before } = await openFixture();
    await svc.getPlan();
    await svc.getPlan({ scope: { kind: 'all' } });
    expect(rowCounts(db.host)).toEqual(before);
    expect(Object.keys(before)).toEqual([...FIXTURE_TABLES]);
    expect(before.memory_collection).toBe(2);
    expect(before.memory_passage).toBe(7);
    // The soft-deleted passage and the reset history are still there.
    expect(db.host.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM memory_passage WHERE deleted_at IS NOT NULL`)!.n).toBe(1);
    expect(db.host.queryOne<{ value: string }>(`SELECT value FROM memory_setting WHERE key = 'practiceScope'`)!.value).toBe(
      JSON.stringify({ kind: 'list', id: 1 }),
    );
  });

  it('renders Today with the counts text for the focus plan', async () => {
    const { svc } = await openFixture();
    const plan: PlanView = await svc.getPlan();
    const host: PanelHost = {
      now: () => FIXTURE_NOW,
      request: <R extends PanelRequest>(): Promise<PanelReply<RequestMap[R['type']]>> =>
        Promise.resolve({ ok: false, error: 'not stubbed' }),
      go: () => undefined,
      reload: () => undefined,
      measurer: new WordMeasurer(document),
      activeReference: null,
      startSession: async () => undefined,
      startFlow: async () => true,
      openInBible: () => undefined,
      announce: () => undefined,
    } as unknown as PanelHost;
    const root = renderToday(host, plan, {});
    const text = (root.textContent ?? '').replace(/\s+/g, ' ');
    expect(root.querySelector('h1')?.textContent).toBe('Today');
    expect(text).toContain('1 to review, 2 new');
    expect(text).toContain('John 3:16');
    expect(text).not.toContain('Genesis 1:1');
    expect(root.querySelectorAll('.sm-today-item').length).toBe(3);
  });
});
