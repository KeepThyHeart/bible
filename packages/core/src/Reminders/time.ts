/**
 * Time-zone and wall-clock arithmetic for the reminder engine.
 *
 * Everything goes through `Intl.DateTimeFormat` with an explicit `timeZone`, so
 * the result never depends on the process's own zone, and DST rules come from
 * the platform's tz database (Node, Electron and browsers all ship full ICU).
 *
 * Wall time -> instant follows the documented rules: a wall time that does not
 * exist (spring-forward gap) resolves to the first valid minute after the gap;
 * one that happens twice (fall-back overlap) resolves to the first occurrence.
 */
import type { LocalDateString, WallTime, Weekday } from './types';

const MINUTE = 60_000;
const DAY = 86_400_000;

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True when `timeZone` is an IANA zone the platform knows. */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone === '') return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The platform's own zone (falls back to UTC). */
export function systemTimeZone(): string {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The local calendar and clock fields of instant `at` in `timeZone`. */
export function zonedParts(at: number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(at))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  const hour = out.hour === 24 ? 0 : out.hour;
  const weekday = new Date(Date.UTC(out.year, out.month - 1, out.day)).getUTCDay() as Weekday;
  return { year: out.year, month: out.month, day: out.day, hour, minute: out.minute, second: out.second, weekday };
}

/** UTC offset of `timeZone` at instant `at`, in milliseconds (local = UTC + offset). */
export function zoneOffset(at: number, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop sub-second precision of `at` so the subtraction is exact.
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Parse `"HH:MM"` to minutes after midnight, or null when malformed. */
export function parseWallTime(t: WallTime): number | null {
  if (typeof t !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes after midnight to `"HH:MM"`. */
export function formatWallTime(minutes: number): WallTime {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export interface Civil {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Parse `"YYYY-MM-DD"`, or null when malformed or not a real date. */
export function parseCivilDate(d: LocalDateString): Civil | null {
  if (typeof d !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  const c = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const t = new Date(Date.UTC(c.year, c.month - 1, c.day));
  if (t.getUTCFullYear() !== c.year || t.getUTCMonth() !== c.month - 1 || t.getUTCDate() !== c.day) return null;
  return c;
}

export function formatCivilDate(c: Civil): LocalDateString {
  return `${String(c.year).padStart(4, '0')}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}

/** The civil date `n` days after `c` (proleptic Gregorian; no time zone involved). */
export function addCivilDays(c: Civil, n: number): Civil {
  const t = new Date(Date.UTC(c.year, c.month - 1, c.day) + n * DAY);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function civilWeekday(c: Civil): Weekday {
  return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay() as Weekday;
}

/** The local date of instant `at` in `timeZone`. */
export function civilDateOf(at: number, timeZone: string): Civil {
  const p = zonedParts(at, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Minutes after local midnight of instant `at` in `timeZone`. */
export function minuteOfDay(at: number, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * The instant at which the local wall clock in `timeZone` reads `minutes` after
 * midnight on date `c`. `minutes` may exceed 1440 (next day). Gaps resolve to
 * the first valid minute after the gap; overlaps to the first occurrence.
 */
export function wallToInstant(c: Civil, minutes: number, timeZone: string): number {
  const naive = Date.UTC(c.year, c.month - 1, c.day) + minutes * MINUTE; // the wall time read as if UTC
  // DST changes are far more than two days apart, so the offsets a day either
  // side cover every offset that can apply to this wall time.
  const offsets = new Set([zoneOffset(naive - DAY, timeZone), zoneOffset(naive, timeZone), zoneOffset(naive + DAY, timeZone)]);
  const matches: number[] = [];
  for (const off of offsets) {
    const t = naive - off;
    if (zoneOffset(t, timeZone) === off) matches.push(t);
  }
  if (matches.length > 0) return Math.min(...matches);

  // A gap: no offset maps back to this wall time. The transition lies between
  // `naive - maxOffset` (still on the old offset) and `naive - minOffset`.
  const lo0 = naive - Math.max(...offsets);
  const hi0 = naive - Math.min(...offsets);
  let lo = Math.min(lo0, hi0);
  let hi = Math.max(lo0, hi0);
  const offLo = zoneOffset(lo, timeZone);
  // Binary search to the minute for the first instant with the new offset.
  while (hi - lo > MINUTE) {
    const mid = lo + Math.max(MINUTE, Math.floor((hi - lo) / 2 / MINUTE) * MINUTE);
    if (zoneOffset(mid, timeZone) === offLo) lo = mid;
    else hi = mid;
  }
  return hi;
}
