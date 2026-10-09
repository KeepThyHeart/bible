/**
 * Reminder plan expansion tests.
 *
 * All use a fixed-offset calendar (UTC) so results do not depend on the
 * machine's zone. DST is exercised through a stub calendar that copies the
 * `Date` constructor's behaviour for a skipped and a repeated wall time.
 */

import { describe, it, expect } from 'vitest';
import {
  expandPlan,
  nextAllowed,
  reconcileMissed,
  parseWallTime,
  formatWallTime,
  inQuiet,
  fixedOffsetCalendar,
  MIN_WINDOW_GAP_MIN,
  type Calendar,
} from '../src/core/reminderPlan';
import type { ReminderPlan, Weekday } from '../src/core/pushTypes';

const cal = fixedOffsetCalendar(0);
const HOUR = 3600_000;
const DAY = 24 * HOUR;
// Monday 2026-09-28 00:00 UTC.
const MON = Date.UTC(2026, 8, 28);
const ALL: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const at = (day: number, h: number, m = 0) => MON + day * DAY + h * HOUR + m * 60_000;

function plan(p: Partial<ReminderPlan>): ReminderPlan {
  return { slots: [], maxPerDay: 12, ...p };
}

describe('parseWallTime / formatWallTime', () => {
  it('parses valid times', () => {
    expect(parseWallTime('07:05')).toEqual({ h: 7, m: 5 });
    expect(parseWallTime('23:59')).toEqual({ h: 23, m: 59 });
    expect(parseWallTime('00:00')).toEqual({ h: 0, m: 0 });
  });
  it('rejects malformed times', () => {
    for (const s of ['24:00', '7:5x', '', '12:60', '7:30', 'noon']) expect(parseWallTime(s)).toBeNull();
  });
  it('formats with padding', () => {
    expect(formatWallTime(7, 5)).toBe('07:05');
  });
});

describe('inQuiet', () => {
  it('handles a same-day range as [start, end)', () => {
    const q = { start: '13:00', end: '15:00' };
    expect(inQuiet(13 * 60, q)).toBe(true);
    expect(inQuiet(14 * 60 + 59, q)).toBe(true);
    expect(inQuiet(15 * 60, q)).toBe(false);
    expect(inQuiet(12 * 60 + 59, q)).toBe(false);
  });
  it('wraps midnight', () => {
    const q = { start: '21:30', end: '07:00' };
    expect(inQuiet(23 * 60, q)).toBe(true);
    expect(inQuiet(6 * 60 + 30, q)).toBe(true);
    expect(inQuiet(7 * 60, q)).toBe(false);
    expect(inQuiet(12 * 60, q)).toBe(false);
  });
  it('treats start == end as none', () => {
    expect(inQuiet(0, { start: '08:00', end: '08:00' })).toBe(false);
  });
});

describe('expandPlan: fixed slots', () => {
  it('fires each day over a 3-day horizon', () => {
    const p = plan({ slots: [{ id: 'a', kind: 'fixed', time: '08:00', days: ALL }] });
    const fires = expandPlan(p, MON, 3 * DAY, cal);
    expect(fires.map((f) => f.at)).toEqual([at(0, 8), at(1, 8), at(2, 8)]);
    expect(fires.every((f) => f.slotId === 'a')).toBe(true);
  });

  it('honours the weekday filter', () => {
    // Monday = 1, Wednesday = 3.
    const p = plan({ slots: [{ id: 'a', kind: 'fixed', time: '08:00', days: [1, 3] }] });
    const fires = expandPlan(p, MON, 7 * DAY, cal);
    expect(fires.map((f) => f.at)).toEqual([at(0, 8), at(2, 8)]);
  });

  it('stops at the horizon', () => {
    const p = plan({ slots: [{ id: 'a', kind: 'fixed', time: '20:00', days: ALL }] });
    const fires = expandPlan(p, MON, 2 * DAY, cal);
    expect(fires.map((f) => f.at)).toEqual([at(0, 20), at(1, 20)]);
    expect(expandPlan(p, MON, 2 * DAY - 1, cal).length).toBe(2);
    expect(expandPlan(p, MON, at(1, 20) - MON, cal).length).toBe(1);
  });

  it('dedupes identical instants from different slots', () => {
    const p = plan({
      slots: [
        { id: 'a', kind: 'fixed', time: '08:00', days: ALL },
        { id: 'b', kind: 'fixed', time: '08:00', days: ALL },
      ],
    });
    expect(expandPlan(p, MON, DAY, cal)).toHaveLength(1);
  });

  it('returns fires sorted across slots', () => {
    const p = plan({
      slots: [
        { id: 'late', kind: 'fixed', time: '18:00', days: ALL },
        { id: 'early', kind: 'fixed', time: '07:00', days: ALL },
      ],
    });
    expect(expandPlan(p, MON, DAY, cal).map((f) => f.slotId)).toEqual(['early', 'late']);
  });
});

describe('expandPlan: quiet hours', () => {
  const fixedAt = (t: string) =>
    plan({ slots: [{ id: 'a', kind: 'fixed', time: t, days: ALL }], quiet: { start: '21:30', end: '07:00' } });

  it('drops fires at 23:00 and 06:30, keeps 07:00', () => {
    expect(expandPlan(fixedAt('23:00'), MON, DAY, cal)).toHaveLength(0);
    expect(expandPlan(fixedAt('06:30'), MON, DAY, cal)).toHaveLength(0);
    expect(expandPlan(fixedAt('07:00'), MON, DAY, cal)).toHaveLength(1);
  });

  it('a non-wrapping quiet range drops only inside it', () => {
    const p = plan({
      slots: [
        { id: 'a', kind: 'fixed', time: '12:30', days: ALL },
        { id: 'b', kind: 'fixed', time: '16:00', days: ALL },
      ],
      quiet: { start: '12:00', end: '14:00' },
    });
    expect(expandPlan(p, MON, DAY, cal).map((f) => f.slotId)).toEqual(['b']);
  });

  it('start == end means no quiet hours', () => {
    const p = plan({
      slots: [{ id: 'a', kind: 'fixed', time: '23:00', days: ALL }],
      quiet: { start: '22:00', end: '22:00' },
    });
    expect(expandPlan(p, MON, DAY, cal)).toHaveLength(1);
  });
});

describe('expandPlan: maxPerDay', () => {
  const slots = (['08:00', '10:00', '12:00', '14:00'] as const).map((time, i) => ({
    id: 's' + i,
    kind: 'fixed' as const,
    time,
    days: ALL,
  }));

  it('keeps the earliest fires of each day', () => {
    const fires = expandPlan(plan({ slots, maxPerDay: 2 }), MON, 2 * DAY, cal);
    expect(fires.map((f) => f.at)).toEqual([at(0, 8), at(0, 10), at(1, 8), at(1, 10)]);
  });

  it('counts fires earlier today that have already passed', () => {
    // From 11:00: 08:00 and 10:00 already fired today and use up the cap.
    const fires = expandPlan(plan({ slots, maxPerDay: 2 }), at(0, 11), DAY, cal);
    expect(fires.filter((f) => f.at >= at(0, 11) && f.at < at(1, 0))).toEqual([]);
  });
});

describe('expandPlan: window slots', () => {
  const win = (count: number, start = '10:00', end = '18:00') =>
    plan({ slots: [{ id: 'w', kind: 'window', start, end, count, days: ALL }] });

  it('places count fires inside the window, at least 45 minutes apart', () => {
    for (let d = 0; d < 50; d++) {
      const fires = expandPlan(win(4), MON + d * DAY, DAY, cal).filter((f) => f.at >= MON + d * DAY);
      const base = MON + d * DAY;
      expect(fires).toHaveLength(4);
      for (const f of fires) {
        expect(f.at).toBeGreaterThanOrEqual(base + 10 * HOUR);
        expect(f.at).toBeLessThan(base + 18 * HOUR);
      }
      for (let i = 1; i < fires.length; i++) {
        expect(fires[i].at - fires[i - 1].at).toBeGreaterThanOrEqual(MIN_WINDOW_GAP_MIN * 60_000);
      }
    }
  });

  it('is deterministic per local day and slot, whatever `from` is', () => {
    const a = expandPlan(win(3), MON, DAY, cal);
    const b = expandPlan(win(3), MON + 5 * HOUR, DAY - 5 * HOUR, cal);
    expect(a).toHaveLength(3);
    expect(b).toEqual(a);
    const next = expandPlan(win(3), MON + DAY, DAY, cal).map((f) => f.at - (MON + DAY));
    expect(next).not.toEqual(a.map((f) => f.at - MON));
  });

  it('reduces the count when the window is too short', () => {
    // 100 minutes fits at most 3 points 45 minutes apart.
    const fires = expandPlan(win(6, '10:00', '11:40'), MON, DAY, cal);
    expect(fires).toHaveLength(3);
    expect(expandPlan(win(2, '10:00', '10:30'), MON, DAY, cal)).toHaveLength(1);
  });
});

describe('expandPlan: DST', () => {
  // A zone whose day 1 has a spring-forward gap 02:00-03:00 and day 2 a repeated
  // 01:00-02:00, resolving wall times like the Date constructor does.
  const stub: Calendar = {
    ...cal,
    atWallTime(dayStart, h, m) {
      const base = dayStart + (h * 60 + m) * 60_000;
      const day = Math.round((dayStart - MON) / DAY);
      if (day === 1 && h === 2) return base + HOUR; // skipped hour lands an hour later
      return base;
    },
    minuteOfDay(ms) {
      return cal.minuteOfDay(ms);
    },
  };

  it('a wall time in a skipped hour still fires once, an hour later', () => {
    const p = plan({ slots: [{ id: 'a', kind: 'fixed', time: '02:30', days: ALL }] });
    const fires = expandPlan(p, MON, 3 * DAY, stub);
    expect(fires).toHaveLength(3);
    expect(fires[1].at).toBe(at(1, 3, 30));
  });

  it('a repeated wall time fires once per day, not twice', () => {
    const p = plan({ slots: [{ id: 'a', kind: 'fixed', time: '01:30', days: ALL }] });
    expect(expandPlan(p, MON, 3 * DAY, stub)).toHaveLength(3);
  });

  it('quiet hours are judged on the resolved instant', () => {
    const p = plan({
      slots: [{ id: 'a', kind: 'fixed', time: '02:30', days: ALL }],
      quiet: { start: '00:00', end: '03:00' },
    });
    // Day 1's fire resolves to 03:30, outside quiet; days 0 and 2 stay quiet.
    expect(expandPlan(p, MON, 3 * DAY, stub).map((f) => f.at)).toEqual([at(1, 3, 30)]);
  });
});

describe('nextAllowed', () => {
  const quiet = { start: '21:30', end: '07:00' };
  it('returns the instant itself outside quiet hours or with no quiet hours', () => {
    expect(nextAllowed(at(0, 12), quiet, cal)).toBe(at(0, 12));
    expect(nextAllowed(at(0, 23), undefined, cal)).toBe(at(0, 23));
  });
  it('moves an evening instant to the next morning', () => {
    expect(nextAllowed(at(0, 22), quiet, cal)).toBe(at(1, 7));
  });
  it('moves an after-midnight instant to the same morning', () => {
    expect(nextAllowed(at(1, 3), quiet, cal)).toBe(at(1, 7));
  });
  it('handles a same-day quiet range', () => {
    expect(nextAllowed(at(0, 13), { start: '12:00', end: '14:00' }, cal)).toBe(at(0, 14));
  });
});

describe('reconcileMissed', () => {
  it('splits into summarize, drop and future', () => {
    const now = at(0, 12);
    const items = [
      { key: 'old', at: now - 10 * HOUR },
      { key: 'recent', at: now - HOUR },
      { key: 'exact', at: now },
      { key: 'soon', at: now + 1 },
    ];
    const r = reconcileMissed(items, now, { collapseWithinMs: 12 * HOUR });
    expect(r.summarize.map((x) => x.key)).toEqual(['old', 'recent', 'exact']);
    expect(r.future.map((x) => x.key)).toEqual(['soon']);
    const r2 = reconcileMissed(items, now, { collapseWithinMs: 2 * HOUR });
    expect(r2.drop.map((x) => x.key)).toEqual(['old']);
    expect(r2.summarize.map((x) => x.key)).toEqual(['recent', 'exact']);
  });
});
