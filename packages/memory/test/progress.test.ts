import { describe, it, expect } from 'vitest';
import { BLOCK_RUNGS, activityBlocks, needRank, overallProgress, sortByNeed } from '../src/core/progress';
import { DAY, NOW, makePassageView, makeRung } from './helpers/planFactory';
import type { Rung, RungView } from '../src/core/types';

const all = (over: Partial<Record<Rung, Partial<RungView>>> = {}, gated = false): RungView[] =>
  (['ordering', 'refmatch', 'blanks', 'firstletters', 'refprovide', 'recite'] as Rung[]).map((r) =>
    makeRung(r, { applicable: gated ? !['refmatch', 'refprovide', 'recite'].includes(r) : r !== 'recite', ...over[r] }),
  );

describe('activityBlocks', () => {
  it('uses the fixed ladder order', () => {
    expect(BLOCK_RUNGS).toEqual(['ordering', 'refmatch', 'blanks', 'firstletters', 'refprovide', 'recite']);
  });

  it('single verse: ordering is not applicable (singleVerse)', () => {
    const pv = makePassageView({ rungs: all().filter((r) => r.rung !== 'ordering') });
    const b = activityBlocks(pv, { reciteShown: false });
    expect(b[0]).toMatchObject({ rung: 'ordering', state: 'notApplicable', naReason: 'singleVerse', startable: false });
  });

  it('omits gated reference rungs and hidden recite', () => {
    const b = activityBlocks(makePassageView({ rungs: all({}, true) }), { reciteShown: false });
    expect(b.map((x) => x.rung)).toEqual(['ordering', 'blanks', 'firstletters']);
  });

  it('includes reference rungs when applicable', () => {
    const b = activityBlocks(makePassageView({ rungs: all({ refmatch: { applicable: true }, refprovide: { applicable: true } }) }), { reciteShown: false });
    expect(b.map((x) => x.rung)).toEqual(['ordering', 'refmatch', 'blanks', 'firstletters', 'refprovide']);
  });

  it('shows recite when asked; not applicable gives speech reason', () => {
    const pv = makePassageView({ rungs: all({}, true) });
    const b = activityBlocks(pv, { reciteShown: true });
    expect(b[b.length - 1]).toMatchObject({ rung: 'recite', state: 'notApplicable', naReason: 'speech' });
    const ok = activityBlocks(makePassageView({ rungs: all({ recite: { applicable: true } }, true) }), { reciteShown: true });
    expect(ok[ok.length - 1]).toMatchObject({ rung: 'recite', state: 'notStarted', startable: true });
  });

  it('states: notStarted, practicing, complete; carry-down sets coveredBy', () => {
    const pv = makePassageView({
      rungs: all({ ordering: { attempts: 1, level: 2 }, blanks: { attempts: 0 }, firstletters: { attempts: 3, level: 4, tiersPassed: 2 } }, true),
    });
    const b = activityBlocks(pv, { reciteShown: false });
    expect(b.find((x) => x.rung === 'ordering')).toMatchObject({ state: 'complete', coveredBy: 'firstletters' });
    const mid = activityBlocks(makePassageView({ rungs: all({ ordering: { attempts: 1, level: 2 } }, true) }), { reciteShown: false });
    expect(mid.find((x) => x.rung === 'ordering')?.state).toBe('practicing');
    expect(b.find((x) => x.rung === 'blanks')).toMatchObject({ state: 'complete', coveredBy: 'firstletters' });
    expect(b.find((x) => x.rung === 'firstletters')).toMatchObject({ state: 'complete', coveredBy: null, tiersPassed: 2 });
    const fresh = activityBlocks(makePassageView({ rungs: all({}, true) }), { reciteShown: false });
    expect(fresh.every((x) => x.state === 'notStarted')).toBe(true);
  });
});

describe('needRank / sortByNeed', () => {
  const learning = (id: number, over: Partial<Record<Rung, Partial<RungView>>>, extra = {}) =>
    makePassageView({ id, rungs: all(over, true), ...extra });
  const dueRung = { attempts: 1, level: 1, dueAt: NOW - DAY };

  it('orders by group: due, learning, new, known', () => {
    const known = learning(1, { blanks: { attempts: 3, level: 4, dueAt: NOW + 5 * DAY }, ordering: { attempts: 3, level: 4, dueAt: NOW + 5 * DAY }, firstletters: { attempts: 3, level: 4, dueAt: NOW + 5 * DAY } }, { wellLearned: true });
    const fresh = makePassageView({ id: 2, rungs: all({}, true) });
    const partial = learning(3, { blanks: { attempts: 1, level: 1, dueAt: NOW + DAY } });
    const due = learning(4, { blanks: dueRung });
    const sorted = sortByNeed([known, fresh, partial, due], NOW);
    expect(sorted.map((p) => p.passage.id)).toEqual([4, 3, 2, 1]);
    expect(needRank(due, NOW)[0]).toBe(0);
    expect(needRank(partial, NOW)[0]).toBe(1);
    expect(needRank(fresh, NOW)[0]).toBe(2);
    expect(needRank(known, NOW)[0]).toBe(3);
  });

  it('due but done today goes to the learning group', () => {
    const p = learning(1, { blanks: { ...dueRung, lastPractisedAt: NOW - 1000 } });
    expect(needRank(p, NOW)[0]).toBe(1);
  });

  it('new verses sort by position, null last, then addedAt', () => {
    const a = makePassageView({ id: 1, addedAt: 1, position: 2, rungs: all({}, true) });
    const b = makePassageView({ id: 2, addedAt: 2, position: 1, rungs: all({}, true) });
    const c = makePassageView({ id: 3, addedAt: 0, position: null, rungs: all({}, true) });
    expect(sortByNeed([a, c, b], NOW).map((p) => p.passage.id)).toEqual([2, 1, 3]);
  });

  it('learning group: less complete first', () => {
    const lo = learning(1, { blanks: { attempts: 1, level: 1, dueAt: NOW + DAY } });
    const hi = learning(2, { blanks: { attempts: 3, level: 4, dueAt: NOW + DAY }, ordering: { attempts: 3, level: 4, dueAt: NOW + DAY }, firstletters: { attempts: 1, level: 1, dueAt: NOW + DAY } });
    expect(sortByNeed([hi, lo], NOW).map((p) => p.passage.id)).toEqual([1, 2]);
  });
});

describe('overallProgress', () => {
  it('empty', () => {
    expect(overallProgress([])).toEqual({ done: 0, units: 0, percent: 0, versesLearned: 0, verses: 0 });
  });
  it('floors the percent and counts learned verses', () => {
    const done = makePassageView({ id: 1, wellLearned: true, rungs: all({ ordering: { level: 4 }, blanks: { level: 4 }, firstletters: { level: 4 } }, true) });
    const none = makePassageView({ id: 2, rungs: all({}, true) });
    // done: all 3 satisfied. none: 0 of 3. 3/6 = 50
    expect(overallProgress([done, none])).toEqual({ done: 3, units: 6, percent: 50, versesLearned: 1, verses: 2 });
    const third = makePassageView({ id: 3, rungs: all({ firstletters: { level: 4 } }, true) });
    // firstletters satisfied plus carry-down covers ordering and blanks: 3 of 3 -> 100
    expect(overallProgress([third]).percent).toBe(100);
    const one = makePassageView({ id: 4, rungs: all({ blanks: { level: 4 } }, true) });
    // blanks + ordering (carry-down) = 2 of 3 -> 66
    expect(overallProgress([one]).percent).toBe(66);
  });
  it('ignores recite and gated rungs', () => {
    const pv = makePassageView({ rungs: all({ recite: { applicable: true, level: 4 } }, true) });
    expect(overallProgress([pv]).units).toBe(3);
  });
});
