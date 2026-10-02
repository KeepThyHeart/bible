/**
 * Local-calendar date maths for reading plans. Dates are `YYYY-MM-DD` strings in the reader's
 * local time, computed in UTC internally so daylight-saving changes never skip or repeat a day.
 */
import type { IsoDate, Weekday } from './types';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of the date, or null when it is not a real `YYYY-MM-DD` date. */
export function parseIsoDate(date: IsoDate): number | null {
  const m = ISO_RE.exec(date);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return t;
}

export function isIsoDate(date: unknown): date is IsoDate {
  return typeof date === 'string' && parseIsoDate(date) !== null;
}

function fromUtc(t: number): IsoDate {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${m}-${day}`;
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const t = parseIsoDate(date);
  if (t === null) throw new Error(`Invalid date ${date}`);
  return fromUtc(t + n * 86_400_000);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const ta = parseIsoDate(a);
  const tb = parseIsoDate(b);
  if (ta === null || tb === null) throw new Error(`Invalid date ${a} or ${b}`);
  return Math.round((tb - ta) / 86_400_000);
}

export function weekdayOf(date: IsoDate): Weekday {
  const t = parseIsoDate(date);
  if (t === null) throw new Error(`Invalid date ${date}`);
  return new Date(t).getUTCDay() as Weekday;
}

/** Default hour (local) at which a new reading day begins, so late-night reading counts for the day before. */
export const DEFAULT_ROLLOVER_HOUR = 3;

/**
 * The reading day `now` belongs to: the local date, minus one day before `rolloverHour`
 * (0 = midnight; up to 12 for night-shift schedules).
 */
export function readingDate(now: Date, rolloverHour: number = DEFAULT_ROLLOVER_HOUR): IsoDate {
  const hour = Math.min(12, Math.max(0, Math.floor(rolloverHour)));
  const shifted = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - hour, now.getMinutes());
  return fromUtc(Date.UTC(shifted.getFullYear(), shifted.getMonth(), shifted.getDate()));
}
