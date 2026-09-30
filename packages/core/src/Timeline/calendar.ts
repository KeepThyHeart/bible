import type { TimePrecision } from './types';

/**
 * Instants are day numbers: the Julian Day Number of the date in the proleptic
 * JULIAN calendar (Ussher's Annals reckon in it), plus hour/24. There is no
 * year zero problem: years are handled as ASTRONOMICAL years internally
 * (1 BC = 0, 2 BC = -1) and shown as BC/AD.
 */

export interface CivilDate {
  /** Astronomical year (1 BC = 0). */
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Astronomical year for a BC year (`bc(4004)` = -4003). */
export function bc(year: number): number {
  return 1 - year;
}

/** Day number of a Julian-calendar date. `hour` may be fractional. */
export function civilToInstant(year: number, month = 1, day = 1, hour = 0): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jdn = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
  return jdn + hour / 24;
}

export function instantToCivil(instant: number): CivilDate {
  const jdn = Math.floor(instant + 1e-9);
  const frac = instant - jdn;
  const c = jdn + 32082;
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = d - 4800 + Math.floor(m / 10);
  const minutes = Math.round(frac * 24 * 60);
  return { year, month, day, hour: Math.floor(minutes / 60) % 24, minute: minutes % 60 };
}

/** Instant of 1 January of an astronomical year. */
export function yearStart(year: number): number {
  return civilToInstant(year, 1, 1);
}

/** Astronomical year containing an instant. */
export function yearOf(instant: number): number {
  return instantToCivil(instant).year;
}

/** "4004 BC" / "AD 33". */
export function formatYear(year: number): string {
  return year <= 0 ? `${1 - year} BC` : `AD ${year}`;
}

const ROUNDING: Partial<Record<TimePrecision, number>> = { millennium: 1000, century: 100, decade: 10 };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Format an instant no more precisely than `precision` allows. A rounded
 * precision ("century") shows the year of the value rounded to that unit;
 * 'circa' prefixes "c. ".
 */
export function formatInstant(instant: number, precision: TimePrecision = 'year', circa = false): string {
  const c = instantToCivil(instant);
  let text: string;
  const unit = ROUNDING[precision];
  if (unit) {
    const bcYear = 1 - c.year;
    const rounded = c.year <= 0 ? Math.round(bcYear / unit) * unit : Math.round(c.year / unit) * unit;
    text = c.year <= 0 ? `${rounded} BC` : `AD ${rounded}`;
  } else if (precision === 'year') {
    text = formatYear(c.year);
  } else if (precision === 'month') {
    text = `${MONTH_NAMES[c.month - 1]} ${formatYear(c.year)}`;
  } else {
    text = `${MONTH_NAMES[c.month - 1]} ${c.day}, ${formatYear(c.year)}`;
    if (precision === 'hour') text += `, ${pad2(c.hour)}:${pad2(c.minute)}`;
  }
  return circa ? `c. ${text}` : text;
}

/**
 * Format a span. For year-or-coarser precision the stored `end` is the
 * exclusive end (start of the following year), so the last year shown is the
 * one before it: a reign stored 975 BC to 958 BC reads "975 BC to 958 BC".
 */
export function formatSpan(
  start: number,
  end: number | undefined,
  precision: TimePrecision = 'year',
  circa = false
): string {
  if (end === undefined) return formatInstant(start, precision, circa);
  const coarse = precision === 'year' || ROUNDING[precision] !== undefined;
  const shownEnd = coarse ? end - 1 : end;
  const a = formatInstant(start, precision, circa);
  const b = formatInstant(shownEnd, precision, false);
  return a === b ? a : `${a} to ${b}`;
}
