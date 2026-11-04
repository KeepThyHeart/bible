import { describe, expect, it } from 'vitest';
import type { PlanDefinition } from './types';
import { indexCompletions } from './scheduler';
import { blockPlacement, flattenPlan, nextReadingAfter, overdueReadings, readingNeighbours } from './cursor';
import { vid } from './versification';

const r = (b: number, c1: number, v1: number, c2: number, v2: number) => ({ start: vid(b, c1, v1), end: vid(b, c2, v2) });
const plan: PlanDefinition = {
  key: 'user:t', version: 1, name: 'T', source: 'user',
  days: [
    { readings: [r(1, 1, 1, 3, 24)] },
    { readings: [r(1, 4, 1, 6, 8), r(19, 1, 1, 1, 6)] },
    { readings: [r(1, 7, 1, 9, 29)] },
    { readings: [r(1, 10, 1, 12, 20)] },
  ],
};

describe('flattenPlan / neighbours', () => {
  it('lists readings in order with day and index', () => {
    expect(flattenPlan(plan).map((x) => [x.day, x.index])).toEqual([[1, 0], [2, 0], [2, 1], [3, 0], [4, 0]]);
  });
  it('steps outside the day block', () => {
    const n = readingNeighbours(plan, 2);
    expect(n.previous).toMatchObject({ day: 1, index: 0 });
    expect(n.next).toMatchObject({ day: 3, index: 0 });
  });
  it('has no previous on the first day and no next on the last', () => {
    expect(readingNeighbours(plan, 1).previous).toBeNull();
    expect(readingNeighbours(plan, 4).next).toBeNull();
    expect(readingNeighbours(plan, 99)).toEqual({ previous: null, next: null });
  });
});

describe('overdueReadings', () => {
  it('collects only unread readings of the missed days, oldest first', () => {
    const progress = indexCompletions([{ enrollmentId: 'e', day: 2, reading: 0, at: 'x', via: 'manual' }]);
    const out = overdueReadings(plan, progress, [3, 2, 1]);
    expect(out.map((x) => [x.day, x.index])).toEqual([[1, 0], [2, 1], [3, 0]]);
  });
  it('is empty with no missed days', () => {
    expect(overdueReadings(plan, new Map(), [])).toEqual([]);
  });
});

describe('nextReadingAfter', () => {
  it('goes to the next passage of the same day first', () => {
    expect(nextReadingAfter(plan, 2, 0)).toMatchObject({ day: 2, index: 1 });
  });
  it('then to the first reading of the next day', () => {
    expect(nextReadingAfter(plan, 2, 1)).toMatchObject({ day: 3, index: 0 });
  });
  it('is null after the last reading', () => {
    expect(nextReadingAfter(plan, 4, 0)).toBeNull();
  });
});

describe('blockPlacement', () => {
  const ch1 = [vid(1, 1, 1), vid(1, 1, 2), vid(1, 1, 3)];
  const place = (reading: { start: number; end: number }, ids: number[]) =>
    ids.map((id, i) => blockPlacement(reading, id, ids[i - 1] ?? null, ids[i + 1] ?? null));

  it('multi-chapter reading: start in the first chapter only, end in the last only', () => {
    const reading = r(1, 1, 1, 3, 24);
    const first = place(reading, ch1);
    expect(first.map((p) => p.start)).toEqual([true, false, false]);
    expect(first.some((p) => p.end)).toBe(false);
    const last = [vid(1, 3, 23), vid(1, 3, 24)];
    const lp = place(reading, last);
    expect(lp.some((p) => p.start)).toBe(false);
    expect(lp.map((p) => p.end)).toEqual([false, true]);
    const mid = place(reading, [vid(1, 2, 1), vid(1, 2, 2)]);
    expect(mid.some((p) => p.start || p.end)).toBe(false);
  });

  it('mid-chapter start and end', () => {
    const reading = r(1, 1, 2, 1, 2);
    expect(place(reading, ch1)).toEqual([{ start: false, end: false }, { start: true, end: true }, { start: false, end: false }]);
  });

  it('start falls on the next verse when the exact start verse is missing in the translation', () => {
    const reading = { start: vid(1, 1, 2), end: vid(1, 1, 3) };
    expect(place(reading, [vid(1, 1, 1), vid(1, 1, 3)]).map((p) => p.start)).toEqual([false, true]);
  });

  it('end block lands on the last verse when the reading runs past the chapter', () => {
    const reading = r(1, 1, 1, 1, 31);
    const ids = [vid(1, 1, 30), vid(1, 1, 31)];
    expect(place(reading, ids).map((p) => p.end)).toEqual([false, true]);
  });
});
