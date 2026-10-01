/**
 * Plan expansion: a {@link ReminderPlan} plus a time zone in, concrete fire
 * times out. Pure and deterministic (window slots use a seeded generator), so
 * the same plan, seed and zone always give the same instants.
 *
 * Order of operations for each local day, so that results never depend on
 * where a query window starts:
 *   1. resolve every slot that applies to the day to instants (DST rules in `time.ts`);
 *   2. drop fires inside the plan's quiet hours;
 *   3. merge fires at the same instant (first slot wins);
 *   4. keep the earliest `maxPerDay`;
 *   5. finally keep only fires in the query window.
 */
import type { LocalDateString, FireTime, QuietHours, ReminderPlan, ReminderSlot, Weekday } from './types';
import {
  type Civil,
  addCivilDays,
  civilDateOf,
  civilWeekday,
  formatCivilDate,
  minuteOfDay,
  parseCivilDate,
  parseWallTime,
  wallToInstant,
} from './time';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Longest horizon {@link expandPlan} walks, as a guard against runaway loops. */
export const MAX_HORIZON_MS = 400 * DAY;
export const DEFAULT_WINDOW_GAP_MINUTES = 45;

export interface ExpandOptions {
  /**
   * Seed for window slots, so each plan spreads its windows differently but
   * the same plan always gives the same times. Default `''`.
   */
  seed?: string;
}

/** True when the local wall-clock minute `m` (0-1439) is inside `quiet`. */
export function isQuietMinute(m: number, quiet: QuietHours | undefined): boolean {
  if (!quiet) return false;
  const s = parseWallTime(quiet.start);
  const e = parseWallTime(quiet.end);
  if (s === null || e === null || s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** True when instant `at` falls inside `quiet` in `timeZone`. */
export function isInQuietHours(at: number, quiet: QuietHours | undefined, timeZone: string): boolean {
  return isQuietMinute(minuteOfDay(at, timeZone), quiet);
}

/**
 * The first instant at or after `at` that is outside `quiet` (`at` itself when
 * it is not quiet). Used to push a snooze or a held notification past quiet hours.
 */
export function endOfQuietHours(at: number, quiet: QuietHours | undefined, timeZone: string): number {
  if (!isInQuietHours(at, quiet, timeZone)) return at;
  const e = parseWallTime(quiet!.end)!;
  const today = civilDateOf(at, timeZone);
  const m = minuteOfDay(at, timeZone);
  // Inside quiet hours: the end is today (if still ahead on the wall clock) or tomorrow.
  const day = m < e ? today : addCivilDays(today, 1);
  const end = wallToInstant(day, e, timeZone);
  return end > at ? end : at;
}

/** Days a slot applies to; an empty or missing list means never. */
function appliesOn(slot: ReminderSlot, date: Civil, weekday: Weekday): boolean {
  if (slot.kind === 'date') {
    const d = parseCivilDate(slot.date);
    return !!d && d.year === date.year && d.month === date.month && d.day === date.day;
  }
  return Array.isArray(slot.days) && slot.days.includes(weekday);
}

/** FNV-1a over a string, for seeding. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough to spread a few times in a window. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Minutes after local midnight (may exceed 1440 for a window wrapping past
 * midnight) for `count` points in `[start, end]`, at least `gap` apart.
 * Uniform among valid spreads: draw in the window shrunk by the gaps, sort,
 * then add the gaps back. Fewer points when the window is too short.
 */
export function spreadInWindow(start: number, end: number, count: number, gap: number, rand: () => number): number[] {
  const len = end - start;
  if (len < 0 || count < 1) return [];
  const g = Math.max(0, gap);
  const n = g > 0 ? Math.min(Math.floor(count), Math.floor(len / g) + 1) : Math.floor(count);
  if (n < 1) return [];
  const free = len - (n - 1) * g;
  const picks = Array.from({ length: n }, () => Math.floor(rand() * (free + 1)));
  picks.sort((a, b) => a - b);
  return picks.map((p, i) => start + p + i * g);
}

/** Wall-clock minutes (after local midnight of `date`) at which `slot` fires on that date. */
function slotMinutes(slot: ReminderSlot, date: LocalDateString, seed: string): number[] {
  if (slot.kind === 'fixed' || slot.kind === 'date') {
    const m = parseWallTime(slot.time);
    return m === null ? [] : [m];
  }
  const s = parseWallTime(slot.start);
  let e = parseWallTime(slot.end);
  if (s === null || e === null || !(slot.count >= 1)) return [];
  if (e <= s) e += 1440; // wraps past midnight
  const rand = seededRandom(hash32(`${seed}\u0000${slot.id}\u0000${date}`));
  return spreadInWindow(s, e, Math.min(slot.count, 48), slot.minGapMinutes ?? DEFAULT_WINDOW_GAP_MINUTES, rand);
}

/** All fires of `plan` that belong to local date `day`, after quiet hours, merging and the daily cap. */
function firesOnDay(plan: ReminderPlan, day: Civil, timeZone: string, seed: string): FireTime[] {
  const weekday = civilWeekday(day);
  const date = formatCivilDate(day);
  const raw: FireTime[] = [];
  for (const slot of plan.slots ?? []) {
    if (!slot || typeof slot.id !== 'string' || !appliesOn(slot, day, weekday)) continue;
    for (const m of slotMinutes(slot, date, seed)) {
      const at = wallToInstant(day, m, timeZone);
      if (isInQuietHours(at, plan.quiet, timeZone)) continue;
      raw.push({ at, slotId: slot.id, date });
    }
  }
  raw.sort((a, b) => a.at - b.at);
  const merged: FireTime[] = [];
  for (const f of raw) if (merged.length === 0 || merged[merged.length - 1].at !== f.at) merged.push(f);
  const cap = plan.maxPerDay;
  return typeof cap === 'number' && cap >= 0 ? merged.slice(0, Math.floor(cap)) : merged;
}

/**
 * Every fire of `plan` in `[from, from + horizonMs)`, in time order.
 *
 * Walks local days in `timeZone` from the day containing `from` (and the day
 * before, for windows that wrap past midnight). Each day is resolved whole
 * before filtering, so `maxPerDay` counts fires earlier that day too.
 */
export function expandPlan(
  plan: ReminderPlan,
  from: number,
  horizonMs: number,
  timeZone: string,
  options: ExpandOptions = {},
): FireTime[] {
  const until = from + Math.min(Math.max(0, horizonMs), MAX_HORIZON_MS);
  if (!(until > from)) return [];
  const seed = options.seed ?? '';
  const out: FireTime[] = [];
  let day = addCivilDays(civilDateOf(from, timeZone), -1);
  // Stop once the day starts after `until` (a whole day of margin covers wraps and DST).
  for (let i = 0; i < 410; i++) {
    const dayStart = wallToInstant(day, 0, timeZone);
    if (dayStart >= until + DAY) break;
    for (const f of firesOnDay(plan, day, timeZone, seed)) if (f.at >= from && f.at < until) out.push(f);
    day = addCivilDays(day, 1);
  }
  out.sort((a, b) => a.at - b.at || (a.slotId < b.slotId ? -1 : 1));
  return out;
}

/**
 * The first fire strictly after `now`, looking up to `lookaheadMs` ahead
 * (default 8 days, enough for any weekly plan), or null.
 */
export function nextFireAt(
  plan: ReminderPlan,
  now: number,
  timeZone: string,
  options: ExpandOptions & { lookaheadMs?: number } = {},
): FireTime | null {
  const fires = expandPlan(plan, now + 1, options.lookaheadMs ?? 8 * DAY, timeZone, options);
  return fires[0] ?? null;
}

/** Fires in `(after, upTo]`: what a plan should have fired while the app was not watching. */
export function firesBetween(
  plan: ReminderPlan,
  after: number,
  upTo: number,
  timeZone: string,
  options: ExpandOptions = {},
): FireTime[] {
  if (!(upTo > after)) return [];
  return expandPlan(plan, after + 1, upTo - after, timeZone, options);
}

export { MINUTE as MINUTE_MS, DAY as DAY_MS };
