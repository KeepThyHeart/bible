/**
 * Conversion and formatting: SI values to modern units, days' wages, metal
 * weight and clock times. Pure functions; every user-visible string comes from
 * the locale pack (English built-ins as fallback).
 */
import { modernUnitName, phrase, pluralPhrase } from './locale';
import type {
  Approx, ConvertedValue, MeasureDimension, MeasureLocalePack, MeasurePreferences, MeasureSystem, MeasureUnitDef,
} from './types';

export interface FormatContext {
  /** BCP 47 UI locale used for `Intl`. */
  locale: string;
  pack: MeasureLocalePack;
}

// --- number formatting -----------------------------------------------------------

const nfCache = new Map<string, Intl.NumberFormat>();

function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = nfCache.get(key);
  if (!f) {
    try { f = new Intl.NumberFormat(locale, opts); } catch { f = new Intl.NumberFormat('en', opts); }
    nfCache.set(key, f);
  }
  return f;
}

/** 2 significant figures: 137 -> "140", 0.4571 -> "0.46". */
export function formatSig2(value: number, locale: string): string {
  return nf(locale, { maximumSignificantDigits: 2 }).format(value);
}

/** Numeric value rounded to 2 significant figures. */
export function roundSig2(value: number): number {
  return value === 0 ? 0 : Number(value.toPrecision(2));
}

/** A quantity exactly as the text states it: 2.5 -> "2.5", 300 -> "300". */
export function formatQuantity(value: number, locale: string): string {
  return nf(locale, { maximumFractionDigits: 3 }).format(value);
}

const TITLE_FRACTIONS: [number, string][] = [
  [1 / 2, '½'], [1 / 3, '⅓'], [2 / 3, '⅔'], [1 / 4, '¼'], [3 / 4, '¾'], [1 / 6, '⅙'], [1 / 10, '⅒'],
];

/**
 * A quantity for a title: integers with locale grouping, common fractions as
 * vulgar fractions, mixed numbers joined ("2½"), anything else as a decimal.
 */
export function formatTitleQuantity(value: number, locale: string): string {
  const whole = Math.floor(value + 1e-6);
  const frac = value - whole;
  const wholeText = nf(locale, { maximumFractionDigits: 0 }).format(whole);
  if (Math.abs(frac) < 1e-6) return wholeText;
  const glyph = TITLE_FRACTIONS.find(([f]) => Math.abs(frac - f) < 1e-6)?.[1];
  if (glyph) return whole > 0 ? `${wholeText}${glyph}` : glyph;
  return formatQuantity(value, locale);
}

// --- length, area, volume, mass ----------------------------------------------------

interface Step { unit: string; perUnit: number }

const LENGTH_METRIC: Step[] = [
  { unit: 'millimeter', perUnit: 0.001 }, { unit: 'centimeter', perUnit: 0.01 },
  { unit: 'meter', perUnit: 1 }, { unit: 'kilometer', perUnit: 1000 },
];
const LENGTH_US: Step[] = [
  { unit: 'inch', perUnit: 0.0254 }, { unit: 'foot', perUnit: 0.3048 }, { unit: 'mile', perUnit: 1609.344 },
];
const AREA_METRIC: Step[] = [{ unit: 'hectare', perUnit: 10000 }];
const AREA_US: Step[] = [{ unit: 'acre', perUnit: 4046.8564224 }];
const VOLUME_METRIC: Step[] = [{ unit: 'milliliter', perUnit: 0.001 }, { unit: 'liter', perUnit: 1 }];
const LIQUID_US: Step[] = [
  { unit: 'fluid-ounce', perUnit: 0.0295735295625 }, { unit: 'quart', perUnit: 0.946352946 }, { unit: 'gallon', perUnit: 3.785411784 },
];
const DRY_US: Step[] = [
  { unit: 'dry-quart', perUnit: 1.101220942715 }, { unit: 'peck', perUnit: 8.80976754172 }, { unit: 'bushel', perUnit: 35.2390701669 },
];
const LIQUID_IMPERIAL: Step[] = [
  { unit: 'pint', perUnit: 0.56826125 }, { unit: 'imperial-gallon', perUnit: 4.54609 },
];
const DRY_IMPERIAL: Step[] = [
  { unit: 'imperial-gallon', perUnit: 4.54609 }, { unit: 'peck', perUnit: 9.09218 }, { unit: 'bushel', perUnit: 36.36872 },
];
const MASS_METRIC: Step[] = [{ unit: 'gram', perUnit: 0.001 }, { unit: 'kilogram', perUnit: 1 }];
const MASS_US: Step[] = [{ unit: 'ounce', perUnit: 0.028349523125 }, { unit: 'pound', perUnit: 0.45359237 }];

function stepsFor(dimension: MeasureDimension, system: MeasureSystem): Step[] | undefined {
  const metric = system === 'metric';
  switch (dimension) {
    case 'length': return metric ? LENGTH_METRIC : LENGTH_US;
    case 'area': return metric ? AREA_METRIC : AREA_US;
    case 'volume_dry': return metric ? VOLUME_METRIC : system === 'us' ? DRY_US : DRY_IMPERIAL;
    case 'volume_liquid': return metric ? VOLUME_METRIC : system === 'us' ? LIQUID_US : LIQUID_IMPERIAL;
    case 'mass': return metric ? MASS_METRIC : MASS_US;
    default: return undefined;
  }
}

/** Dimensions that take a physical conversion. */
export function isPhysicalDimension(d: MeasureDimension): boolean {
  return d !== 'money' && d !== 'time';
}

/** Imperial is shown as a secondary system for length and mass only. */
export function secondaryApplies(dimension: MeasureDimension, secondary: MeasureSystem | 'none', primary: MeasureSystem): secondary is MeasureSystem {
  if (secondary === 'none' || secondary === primary) return false;
  if (secondary === 'imperial') return dimension === 'length' || dimension === 'mass';
  return true;
}

/**
 * An SI amount (m, m², L, kg; `low`/`high` optional) in the display unit of a
 * system: the largest unit that is not bigger than the value, so the number
 * stays in 1..1000 where possible.
 */
export function convertToSystem(dimension: MeasureDimension, si: Approx, system: MeasureSystem): ConvertedValue | undefined {
  const steps = stepsFor(dimension, system);
  if (!steps) return undefined;
  const abs = Math.abs(si.value);
  let step = steps[0];
  for (const s of steps) if (abs >= s.perUnit) step = s;
  const out: ConvertedValue = { unit: step.unit, value: si.value / step.perUnit };
  if (si.low !== undefined) out.low = si.low / step.perUnit;
  if (si.high !== undefined) out.high = si.high / step.perUnit;
  return out;
}

const INTL_UNITS = new Set([
  'meter', 'kilometer', 'centimeter', 'millimeter', 'foot', 'inch', 'mile', 'yard', 'hectare', 'acre',
  'liter', 'milliliter', 'fluid-ounce', 'gallon', 'gram', 'kilogram', 'ounce', 'pound',
]);

function formatNumberWithUnit(value: number, unit: string, ctx: FormatContext): string {
  if (INTL_UNITS.has(unit)) {
    try {
      return nf(ctx.locale, { style: 'unit', unit, unitDisplay: 'short', maximumSignificantDigits: 2 }).format(value);
    } catch { /* fall through to the named form */ }
  }
  return `${formatSig2(value, ctx.locale)} ${modernUnitName(ctx.pack, unit, roundSig2(value), ctx.locale)}`;
}

/** "140 m", "450 ft", "3.9 quarts". */
export function formatConverted(cv: ConvertedValue, ctx: FormatContext): string {
  return formatNumberWithUnit(cv.value, cv.unit, ctx);
}

/** "132–156 m" when `low`/`high` exist; undefined otherwise. */
export function formatConvertedRange(cv: ConvertedValue, ctx: FormatContext): string | undefined {
  if (cv.low === undefined || cv.high === undefined) return undefined;
  return phrase(ctx.pack, 'range', {
    low: formatSig2(cv.low, ctx.locale),
    high: formatNumberWithUnit(cv.high, cv.unit, ctx),
  });
}

/** Whether to show the range: 'always', or 'auto' when the spread exceeds 10 % of the value. */
export function shouldShowRange(mode: MeasurePreferences['ranges'], v: { value: number; low?: number; high?: number }): boolean {
  if (mode === 'never' || v.low === undefined || v.high === undefined) return false;
  if (mode === 'always') return v.high !== v.low;
  return v.value !== 0 && (v.high - v.low) / Math.abs(v.value) > 0.1;
}

// --- money --------------------------------------------------------------------------

const WORKING_DAY_HOURS = 12;
const WORKING_DAYS_PER_MONTH = 25;
const WORKING_DAYS_PER_YEAR = 300;

export type WagesScale = 'minute' | 'hour' | 'day' | 'month' | 'year';

/** Days' wages as a readable amount: minutes/hours of a 12-hour day, days, months (25 days) or years (300 days). */
export function scaleWages(days: number): { scale: WagesScale; value: number } {
  const abs = Math.abs(days);
  if (abs < 1) {
    const hours = days * WORKING_DAY_HOURS;
    return Math.abs(hours) < 1 ? { scale: 'minute', value: hours * 60 } : { scale: 'hour', value: hours };
  }
  if (abs < 50) return { scale: 'day', value: days };
  if (abs < 300) return { scale: 'month', value: days / WORKING_DAYS_PER_MONTH };
  return { scale: 'year', value: days / WORKING_DAYS_PER_YEAR };
}

/** "1 day's wages", "about 45 minutes' wages" (the approx sign is the caller's). */
export function formatWages(days: number, ctx: FormatContext): { text: string; scale: WagesScale } {
  const { scale, value } = scaleWages(days);
  const text = pluralPhrase(ctx.pack, `wages.${scale}`, roundSig2(value), ctx.locale, { n: formatSig2(value, ctx.locale) });
  return { text, scale };
}

/** Days' wages of a unit part, with `low`/`high` summed alongside. */
export function sumApprox(items: { amount: Approx; quantity?: Approx }[]): Approx {
  let value = 0, low = 0, high = 0;
  let hasRange = false;
  for (const { amount, quantity } of items) {
    const q = quantity ?? { value: 1 };
    const aLow = amount.low ?? amount.value, aHigh = amount.high ?? amount.value;
    const qLow = q.low ?? q.value, qHigh = q.high ?? q.value;
    value += amount.value * q.value;
    low += aLow * qLow;
    high += aHigh * qHigh;
    if (amount.low !== undefined || amount.high !== undefined || q.low !== undefined || q.high !== undefined) hasRange = true;
  }
  return hasRange ? { value, low, high } : { value };
}

export function metalName(metal: string, pack: MeasureLocalePack): string {
  return phrase(pack, `metal.${metal}`) || metal;
}

/** "3.9 g of silver" from a mass in kg. */
export function formatMetal(kg: Approx, metal: string, system: MeasureSystem, ctx: FormatContext): { text: string; cv: ConvertedValue } | undefined {
  const cv = convertToSystem('mass', kg, system);
  if (!cv) return undefined;
  return { text: phrase(ctx.pack, 'metal', { mass: formatConverted(cv, ctx), metal: metalName(metal, ctx.pack) }), cv };
}

export function formatModernWage(days: number, wage: { amount: number; currency: string }, ctx: FormatContext): string | undefined {
  try {
    // The currency's own fraction digits (Intl defaults): "$200.00", "¥20,000".
    const money = nf(ctx.locale, { style: 'currency', currency: wage.currency });
    return phrase(ctx.pack, 'modernWage', {
      amount: money.format(days * wage.amount),
      wage: money.format(wage.amount),
    });
  } catch {
    return undefined;
  }
}

// --- clock --------------------------------------------------------------------------

function parseHm(s: string): { h: number; m: number } {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

function clockFormat(locale: string, clock: 'h12' | 'h23', withMinutes: boolean): Intl.DateTimeFormat {
  const opts = {
    hour: 'numeric', ...(withMinutes ? { minute: '2-digit' } : {}), hourCycle: clock, timeZone: 'UTC',
  } as Intl.DateTimeFormatOptions;
  try { return new Intl.DateTimeFormat(locale, opts); } catch { return new Intl.DateTimeFormat('en', opts); }
}

function clockDate(hm: { h: number; m: number }): Date {
  return new Date(Date.UTC(2000, 0, 1, hm.h, hm.m));
}

/** One clock time, e.g. "3 PM" / "15:00" (h23 always shows minutes). */
export function formatClockTime(hm: string, locale: string, clock: 'h12' | 'h23'): string {
  const t = parseHm(hm);
  return clockFormat(locale, clock, t.m !== 0 || clock === 'h23').format(clockDate(t));
}

/** "about 9 a.m." / "about 3–6 a.m." (the shared day period is shown once). */
export function formatClock(unit: MeasureUnitDef, prefs: Pick<MeasurePreferences, 'clock'>, ctx: FormatContext): string | undefined {
  if (!unit.clock) return undefined;
  const a = parseHm(unit.clock.start), b = parseHm(unit.clock.end);
  const sameTime = a.h === b.h && a.m === b.m;
  if (sameTime) return phrase(ctx.pack, 'clockPoint', { time: formatClockTime(unit.clock.start, ctx.locale, prefs.clock) });
  const withMin = a.m !== 0 || b.m !== 0 || prefs.clock === 'h23';
  const fmt = clockFormat(ctx.locale, prefs.clock, withMin);
  const pa = fmt.formatToParts(clockDate(a)), pb = fmt.formatToParts(clockDate(b));
  const dpA = pa.find((p) => p.type === 'dayPeriod')?.value, dpB = pb.find((p) => p.type === 'dayPeriod')?.value;
  let start = fmt.format(clockDate(a));
  if (dpA !== undefined && dpA === dpB) {
    start = pa.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').replace(/[\s  ]+$/u, '');
  }
  return phrase(ctx.pack, 'clock', { start, end: fmt.format(clockDate(b)) });
}

export function reckoningLine(unit: MeasureUnitDef, pack: MeasureLocalePack): string | undefined {
  return unit.clock ? phrase(pack, `reckoning.${unit.clock.reckoning}`) || undefined : undefined;
}
