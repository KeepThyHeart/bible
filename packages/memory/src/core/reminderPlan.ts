/**
 * Reminder plan expansion (task 0072, a local copy of core's C1).
 *
 * Turns a `ReminderPlan` ("08:00 every day, plus three random times between
 * 10:00 and 18:00 on weekdays, never during quiet hours, at most 3 a day")
 * into concrete fire times. Pure: the clock, the time zone and the randomness
 * are all passed in, so the code is identical in the QuickJS worker and in
 * tests, and daylight-saving edge cases can be tested with a stub calendar.
 *
 * Nothing here knows about passages or cards; `pushCards.ts` decides what each
 * fire time shows.
 */

import type { FireTime, QuietHours, ReminderPlan, Weekday } from './pushTypes';
import { makeRng } from './scheduler';

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Minimum gap between two random points of one window slot. */
export const MIN_WINDOW_GAP_MIN = 45;

/**
 * The time-zone seam. Every "local" question the planner asks goes through
 * here, so DST behaviour is whatever the calendar's implementation does.
 */
export interface Calendar {
  /** Start of the local day containing `ms`. */
  startOfDay(ms: number): number;
  /** Start of the local day `n` days after the local day starting at `dayStart`. */
  addDays(dayStart: number, n: number): number;
  /** Day of week of the local day starting at `dayStart`; 0 = Sunday. */
  weekday(dayStart: number): Weekday;
  /** Instant of wall time h:m on that local day (h may exceed 23 to run past midnight). */
  atWallTime(dayStart: number, h: number, m: number): number;
  /** Minutes since local midnight of `ms`, 0..1439. */
  minuteOfDay(ms: number): number;
}

/**
 * Calendar in the runtime's local zone. DST follows the `Date` constructor:
 * a wall time in a spring-forward gap lands an hour later, a repeated wall
 * time resolves to its first occurrence.
 */
export const localCalendar: Calendar = {
  startOfDay(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  },
  addDays(dayStart, n) {
    const d = new Date(dayStart);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
  },
  weekday(dayStart) {
    return new Date(dayStart).getDay() as Weekday;
  },
  atWallTime(dayStart, h, m) {
    const d = new Date(dayStart);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  },
  minuteOfDay(ms) {
    const d = new Date(ms);
    return d.getHours() * 60 + d.getMinutes();
  },
};

/** A zone with a fixed UTC offset (no DST); used by tests. */
export function fixedOffsetCalendar(offsetMin: number): Calendar {
  const off = offsetMin * MINUTE_MS;
  return {
    startOfDay: (ms) => Math.floor((ms + off) / DAY_MS) * DAY_MS - off,
    addDays: (dayStart, n) => dayStart + n * DAY_MS,
    weekday: (dayStart) => new Date(dayStart + off).getUTCDay() as Weekday,
    atWallTime: (dayStart, h, m) => dayStart + (h * 60 + m) * MINUTE_MS,
    minuteOfDay: (ms) => Math.floor((((ms + off) % DAY_MS) + DAY_MS) % DAY_MS / MINUTE_MS),
  };
}

/** Parse strict "HH:MM" (00:00..23:59); anything else is null. */
export function parseWallTime(s: string): { h: number; m: number } | null {
  if (typeof s !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]) };
}

export function formatWallTime(h: number, m: number): string {
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/**
 * Whether a minute of the day is inside quiet hours: [start, end), wrapping
 * midnight when start > end. start == end means no quiet hours; an unparseable
 * bound means none either.
 */
export function inQuiet(minute: number, q: QuietHours | undefined): boolean {
  if (!q) return false;
  const a = parseWallTime(q.start);
  const b = parseWallTime(q.end);
  if (!a || !b) return false;
  const start = a.h * 60 + a.m;
  const end = b.h * 60 + b.m;
  if (start === end) return false;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

/**
 * `n` points inside [0, lengthMin) minutes, one per segment, at least
 * MIN_WINDOW_GAP_MIN apart. The random points are drawn from the slack left
 * after reserving the gaps, sorted, then spread by i * gap, which guarantees
 * the spacing whatever the draw. `n` shrinks when the window is too short.
 */
function windowPoints(lengthMin: number, n: number, rng: () => number): number[] {
  if (lengthMin <= 0 || n <= 0) return [];
  const count = Math.min(n, Math.floor((lengthMin - 1) / MIN_WINDOW_GAP_MIN) + 1);
  const slack = lengthMin - (count - 1) * MIN_WINDOW_GAP_MIN;
  const draws: number[] = [];
  for (let i = 0; i < count; i++) draws.push(Math.floor(rng() * slack));
  draws.sort((x, y) => x - y);
  return draws.map((d, i) => d + i * MIN_WINDOW_GAP_MIN);
}

/** Stable 32-bit hash (FNV-1a) of a local day and slot id, seeding that slot's draws. */
function slotSeed(dayStart: number, slotId: string): number {
  let h = 0x811c9dc5;
  const str = dayStart + ':' + slotId;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Expand a plan into fire times, sorted ascending.
 *
 * Random window points are deterministic per local day and slot id, so
 * recomputing later the same day yields the same times.
 *
 * Walks local days from the start of the day containing `from` (so fires
 * earlier today that have already passed still count against `maxPerDay`, and
 * are returned - callers filter to the future) up to `from + horizonMs`.
 * Quiet-hour fires are dropped, not deferred. Identical instants are deduped;
 * each local day keeps only its earliest `maxPerDay` fires.
 */
export function expandPlan(
  plan: ReminderPlan,
  from: number,
  horizonMs: number,
  cal: Calendar,
): FireTime[] {
  const out: FireTime[] = [];
  const limit = from + horizonMs;
  const cap = Math.max(1, Math.floor(plan.maxPerDay));
  let day = cal.startOfDay(from);
  while (day < limit) {
    const wd = cal.weekday(day);
    const today: FireTime[] = [];
    for (const slot of plan.slots) {
      if (!slot.days.includes(wd)) continue;
      if (slot.kind === 'fixed') {
        const t = parseWallTime(slot.time);
        if (!t) continue;
        today.push({ at: cal.atWallTime(day, t.h, t.m), slotId: slot.id });
      } else {
        const a = parseWallTime(slot.start);
        const b = parseWallTime(slot.end);
        if (!a || !b) continue;
        const startMin = a.h * 60 + a.m;
        let endMin = b.h * 60 + b.m;
        if (endMin <= startMin) endMin += 24 * 60; // window wraps midnight
        for (const p of windowPoints(endMin - startMin, slot.count, makeRng(slotSeed(day, slot.id)))) {
          const min = startMin + p;
          today.push({ at: cal.atWallTime(day, Math.floor(min / 60), min % 60), slotId: slot.id });
        }
      }
    }
    const seen = new Set<number>();
    const kept = today
      .filter((f) => !inQuiet(cal.minuteOfDay(f.at), plan.quiet))
      .sort((x, y) => x.at - y.at)
      .filter((f) => (seen.has(f.at) ? false : (seen.add(f.at), true)))
      .slice(0, cap);
    for (const f of kept) if (f.at < limit) out.push(f);
    const next = cal.addDays(day, 1);
    if (next <= day) break; // a broken calendar must not loop forever
    day = next;
  }
  return out.sort((x, y) => x.at - y.at);
}

/**
 * For "Later": the first allowed instant at or after `at`. Outside quiet
 * hours that is `at` itself; inside, the moment quiet hours end (which may be
 * the next morning).
 */
export function nextAllowed(at: number, quiet: QuietHours | undefined, cal: Calendar): number {
  if (!quiet) return at;
  const minute = cal.minuteOfDay(at);
  if (!inQuiet(minute, quiet)) return at;
  const end = parseWallTime(quiet.end);
  const start = parseWallTime(quiet.start);
  if (!end || !start) return at;
  const day = cal.startOfDay(at);
  const wraps = start.h * 60 + start.m > end.h * 60 + end.m;
  const endDay = wraps && minute >= start.h * 60 + start.m ? cal.addDays(day, 1) : day;
  return cal.atWallTime(endDay, end.h, end.m);
}

/**
 * Sort reminders that should have fired by now. Past ones within
 * `collapseWithinMs` of `now` are to be summarized (shown as one "cards
 * waiting" notice), older ones dropped; later ones are still `future`.
 */
export function reconcileMissed<T extends { at: number }>(
  pending: T[],
  now: number,
  opts: { collapseWithinMs: number },
): { summarize: T[]; drop: T[]; future: T[] } {
  const summarize: T[] = [];
  const drop: T[] = [];
  const future: T[] = [];
  for (const p of pending) {
    if (p.at > now) future.push(p);
    else if (now - p.at <= opts.collapseWithinMs) summarize.push(p);
    else drop.push(p);
  }
  return { summarize, drop, future };
}
