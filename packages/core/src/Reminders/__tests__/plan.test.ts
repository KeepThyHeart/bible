import { describe, expect, it } from 'vitest';
import {
  endOfQuietHours,
  expandPlan,
  firesBetween,
  isInQuietHours,
  nextFireAt,
  spreadInWindow,
} from '../plan';
import type { ReminderPlan } from '../types';

const NY = 'America/New_York';
const LON = 'Europe/London';
const DAY = 86_400_000;
const MIN = 60_000;
const ALL = [0, 1, 2, 3, 4, 5, 6] as const;
const iso = (t: number) => new Date(t).toISOString();
const z = (s: string) => Date.parse(s);
const isos = (fires: { at: number }[]) => fires.map((f) => iso(f.at));

const daily = (time: string, id = 'd'): ReminderPlan => ({ slots: [{ id, kind: 'fixed', time, days: [...ALL] }] });

describe('expandPlan: fixed, weekly, date slots', () => {
  it('fires a daily slot once a day over three days in New York', () => {
    const fires = expandPlan(daily('08:00'), z('2026-01-10T00:00:00Z'), 3 * DAY, NY);
    expect(isos(fires)).toEqual(['2026-01-10T13:00:00.000Z', '2026-01-11T13:00:00.000Z', '2026-01-12T13:00:00.000Z']);
    expect(fires.map((f) => f.date)).toEqual(['2026-01-10', '2026-01-11', '2026-01-12']);
    expect(fires.every((f) => f.slotId === 'd')).toBe(true);
  });

  it('fires a weekly slot only on its weekday', () => {
    // 2026-01-14 is a Wednesday (3).
    const plan: ReminderPlan = { slots: [{ id: 'w', kind: 'fixed', time: '09:00', days: [3] }] };
    const fires = expandPlan(plan, z('2026-01-12T00:00:00Z'), 17 * DAY, 'UTC');
    expect(isos(fires)).toEqual(['2026-01-14T09:00:00.000Z', '2026-01-21T09:00:00.000Z', '2026-01-28T09:00:00.000Z']);
  });

  it('never fires with empty days', () => {
    const plan: ReminderPlan = { slots: [{ id: 'x', kind: 'fixed', time: '09:00', days: [] }] };
    expect(expandPlan(plan, z('2026-01-12T00:00:00Z'), 30 * DAY, 'UTC')).toEqual([]);
  });

  it('fires a date slot once on its date only', () => {
    const plan: ReminderPlan = { slots: [{ id: 'o', kind: 'date', date: '2026-02-03', time: '12:15' }] };
    const fires = expandPlan(plan, z('2026-01-01T00:00:00Z'), 90 * DAY, NY);
    expect(isos(fires)).toEqual(['2026-02-03T17:15:00.000Z']);
    expect(fires[0].date).toBe('2026-02-03');
  });

  it('returns nothing for a zero horizon or an empty plan', () => {
    expect(expandPlan(daily('08:00'), 0, 0, 'UTC')).toEqual([]);
    expect(expandPlan({ slots: [] }, 0, 5 * DAY, 'UTC')).toEqual([]);
  });

  it('includes `from` and excludes `from + horizon`', () => {
    const at = z('2026-01-10T08:00:00Z');
    expect(expandPlan(daily('08:00'), at, DAY, 'UTC').map((f) => f.at)).toEqual([at]);
    expect(expandPlan(daily('08:00'), at - DAY, DAY, 'UTC').map((f) => f.at)).toEqual([at - DAY]);
  });
});

describe('expandPlan: daylight saving', () => {
  it('New York spring forward: 02:30 fires at 03:00 EDT that day and 02:30 around it', () => {
    const fires = expandPlan(daily('02:30'), z('2026-03-07T00:00:00Z'), 3 * DAY, NY);
    expect(isos(fires)).toEqual([
      '2026-03-07T07:30:00.000Z', // 02:30 EST
      '2026-03-08T07:00:00.000Z', // gap: 03:00 EDT
      '2026-03-09T06:30:00.000Z', // 02:30 EDT
    ]);
  });

  it('New York fall back: 01:30 fires once, at the first occurrence', () => {
    const fires = expandPlan(daily('01:30'), z('2026-10-31T12:00:00Z'), 2 * DAY, NY);
    expect(isos(fires)).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-02T06:30:00.000Z',
    ]);
    expect(fires.filter((f) => f.date === '2026-11-01')).toHaveLength(1);
  });

  it('keeps 07:00 local across both New York transitions', () => {
    const spring = expandPlan(daily('07:00'), z('2026-03-07T00:00:00Z'), 3 * DAY, NY);
    expect(isos(spring)).toEqual([
      '2026-03-07T12:00:00.000Z',
      '2026-03-08T11:00:00.000Z',
      '2026-03-09T11:00:00.000Z',
    ]);
    const fall = expandPlan(daily('07:00'), z('2026-10-31T00:00:00Z'), 3 * DAY, NY);
    expect(isos(fall)).toEqual([
      '2026-10-31T11:00:00.000Z',
      '2026-11-01T12:00:00.000Z',
      '2026-11-02T12:00:00.000Z',
    ]);
  });

  it('Europe/London: 07:00 holds across both transitions; gap and overlap resolve per the rules', () => {
    const spring = expandPlan(daily('07:00'), z('2026-03-28T00:00:00Z'), 3 * DAY, LON);
    expect(isos(spring)).toEqual(['2026-03-28T07:00:00.000Z', '2026-03-29T06:00:00.000Z', '2026-03-30T06:00:00.000Z']);
    const fall = expandPlan(daily('07:00'), z('2026-10-24T00:00:00Z'), 3 * DAY, LON);
    expect(isos(fall)).toEqual(['2026-10-24T06:00:00.000Z', '2026-10-25T07:00:00.000Z', '2026-10-26T07:00:00.000Z']);
    // 01:30 on 2026-03-29 does not exist: first valid minute after the gap is 02:00 BST = 01:00Z.
    const gap = expandPlan(daily('01:30'), z('2026-03-29T00:00:00Z'), DAY, LON);
    expect(isos(gap)).toEqual(['2026-03-29T01:00:00.000Z']);
    // 01:30 on 2026-10-25 happens twice: the first (BST) is 00:30Z.
    const overlap = expandPlan(daily('01:30'), z('2026-10-25T00:00:00Z'), DAY, LON);
    expect(isos(overlap)).toEqual(['2026-10-25T00:30:00.000Z']);
  });
});

describe('quiet hours', () => {
  const wrap = { start: '21:30', end: '07:00' };

  it('drops fires inside a same-day range, keeps the end, drops the start', () => {
    const quiet = { start: '12:00', end: '13:00' };
    const plan: ReminderPlan = {
      quiet,
      slots: [
        { id: 'a', kind: 'fixed', time: '11:59', days: [...ALL] },
        { id: 'b', kind: 'fixed', time: '12:00', days: [...ALL] }, // start: dropped
        { id: 'c', kind: 'fixed', time: '12:30', days: [...ALL] }, // inside: dropped
        { id: 'd', kind: 'fixed', time: '13:00', days: [...ALL] }, // end: kept
      ],
    };
    const fires = expandPlan(plan, z('2026-01-10T00:00:00Z'), DAY, 'UTC');
    expect(fires.map((f) => f.slotId)).toEqual(['a', 'd']);
  });

  it('wrapping quiet hours: inside dropped on both sides of midnight, end kept, start dropped', () => {
    const plan: ReminderPlan = {
      quiet: wrap,
      slots: [
        { id: 'late', kind: 'fixed', time: '22:00', days: [...ALL] },
        { id: 'start', kind: 'fixed', time: '21:30', days: [...ALL] },
        { id: 'before', kind: 'fixed', time: '21:29', days: [...ALL] },
        { id: 'early', kind: 'fixed', time: '03:00', days: [...ALL] },
        { id: 'end', kind: 'fixed', time: '07:00', days: [...ALL] },
      ],
    };
    const fires = expandPlan(plan, z('2026-01-10T00:00:00Z'), DAY, 'UTC');
    expect(fires.map((f) => f.slotId)).toEqual(['end', 'before']);
  });

  it('start === end means no quiet hours', () => {
    const plan: ReminderPlan = { quiet: { start: '08:00', end: '08:00' }, slots: daily('08:00').slots };
    expect(expandPlan(plan, z('2026-01-10T00:00:00Z'), DAY, 'UTC')).toHaveLength(1);
    expect(isInQuietHours(z('2026-01-10T08:00:00Z'), { start: '08:00', end: '08:00' }, 'UTC')).toBe(false);
    expect(isInQuietHours(z('2026-01-10T03:00:00Z'), { start: '08:00', end: '08:00' }, 'UTC')).toBe(false);
  });

  it('isInQuietHours: boundaries are [start, end) and use the zone', () => {
    expect(isInQuietHours(z('2026-01-10T21:30:00Z'), wrap, 'UTC')).toBe(true);
    expect(isInQuietHours(z('2026-01-10T21:29:59Z'), wrap, 'UTC')).toBe(false);
    expect(isInQuietHours(z('2026-01-10T07:00:00Z'), wrap, 'UTC')).toBe(false);
    expect(isInQuietHours(z('2026-01-10T06:59:00Z'), wrap, 'UTC')).toBe(true);
    // 03:00Z is 22:00 the previous evening in New York (EST).
    expect(isInQuietHours(z('2026-01-11T03:00:00Z'), wrap, NY)).toBe(true);
    expect(isInQuietHours(z('2026-01-11T03:00:00Z'), undefined, NY)).toBe(false);
  });

  it('endOfQuietHours: before midnight -> next day end; after midnight -> same day end; outside -> same instant', () => {
    expect(iso(endOfQuietHours(z('2026-01-10T23:00:00Z'), wrap, 'UTC'))).toBe('2026-01-11T07:00:00.000Z');
    expect(iso(endOfQuietHours(z('2026-01-11T02:00:00Z'), wrap, 'UTC'))).toBe('2026-01-11T07:00:00.000Z');
    const outside = z('2026-01-11T12:00:00Z');
    expect(endOfQuietHours(outside, wrap, 'UTC')).toBe(outside);
    expect(endOfQuietHours(outside, undefined, 'UTC')).toBe(outside);
    // exactly at start is inside
    expect(iso(endOfQuietHours(z('2026-01-10T21:30:00Z'), wrap, 'UTC'))).toBe('2026-01-11T07:00:00.000Z');
    // exactly at end is outside
    const atEnd = z('2026-01-11T07:00:00Z');
    expect(endOfQuietHours(atEnd, wrap, 'UTC')).toBe(atEnd);
  });

  it('endOfQuietHours across DST nights in New York', () => {
    // Fall back night (2026-11-01): 23:00 EDT on Oct 31 = 03:00Z; end is 07:00 EST = 12:00Z.
    expect(iso(endOfQuietHours(z('2026-11-01T03:00:00Z'), wrap, NY))).toBe('2026-11-01T12:00:00.000Z');
    // 00:30 EDT (04:30Z) Nov 1: same-day end.
    expect(iso(endOfQuietHours(z('2026-11-01T04:30:00Z'), wrap, NY))).toBe('2026-11-01T12:00:00.000Z');
    // 01:30 EST, the second occurrence (06:30Z), same.
    expect(iso(endOfQuietHours(z('2026-11-01T06:30:00Z'), wrap, NY))).toBe('2026-11-01T12:00:00.000Z');
    // Spring forward night (2026-03-08): 23:00 EST Mar 7 = 04:00Z; end is 07:00 EDT = 11:00Z.
    expect(iso(endOfQuietHours(z('2026-03-08T04:00:00Z'), wrap, NY))).toBe('2026-03-08T11:00:00.000Z');
    // 03:30 EDT (07:30Z) is inside: ends 11:00Z.
    expect(iso(endOfQuietHours(z('2026-03-08T07:30:00Z'), wrap, NY))).toBe('2026-03-08T11:00:00.000Z');
  });
});

describe('maxPerDay and merging', () => {
  const three: ReminderPlan = {
    maxPerDay: 2,
    slots: [
      { id: 'c', kind: 'fixed', time: '17:00', days: [...ALL] },
      { id: 'a', kind: 'fixed', time: '09:00', days: [...ALL] },
      { id: 'b', kind: 'fixed', time: '13:00', days: [...ALL] },
    ],
  };

  it('keeps the earliest N per local day', () => {
    const fires = expandPlan(three, z('2026-01-10T00:00:00Z'), 2 * DAY, 'UTC');
    expect(fires.map((f) => f.slotId)).toEqual(['a', 'b', 'a', 'b']);
  });

  it('counts fires earlier the same day when `from` is mid-day', () => {
    const fires = expandPlan(three, z('2026-01-10T12:00:00Z'), DAY, 'UTC');
    // Day 10: a(09:00) and b(13:00) are the two allowed; c is cut. Day 11: a at 09:00.
    expect(isos(fires)).toEqual(['2026-01-10T13:00:00.000Z', '2026-01-11T09:00:00.000Z']);
    // From 14:00 nothing is left on the 10th (the cap was used by earlier slots).
    expect(expandPlan(three, z('2026-01-10T14:00:00Z'), 3 * 3_600_000, 'UTC')).toEqual([]);
  });

  it('maxPerDay 0 yields nothing', () => {
    expect(expandPlan({ ...three, maxPerDay: 0 }, z('2026-01-10T00:00:00Z'), 3 * DAY, 'UTC')).toEqual([]);
  });

  it('merges two slots at the same instant into one fire', () => {
    const plan: ReminderPlan = {
      slots: [
        { id: 'one', kind: 'fixed', time: '08:00', days: [...ALL] },
        { id: 'two', kind: 'fixed', time: '08:00', days: [...ALL] },
      ],
    };
    const fires = expandPlan(plan, z('2026-01-10T00:00:00Z'), DAY, 'UTC');
    expect(fires).toHaveLength(1);
    expect(fires[0].slotId).toBe('one');
  });

  it('a merged pair counts once toward maxPerDay', () => {
    const plan: ReminderPlan = {
      maxPerDay: 2,
      slots: [
        { id: 'one', kind: 'fixed', time: '08:00', days: [...ALL] },
        { id: 'two', kind: 'fixed', time: '08:00', days: [...ALL] },
        { id: 'three', kind: 'fixed', time: '09:00', days: [...ALL] },
      ],
    };
    expect(expandPlan(plan, z('2026-01-10T00:00:00Z'), DAY, 'UTC')).toHaveLength(2);
  });
});

describe('window slots', () => {
  const win = (over: Record<string, unknown> = {}): ReminderPlan => ({
    slots: [{ id: 'w', kind: 'window', start: '09:00', end: '17:00', count: 4, days: [...ALL], ...over } as never],
  });
  const times = (plan: ReminderPlan, from: string, days: number, seed = '') =>
    expandPlan(plan, z(from), days * DAY, 'UTC', { seed });

  it('respects count, bounds and the minimum gap', () => {
    const fires = times(win(), '2026-01-10T00:00:00Z', 20);
    const byDate = new Map<string, number[]>();
    for (const f of fires) byDate.set(f.date, [...(byDate.get(f.date) ?? []), f.at]);
    expect(byDate.size).toBe(20);
    for (const [date, ats] of byDate) {
      expect(ats).toHaveLength(4);
      const start = z(`${date}T09:00:00Z`);
      const end = z(`${date}T17:00:00Z`);
      for (const at of ats) {
        expect(at).toBeGreaterThanOrEqual(start);
        expect(at).toBeLessThanOrEqual(end);
      }
      for (let i = 1; i < ats.length; i++) expect(ats[i] - ats[i - 1]).toBeGreaterThanOrEqual(45 * MIN);
    }
  });

  it('honours a custom minGapMinutes', () => {
    const fires = times(win({ minGapMinutes: 100, count: 5 }), '2026-01-10T00:00:00Z', 10);
    const byDate = new Map<string, number[]>();
    for (const f of fires) byDate.set(f.date, [...(byDate.get(f.date) ?? []), f.at]);
    for (const ats of byDate.values()) {
      expect(ats).toHaveLength(5);
      for (let i = 1; i < ats.length; i++) expect(ats[i] - ats[i - 1]).toBeGreaterThanOrEqual(100 * MIN);
    }
  });

  it('yields fewer fires when the window is too short for count at the gap', () => {
    const fires = times(win({ start: '08:00', end: '08:50', count: 5 }), '2026-01-10T00:00:00Z', 1);
    expect(fires).toHaveLength(2);
  });

  it('is deterministic for the same seed and date, and varies with seed and date', () => {
    const a = times(win(), '2026-01-10T00:00:00Z', 1, 'seed-1').map((f) => f.at);
    const again = times(win(), '2026-01-10T00:00:00Z', 1, 'seed-1').map((f) => f.at);
    expect(again).toEqual(a);
    const otherSeed = times(win(), '2026-01-10T00:00:00Z', 1, 'seed-2').map((f) => f.at);
    expect(otherSeed).not.toEqual(a);
    const nextDay = times(win(), '2026-01-11T00:00:00Z', 1, 'seed-1').map((f) => f.at - DAY);
    expect(nextDay).not.toEqual(a);
  });

  it('wrapping window (22:00-01:00) yields fires after midnight attributed to the start day', () => {
    const plan = win({ start: '22:00', end: '01:00', count: 3 });
    const fires = times(plan, '2026-01-10T00:00:00Z', 30);
    let after = 0;
    for (const f of fires) {
      const start = z(`${f.date}T22:00:00Z`);
      expect(f.at).toBeGreaterThanOrEqual(start);
      expect(f.at).toBeLessThanOrEqual(start + 3 * 3_600_000);
      if (f.at >= start + 2 * 3_600_000) after++;
    }
    expect(fires.length).toBeGreaterThanOrEqual(90 - 3);
    expect(after).toBeGreaterThan(0);
    expect(fires.some((f) => f.at >= z(`${f.date}T00:00:00Z`) + DAY)).toBe(true);
  });

  it('does not change when the query `from` moves within the day', () => {
    const plan = win({ start: '22:00', end: '01:00', count: 3 });
    const all = times(plan, '2026-01-10T00:00:00Z', 3, 'k');
    for (const from of ['2026-01-10T06:00:00Z', '2026-01-10T23:00:00Z', '2026-01-11T00:10:00Z', '2026-01-11T12:00:00Z']) {
      const sub = expandPlan(plan, z(from), z('2026-01-13T00:00:00Z') - z(from), 'UTC', { seed: 'k' });
      expect(sub.map((f) => f.at)).toEqual(all.filter((f) => f.at >= z(from)).map((f) => f.at));
    }
  });

  it('plan-level quiet hours drop window fires and the cap applies after them', () => {
    const plan: ReminderPlan = { ...win({ count: 6, minGapMinutes: 0 }), quiet: { start: '09:00', end: '13:00' }, maxPerDay: 2 };
    const fires = times(plan, '2026-01-10T00:00:00Z', 10);
    for (const f of fires) {
      const h = new Date(f.at).getUTCHours();
      expect(h < 9 || h >= 13).toBe(true);
    }
    const perDay = new Map<string, number>();
    for (const f of fires) perDay.set(f.date, (perDay.get(f.date) ?? 0) + 1);
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(2);
  });
});

describe('spreadInWindow', () => {
  it('hits the lower bound with rng 0 and the upper bound with rng ~1', () => {
    expect(spreadInWindow(60, 180, 3, 45, () => 0)).toEqual([60, 105, 150]);
    expect(spreadInWindow(60, 180, 3, 45, () => 0.9999999)).toEqual([90, 135, 180]);
    expect(spreadInWindow(60, 180, 1, 45, () => 0)).toEqual([60]);
    expect(spreadInWindow(60, 180, 1, 45, () => 0.9999999)).toEqual([180]);
  });

  it('returns nothing for a negative length or count below 1, and caps by what fits', () => {
    expect(spreadInWindow(100, 50, 3, 10, () => 0)).toEqual([]);
    expect(spreadInWindow(0, 100, 0, 10, () => 0)).toEqual([]);
    expect(spreadInWindow(0, 50, 5, 45, () => 0)).toEqual([0, 45]);
  });
});

describe('nextFireAt and firesBetween', () => {
  it('nextFireAt is strictly after now', () => {
    const now = z('2026-01-10T08:00:00Z');
    expect(iso(nextFireAt(daily('08:00'), now, 'UTC')!.at)).toBe('2026-01-11T08:00:00.000Z');
    expect(iso(nextFireAt(daily('08:00'), now - 1, 'UTC')!.at)).toBe('2026-01-10T08:00:00.000Z');
  });

  it('finds a weekly fire up to a week ahead and returns null when there is none', () => {
    const plan: ReminderPlan = { slots: [{ id: 'w', kind: 'fixed', time: '09:00', days: [3] }] };
    // Thursday 2026-01-15 10:00: next Wednesday is 01-21.
    expect(iso(nextFireAt(plan, z('2026-01-15T10:00:00Z'), 'UTC')!.at)).toBe('2026-01-21T09:00:00.000Z');
    expect(nextFireAt({ slots: [] }, 0, 'UTC')).toBeNull();
    expect(nextFireAt(plan, z('2026-01-15T10:00:00Z'), 'UTC', { lookaheadMs: 2 * DAY })).toBeNull();
  });

  it('firesBetween is (after, upTo]', () => {
    const t8 = z('2026-01-10T08:00:00Z');
    expect(firesBetween(daily('08:00'), t8, t8 + DAY, 'UTC').map((f) => f.at)).toEqual([t8 + DAY]);
    expect(firesBetween(daily('08:00'), t8 - 1, t8, 'UTC').map((f) => f.at)).toEqual([t8]);
    expect(firesBetween(daily('08:00'), t8, t8, 'UTC')).toEqual([]);
    expect(firesBetween(daily('08:00'), t8 + 1, t8, 'UTC')).toEqual([]);
  });
});
