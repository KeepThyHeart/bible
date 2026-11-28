import { describe, it, expect } from 'vitest';
import type { PassageView, Rung, RungView } from '../src/core/types';
import {
  MAX_NEW_PER_DAY,
  anywayOrder,
  nextUnfinishedRung,
  pickSuggestedRung,
  suggestedRung,
  startOfLocalDay,
  todayQueue,
  verseStatus,
} from '../src/core/today';
import { startOfLocalDay as fmtStart } from '../src/ui/format';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();

function rung(rung: Rung, over: Partial<RungView> = {}): RungView {
  return {
    rung, level: 0, dueAt: null, streak: 0, lastScore: null, applicable: true, resume: null,
    tiers: 2, tiersPassed: 0, bestScore: null, attempts: 0, ...over,
  } as RungView;
}

function pv(id: number, rungs: RungView[], over: { addedAt?: number; wellLearned?: boolean; verseCount?: number } = {}): PassageView {
  return {
    passage: {
      id, collectionId: 1, moduleId: 'kjv', startVerseId: id, endVerseId: id, reference: `Ref ${id}`,
      verseCount: over.verseCount ?? 1, addedAt: over.addedAt ?? id, answerMode: null, reciteOn: false,
    },
    rungs,
    dueCount: 0,
    bestLevel: 0,
    wellLearned: over.wellLearned ?? false,
  };
}

const fresh = (id: number, addedAt = id) =>
  pv(id, [rung('ordering'), rung('blanks'), rung('firstletters')], { addedAt });

/** Practised on a past day, due at `dueAt`. */
const learned = (id: number, dueAt: number, over: Partial<RungView> = {}, pvOver = {}) =>
  pv(id, [
    rung('ordering', { attempts: 2, level: 2, dueAt, lastPractisedAt: NOW - 5 * DAY, firstPractisedAt: NOW - 9 * DAY, ...over }),
    rung('blanks'),
  ], pvOver);

describe('verseStatus', () => {
  it('new when no attempts, ignoring recite-only attempts', () => {
    expect(verseStatus(fresh(1), NOW).status).toBe('new');
    const p = pv(1, [rung('ordering'), rung('recite', { attempts: 3, level: 3 })]);
    expect(verseStatus(p, NOW).status).toBe('new');
  });

  it('a reset card (attempts back to 0) is new again', () => {
    const p = pv(1, [rung('ordering', { attempts: 0, level: 0, dueAt: null })]);
    expect(verseStatus(p, NOW).status).toBe('new');
  });

  it('learning vs known follows wellLearned, including carry-down', () => {
    const p = learned(1, NOW + DAY);
    expect(verseStatus(p, NOW).status).toBe('learning');
    const known = pv(2, [rung('ordering', { attempts: 1, level: 1 }), rung('firstletters', { attempts: 4, level: 5 })], { wellLearned: true });
    expect(verseStatus(known, NOW).status).toBe('known');
  });

  it('dueNow, nextReviewAt, doneToday, startedToday, paused', () => {
    const p = pv(1, [
      rung('ordering', { attempts: 1, dueAt: NOW - HOUR, lastPractisedAt: NOW - 2 * HOUR, firstPractisedAt: NOW - 2 * HOUR }),
      rung('blanks', { attempts: 1, dueAt: NOW + DAY, resume: { stepIndex: 1 } as never }),
      rung('refmatch', { applicable: false, dueAt: NOW - 9 * DAY }),
    ]);
    const s = verseStatus(p, NOW);
    expect(s.dueNow).toBe(true);
    expect(s.nextReviewAt).toBe(NOW - HOUR);
    expect(s.doneToday).toBe(true);
    expect(s.startedToday).toBe(true);
    expect(s.paused).toBe(false); // suggested rung is ordering (due), no resume
    const q = pv(2, [rung('ordering', { attempts: 1, dueAt: NOW - HOUR, resume: { stepIndex: 1 } as never, lastPractisedAt: NOW - 3 * DAY, firstPractisedAt: NOW - 3 * DAY })]);
    expect(verseStatus(q, NOW).paused).toBe(true);
    expect(verseStatus(q, NOW).doneToday).toBe(false);
    expect(verseStatus(q, NOW).startedToday).toBe(false);
  });
});

describe('todayQueue', () => {
  it('orders reviews by earliest due, then new verses oldest first', () => {
    const q = todayQueue(
      [fresh(5, 50), learned(2, NOW - HOUR), learned(3, NOW - 2 * HOUR), fresh(4, 40)],
      NOW,
    );
    expect(q.items.map((i) => i.passageId)).toEqual([3, 2, 4, 5]);
    expect(q.items.map((i) => i.kind)).toEqual(['review', 'review', 'new', 'new']);
    expect(q.reviewCount).toBe(2);
    expect(q.newCount).toBe(2);
  });

  it('breaks due ties by addedAt then id', () => {
    const t = NOW - HOUR;
    const q = todayQueue([learned(9, t, {}, { addedAt: 5 }), learned(3, t, {}, { addedAt: 5 }), learned(7, t, {}, { addedAt: 1 })], NOW);
    expect(q.items.map((i) => i.passageId)).toEqual([7, 3, 9]);
  });

  it('caps new verses at MAX_NEW_PER_DAY and offers the next one separately', () => {
    const q = todayQueue([1, 2, 3, 4, 5].map((i) => fresh(i)), NOW);
    expect(q.items).toHaveLength(MAX_NEW_PER_DAY);
    expect(q.nextNewAvailable?.passageId).toBe(4);
  });

  it('counts verses started earlier today against the cap', () => {
    const startedTodayVerse = pv(10, [
      rung('ordering', { attempts: 1, dueAt: NOW + DAY, lastPractisedAt: NOW - HOUR, firstPractisedAt: NOW - HOUR }),
    ]);
    const q = todayQueue([startedTodayVerse, fresh(1), fresh(2), fresh(3)], NOW);
    expect(q.items.map((i) => i.passageId)).toEqual([1, 2]);
    expect(q.nextNewAvailable?.passageId).toBe(3);
    expect(q.doneToday).toBe(1);
  });

  it('excludes verses done today, and they return the next day', () => {
    const p = pv(1, [
      rung('ordering', { attempts: 2, dueAt: NOW - HOUR, lastPractisedAt: NOW - 2 * HOUR, firstPractisedAt: NOW - 9 * DAY }),
      rung('blanks', { attempts: 1, dueAt: NOW - HOUR }),
    ]);
    const today = todayQueue([p], NOW);
    expect(today.items).toEqual([]);
    expect(today.doneToday).toBe(1);
    expect(today.upcoming).toEqual({ day: startOfLocalDay(NOW + DAY), count: 1 });
    const tomorrow = todayQueue([p], NOW + DAY);
    expect(tomorrow.items.map((i) => i.passageId)).toEqual([1]);
  });

  it('honours skipped', () => {
    const q = todayQueue([learned(1, NOW - HOUR), learned(2, NOW - HOUR)], NOW, { skipped: new Set([1]) });
    expect(q.items.map((i) => i.passageId)).toEqual([2]);
  });

  it('works on a focused subset and an empty scope', () => {
    const all = [learned(1, NOW - HOUR), learned(2, NOW - HOUR)];
    expect(todayQueue(all.slice(0, 1), NOW).totalVerses).toBe(1);
    const e = todayQueue([], NOW);
    expect(e).toMatchObject({ items: [], totalVerses: 0, doneToday: 0, upcoming: null, minutes: 0, nextNewAvailable: null });
  });

  it('all done: empty items, totalVerses > 0, upcoming is the earliest future day', () => {
    const q = todayQueue([learned(1, NOW + 3 * DAY), learned(2, NOW + 2 * DAY), learned(3, NOW + 2 * DAY + HOUR)], NOW);
    expect(q.items).toEqual([]);
    expect(q.totalVerses).toBe(3);
    expect(q.upcoming).toEqual({ day: startOfLocalDay(NOW + 2 * DAY), count: 2 });
  });

  it('flags paused verses and keeps them queued', () => {
    const q = todayQueue([learned(1, NOW - HOUR, { resume: { stepIndex: 2 } as never })], NOW);
    expect(q.items[0]?.paused).toBe(true);
  });

  it('estimates minutes (cap 12 verses each, at least 1)', () => {
    const one = todayQueue([fresh(1)], NOW);
    expect(one.minutes).toBe(1);
    const big = todayQueue([pv(1, fresh(1).rungs, { verseCount: 40 }), pv(2, fresh(2).rungs, { verseCount: 40 })], NOW);
    expect(big.minutes).toBe(12); // 24 verses * 30s
  });

  it('rolls over at midnight with the same data', () => {
    const p = pv(1, [
      rung('ordering', { attempts: 2, dueAt: NOW + 2 * HOUR, lastPractisedAt: NOW - HOUR, firstPractisedAt: NOW - 9 * DAY }),
    ]);
    const before = new Date(2026, 5, 10, 23, 0, 0).getTime();
    const after = new Date(2026, 5, 11, 1, 0, 0).getTime();
    expect(todayQueue([p], before).items).toEqual([]); // not yet due
    const next = todayQueue([p], after);
    expect(next.items.map((i) => i.passageId)).toEqual([1]);
    expect(next.doneToday).toBe(0);
  });

  it('never picks an inapplicable rung', () => {
    const p = pv(1, [
      rung('refmatch', { applicable: false, attempts: 1, dueAt: NOW - DAY }),
      rung('blanks', { attempts: 1, dueAt: NOW - HOUR }),
    ]);
    expect(todayQueue([p], NOW).items[0]?.rung).toBe('blanks');
    const none = pv(2, [rung('refmatch', { applicable: false })]);
    expect(todayQueue([none], NOW).items).toEqual([]);
  });
});

describe('anywayOrder', () => {
  it('lists due (even if done today) first, then verses still being learned, then new verses last, skipping visited', () => {
    const doneDue = pv(1, [
      rung('ordering', { attempts: 2, dueAt: NOW - HOUR, lastPractisedAt: NOW - 2 * HOUR }),
    ]);
    const later = learned(2, NOW + 5 * DAY);
    const sooner = learned(3, NOW + DAY);
    const unscheduled = pv(4, [rung('ordering', { attempts: 1, dueAt: null })]);
    const visited = learned(5, NOW - 2 * HOUR);
    const q = anywayOrder([unscheduled, later, fresh(6), sooner, doneDue, visited], NOW, new Set([5]));
    // 2, 3 and 4 are all 0% finished: oldest added first.
    expect(q.map((i) => i.passageId)).toEqual([1, 2, 3, 4, 6]);
    expect(q.map((i) => i.kind)).toEqual(['review', 'review', 'review', 'review', 'new']);
  });

  it('leaves out learned verses whose review is not due, keeps them once due', () => {
    const known = (id: number, dueAt: number) =>
      pv(id, [rung('ordering', { attempts: 3, level: 5, dueAt, lastPractisedAt: NOW - 3 * DAY, firstPractisedAt: NOW - 30 * DAY })], { wellLearned: true });
    expect(anywayOrder([known(1, NOW + 4 * DAY)], NOW, new Set())).toEqual([]);
    expect(anywayOrder([known(1, NOW + 4 * DAY), known(2, NOW - HOUR)], NOW, new Set()).map((i) => i.passageId)).toEqual([2]);
  });

  it('orders verses being learned closest to finished first, at their next unfinished activity', () => {
    const at = (level: number) => ({ attempts: 2, level, dueAt: NOW + 3 * DAY, lastPractisedAt: NOW - DAY, firstPractisedAt: NOW - 9 * DAY });
    // Ordering finished, blanks not: 1 of 3.
    const third = pv(1, [rung('ordering', at(5)), rung('blanks', at(2)), rung('firstletters', at(1))]);
    // Blanks finished (carries ordering down): 2 of 3; next is first letters, not the lower-level ordering.
    const twoThirds = pv(2, [rung('ordering', at(1)), rung('blanks', at(4)), rung('firstletters', at(1))]);
    const q = anywayOrder([third, twoThirds], NOW, new Set());
    expect(q.map((i) => [i.passageId, i.rung])).toEqual([[2, 'firstletters'], [1, 'blanks']]);
  });

  it('is not capped at MAX_NEW_PER_DAY', () => {
    const news = Array.from({ length: MAX_NEW_PER_DAY + 2 }, (_, i) => fresh(i + 1));
    expect(anywayOrder(news, NOW, new Set())).toHaveLength(MAX_NEW_PER_DAY + 2);
  });
});

describe('nextUnfinishedRung', () => {
  it('skips satisfied activities and inapplicable or optional ones', () => {
    expect(nextUnfinishedRung([rung('ordering', { level: 4 }), rung('blanks', { level: 1 })])).toBe('blanks');
    expect(nextUnfinishedRung([rung('ordering', { level: 0 }), rung('firstletters', { level: 5 }), rung('refmatch', { level: 2 })])).toBe('refmatch');
    expect(nextUnfinishedRung([rung('ordering', { applicable: false }), rung('recite', { level: 0 })])).toBeNull();
  });
});

describe('anywayOrder with only new verses', () => {
  it('is not empty: new verses come last', () => {
    expect(anywayOrder([fresh(6), fresh(7)], NOW, new Set()).map((i) => i.passageId)).toEqual([6, 7]);
  });
});

describe('todayQueue startedToday option', () => {
  it('counts the new-verse cap from the supplied all-lists number', () => {
    const news = [fresh(1), fresh(2), fresh(3), fresh(4)];
    expect(todayQueue(news, NOW).newCount).toBe(3);
    const q = todayQueue(news, NOW, { startedToday: 2 });
    expect(q.newCount).toBe(1);
    expect(q.nextNewAvailable?.passageId).toBe(2);
    expect(todayQueue(news, NOW, { startedToday: 3 }).items).toEqual([]);
  });
});

describe('pickSuggestedRung', () => {
  it('matches suggestedRung over the same candidates', () => {
    const rungs = [
      rung('ordering', { level: 4 }),
      rung('blanks', { level: 1 }),
      rung('firstletters', { level: 0, dueAt: NOW - HOUR }),
    ];
    const cands = rungs.map((r) => ({ rung: r.rung, dueAt: r.dueAt, level: r.level }));
    expect(pickSuggestedRung(cands, NOW)).toBe(suggestedRung(rungs, NOW));
    expect(pickSuggestedRung(cands, NOW)).toBe('firstletters');
    expect(pickSuggestedRung([], NOW)).toBeNull();
  });
});

describe('re-exports', () => {
  it('format.ts re-exports the moved helpers', () => {
    expect(fmtStart).toBe(startOfLocalDay);
  });
});

describe('todayQueue new-verse order across lists (design 4e)', () => {
  const inList = (id: number, listId: number, addedAt: number, position?: number | null) => {
    const v = fresh(id, addedAt);
    v.passage.collectionId = listId;
    if (position !== undefined) v.passage.position = position;
    return v;
  };
  const ids = (q: ReturnType<typeof todayQueue>) => [...q.items.map((i) => i.passageId), ...(q.nextNewAvailable ? [q.nextNewAvailable.passageId] : [])];

  it('unset positions: oldest added first across lists (migrated fixture unchanged)', () => {
    const ps = [inList(1, 1, 50), inList(2, 2, 10), inList(3, 1, 30), inList(4, 2, 20)];
    expect(ids(todayQueue(ps, NOW))).toEqual([2, 4, 3, 1]);
    const withPositions = ps.map((p, i) => ({ ...p, passage: { ...p.passage, position: [3, 1, 2, 2][i]! } }));
    // positions that agree with addedAt within each list leave the queue unchanged
    expect(ids(todayQueue(withPositions, NOW))).toEqual([2, 4, 3, 1]);
  });

  it('position reorders within a list only; lists merge by head addedAt', () => {
    // list 1: id1 (added 10, pos 2), id3 (added 30, pos 1) -> sequence 3, 1; list 2: id2 (added 20)
    const ps = [inList(1, 1, 10, 2), inList(2, 2, 20, 1), inList(3, 1, 30, 1)];
    // heads: 3 (30) vs 2 (20) -> 2 first, then 3 (30) vs nothing -> 3, then 1
    expect(ids(todayQueue(ps, NOW))).toEqual([2, 3, 1]);
  });
});
