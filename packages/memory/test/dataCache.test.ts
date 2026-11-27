import { describe, it, expect, vi } from 'vitest';
import type { MemoryApi } from '../src/core/api';
import type { PlanView } from '../src/core/types';
import { MemoryDataCache, getDataCache, scopedView } from '../src/ui/dataCache';
import { DAY, NOW, makePassageView, makePlan, makeRung } from './helpers/planFactory';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeApi(plans: Array<PlanView | Deferred<PlanView>>) {
  let i = 0;
  const getPlan = vi.fn(() => {
    const next = plans[Math.min(i++, plans.length - 1)]!;
    return 'promise' in next ? next.promise : Promise.resolve(next);
  });
  const getContext = vi.fn(async ({ passageId }: { passageId: number }) => ({
    passageId,
    reference: 'x',
    before: [],
    after: [],
    verses: [{ verseId: passageId, label: '1:1', words: ['a'], lines: null }],
  }));
  const getAnalytics = vi.fn();
  const api = { getPlan, getContext, getAnalytics } as unknown as MemoryApi;
  return { api, getPlan, getContext, getAnalytics };
}

const v = (epoch: string, version: number, extra: Partial<PlanView> = {}) =>
  makePlan({ epoch, version, ...extra });

describe('MemoryDataCache', () => {
  it('loads lazily and once', async () => {
    const { api, getPlan } = fakeApi([v('a', 1)]);
    const c = new MemoryDataCache(api);
    expect(c.get()).toBeNull();
    expect(getPlan).not.toHaveBeenCalled();
    const [p1, p2] = await Promise.all([c.ensure(), c.ensure()]);
    expect(p1).toBe(p2);
    await c.ensure();
    expect(getPlan).toHaveBeenCalledTimes(1);
    expect(getPlan).toHaveBeenCalledWith({ scope: { kind: 'all' } });
    expect(c.get()).toBe(p1);
  });

  it('coalesces refreshes: one in flight plus one queued', async () => {
    const d1 = deferred<PlanView>();
    const d2 = deferred<PlanView>();
    const { api, getPlan } = fakeApi([d1, d2]);
    const c = new MemoryDataCache(api);
    const a = c.refresh();
    const b = c.refresh();
    const d = c.refresh();
    expect(getPlan).toHaveBeenCalledTimes(1);
    expect(b).toBe(d);
    d1.resolve(v('a', 1));
    await a;
    await Promise.resolve();
    expect(getPlan).toHaveBeenCalledTimes(2);
    d2.resolve(v('a', 2));
    expect((await b).version).toBe(2);
    expect(c.get()?.version).toBe(2);
  });

  it('accepts a plan from a different epoch even with a lower version', () => {
    const { api } = fakeApi([v('a', 1)]);
    const c = new MemoryDataCache(api);
    c.applyPlan(v('a', 9));
    c.applyPlan(v('b', 1));
    expect(c.get()?.epoch).toBe('b');
  });

  it('skips an older version of the same epoch, accepts an equal one with other content', () => {
    const { api } = fakeApi([v('a', 1)]);
    const c = new MemoryDataCache(api);
    const newer = v('a', 5);
    c.applyPlan(newer);
    c.applyPlan(v('a', 4));
    expect(c.get()).toBe(newer);
    const same = v('a', 5, { cardsWaiting: 2 });
    c.applyPlan(same);
    expect(c.get()).toBe(same);
  });

  it('onPlanChanged skips same epoch and version <= cached, refreshes otherwise', async () => {
    const { api, getPlan } = fakeApi([v('a', 5), v('a', 6)]);
    const c = new MemoryDataCache(api);
    await c.ensure();
    c.onPlanChanged('a', 5);
    c.onPlanChanged('a', 3);
    expect(getPlan).toHaveBeenCalledTimes(1);
    c.onPlanChanged('a', 6);
    expect(getPlan).toHaveBeenCalledTimes(2);
    await c.refresh();
    c.onPlanChanged('z', 1);
    c.onPlanChanged();
    expect(getPlan.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('patchCardsWaiting updates in place and notifies', () => {
    const { api } = fakeApi([v('a', 1)]);
    const c = new MemoryDataCache(api);
    c.applyPlan(v('a', 1, { cardsWaiting: 0 }));
    const fn = vi.fn();
    c.subscribe(fn);
    c.patchCardsWaiting(3);
    expect(c.get()?.cardsWaiting).toBe(3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('patchPassage and dropPassage keep totalDue right', () => {
    const { api } = fakeApi([v('a', 1)]);
    const c = new MemoryDataCache(api);
    c.applyPlan(makePlan({ passages: [makePassageView({ id: 1, dueCount: 1 })] }));
    c.patchPassage(makePassageView({ id: 1, dueCount: 2 }));
    c.patchPassage(makePassageView({ id: 2, dueCount: 1 }));
    expect(c.get()?.totalDue).toBe(3);
    c.dropPassage(1);
    expect(c.get()?.passages.map((p) => p.passage.id)).toEqual([2]);
    expect(c.get()?.totalDue).toBe(1);
  });

  it('revalidate is throttled to once per 5 s', async () => {
    const { api, getPlan } = fakeApi([v('a', 1)]);
    let t = 1000;
    const c = new MemoryDataCache(api, { now: () => t });
    c.revalidate();
    t += 4000;
    c.revalidate();
    expect(getPlan).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    t += 1000;
    c.revalidate();
    expect(getPlan).toHaveBeenCalledTimes(2);
  });

  it('is kept across unmount and remount via getDataCache', async () => {
    const { api, getPlan } = fakeApi([v('a', 1)]);
    const first = getDataCache(api);
    await first.ensure();
    const unsub = first.subscribe(() => undefined);
    unsub();
    const again = getDataCache(api);
    expect(again).toBe(first);
    expect(again.get()).not.toBeNull();
    await again.ensure();
    expect(getPlan).toHaveBeenCalledTimes(1);
    expect(getDataCache(fakeApi([]).api)).not.toBe(first);
  });

  it('loads verse text once per passage', async () => {
    const { api, getContext } = fakeApi([v('a', 1)]);
    const c = new MemoryDataCache(api);
    expect(c.verseText(7)).toBeUndefined();
    await Promise.all([c.loadVerseText(7), c.loadVerseText(7)]);
    await c.loadVerseText(7);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(c.verseText(7)?.[0]?.words).toEqual(['a']);
  });

  it('does not notify for an identical plan, but does for the same version with other content', () => {
    const c = new MemoryDataCache(fakeApi([]).api);
    const n = vi.fn();
    c.subscribe(n);
    c.applyPlan(v('a', 1));
    const held = c.get();
    c.applyPlan(v('a', 1));
    expect(n).toHaveBeenCalledTimes(1);
    expect(c.get()).toBe(held);
    c.applyPlan(v('a', 1, { cardsWaiting: 3 }));
    expect(n).toHaveBeenCalledTimes(2);
  });

  it('flags and announces a verse text failure, and clears the flag on a plan fetch', async () => {
    const { api, getContext } = fakeApi([v('a', 1)]);
    getContext.mockRejectedValueOnce(new Error('x'));
    const c = new MemoryDataCache(api);
    const n = vi.fn();
    c.subscribe(n);
    expect(await c.loadVerseText(7)).toBeNull();
    expect(c.verseTextFailed(7)).toBe(true);
    expect(n).toHaveBeenCalledTimes(1);
    await c.refresh();
    expect(c.verseTextFailed(7)).toBe(false);
    await c.loadVerseText(7);
    expect(c.verseTextFailed(7)).toBe(false);
  });

  it('keeps stale analytics while refreshing and when the refresh fails', async () => {
    const { api, getAnalytics } = fakeApi([v('a', 1)]);
    const a1 = { streakDays: 1 } as never;
    const d = deferred<never>();
    getAnalytics.mockResolvedValueOnce(a1).mockReturnValueOnce(d.promise).mockRejectedValueOnce(new Error('x'));
    const c = new MemoryDataCache(api);
    await c.loadAnalytics();
    const pending = c.loadAnalytics();
    expect(c.analytics()).toBe(a1);
    const a2 = { streakDays: 2 } as never;
    d.resolve(a2);
    await pending;
    expect(c.analytics()).toBe(a2);
    expect(await c.loadAnalytics()).toBe(a2);
    expect(c.analytics()).toBe(a2);
  });
});

describe('scopedView', () => {
  const rungs = (due: number | null, reciteDue?: number | null) => [
    makeRung('ordering', { dueAt: due }),
    makeRung('blanks', { dueAt: null }),
    ...(reciteDue !== undefined ? [makeRung('recite', { dueAt: reciteDue, optional: true })] : []),
  ];

  it('recomputes due counts against the given now, including day rollover', () => {
    const all = makePlan({
      passages: [
        makePassageView({ id: 1, rungs: rungs(NOW + DAY - 1000), dueCount: 0 }),
        makePassageView({ id: 2, rungs: rungs(NOW - 5), dueCount: 99 }),
      ],
      totalDue: 99,
    });
    const today = scopedView(all, 'all', NOW);
    expect(today.passages.map((p) => p.dueCount)).toEqual([0, 1]);
    expect(today.totalDue).toBe(1);
    const tomorrow = scopedView(all, 'all', NOW + DAY);
    expect(tomorrow.passages.map((p) => p.dueCount)).toEqual([1, 1]);
    expect(tomorrow.totalDue).toBe(2);
    expect(all.passages[1]!.dueCount).toBe(99);
  });

  it('applies the store recite rule', () => {
    const all = makePlan({
      passages: [
        makePassageView({ id: 1, reciteOn: false, rungs: rungs(null, NOW - 1) }),
        makePassageView({ id: 2, reciteOn: true, rungs: rungs(null, null) }),
        makePassageView({ id: 3, reciteOn: false, rungs: rungs(null, null) }),
        makePassageView({ id: 4, reciteOn: true, rungs: rungs(null, NOW + 1) }),
      ],
    });
    expect(scopedView(all, 'all', NOW).reciteDueCount).toBe(2);
    expect(scopedView(all, 'all', NOW + 2).reciteDueCount).toBe(3);
  });

  it('filters to a list and recomputes counts, unlock, id and name', () => {
    const all = makePlan({
      lists: [
        { id: 1, name: 'Default', passageCount: 1, verseCount: 3 },
        { id: 2, name: 'Psalms', passageCount: 2, verseCount: 30 },
      ],
      passages: [
        makePassageView({ id: 1, collectionId: 1, verseCount: 3 }),
        makePassageView({ id: 2, collectionId: 2, verseCount: 15 }),
        makePassageView({ id: 3, collectionId: 2, verseCount: 15 }),
      ],
    });
    expect(scopedView(all, 'all', NOW).referenceActivitiesUnlocked).toBe(true);
    const one = scopedView(all, 1, NOW);
    expect(one.passages).toHaveLength(1);
    expect(one.scopeVerseCount).toBe(3);
    expect(one.referenceActivitiesUnlocked).toBe(false);
    expect(one.collectionId).toBe(1);
    expect(one.collectionName).toBe('Default');
    expect(one.scope).toBe(1);
    const two = scopedView(all, 2, NOW);
    expect(two.scopeVerseCount).toBe(30);
    expect(two.referenceActivitiesUnlocked).toBe(true);
    expect(two.collectionName).toBe('Psalms');
  });
});
