import { civilToInstant, formatYear, instantToCivil, MONTH_NAMES, yearOf, yearStart } from './calendar';

/** The visible window, in day numbers. */
export interface TimeView {
  start: number;
  end: number;
}

/** Smallest window: 3 hours, so hour-level events (Holy Week) can be told apart. */
export const MIN_SPAN_DAYS = 3 / 24;

export function viewSpan(view: TimeView): number {
  return view.end - view.start;
}

export function xOf(view: TimeView, width: number, t: number): number {
  return ((t - view.start) / viewSpan(view)) * width;
}

export function tOf(view: TimeView, width: number, x: number): number {
  return view.start + (x / width) * viewSpan(view);
}

/** Keep a view inside `bounds` and within [MIN_SPAN_DAYS, bounds span]. */
export function clampView(view: TimeView, bounds: TimeView): TimeView {
  const maxSpan = Math.max(viewSpan(bounds), MIN_SPAN_DAYS);
  let span = Math.min(Math.max(viewSpan(view), MIN_SPAN_DAYS), maxSpan);
  let start = view.start;
  if (start < bounds.start) start = bounds.start;
  if (start + span > bounds.end) start = bounds.end - span;
  if (start < bounds.start) {
    start = bounds.start;
    span = maxSpan;
  }
  return { start, end: start + span };
}

/** Zoom by `factor` (>1 zooms in) keeping the instant `anchorT` under the pointer. */
export function zoomView(view: TimeView, factor: number, anchorT: number, bounds: TimeView): TimeView {
  const span = viewSpan(view) / factor;
  const ratio = (anchorT - view.start) / viewSpan(view);
  const start = anchorT - ratio * span;
  return clampView({ start, end: start + span }, bounds);
}

export function panView(view: TimeView, deltaDays: number, bounds: TimeView): TimeView {
  return clampView({ start: view.start + deltaDays, end: view.end + deltaDays }, bounds);
}

/** A window around [start, end] with `pad` (a fraction of the span) on each side. */
export function fitRange(start: number, end: number, bounds: TimeView, pad = 0.15): TimeView {
  const span = Math.max(end - start, MIN_SPAN_DAYS);
  const p = span * pad;
  return clampView({ start: start - p, end: start + span + p }, bounds);
}

export interface Tick {
  t: number;
  label: string;
  /** Major ticks get a longer line and a stronger label. */
  major: boolean;
}

interface TickSpec {
  unit: 'year' | 'month' | 'day' | 'hour';
  step: number;
  days: number;
}

const YEAR_STEPS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
const SPECS: TickSpec[] = [
  ...YEAR_STEPS.map((n): TickSpec => ({ unit: 'year', step: n, days: n * 365.25 })),
  { unit: 'month', step: 3, days: 91 },
  { unit: 'month', step: 1, days: 30.4 },
  { unit: 'day', step: 7, days: 7 },
  { unit: 'day', step: 1, days: 1 },
  { unit: 'hour', step: 6, days: 0.25 },
  { unit: 'hour', step: 3, days: 0.125 },
  { unit: 'hour', step: 1, days: 1 / 24 },
];

const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/**
 * Tick marks for a view. Picks the finest unit whose spacing is at least
 * `minGapPx`, so ticks read 1000/500/.../1 years, then months, days, hours.
 */
export function computeTicks(view: TimeView, width: number, minGapPx = 84): Tick[] {
  if (width <= 0) return [];
  const pxPerDay = width / viewSpan(view);
  let spec = SPECS[0];
  for (const s of SPECS) {
    if (s.days * pxPerDay >= minGapPx) spec = s;
    else break;
  }
  // SPECS run coarse -> fine; the loop keeps the finest that still fits.
  const ticks: Tick[] = [];
  if (spec.unit === 'year') {
    const y0 = yearOf(view.start) - 1;
    const y1 = yearOf(view.end) + 1;
    for (let y = y0; y <= y1; y++) {
      const era = y <= 0 ? 1 - y : y;
      if (era % spec.step !== 0) continue;
      const t = yearStart(y);
      if (t < view.start || t > view.end) continue;
      ticks.push({ t, label: formatYear(y), major: era % (spec.step * 5) === 0 || spec.step === 1000 });
    }
  } else if (spec.unit === 'month') {
    const c0 = instantToCivil(view.start);
    let y = c0.year;
    let m = c0.month;
    for (let guard = 0; guard < 400; guard++) {
      const t = civilToInstant(y, m, 1);
      if (t > view.end) break;
      if (t >= view.start && (m - 1) % spec.step === 0) {
        ticks.push({ t, label: m === 1 ? formatYear(y) : `${MONTH_SHORT[m - 1]} ${formatYear(y)}`, major: m === 1 });
      }
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  } else if (spec.unit === 'day') {
    const d0 = Math.floor(view.start);
    for (let d = d0; d <= view.end; d++) {
      if (d < view.start) continue;
      if (spec.step > 1 && Math.floor(d) % spec.step !== 0) continue;
      const c = instantToCivil(d);
      ticks.push({ t: d, label: `${MONTH_SHORT[c.month - 1]} ${c.day}, ${formatYear(c.year)}`, major: c.day === 1 });
    }
  } else {
    const stepDays = spec.step / 24;
    const first = Math.floor(view.start) + Math.ceil((view.start - Math.floor(view.start)) / stepDays - 1e-9) * stepDays;
    for (let t = first; t <= view.end; t += stepDays) {
      const c = instantToCivil(t);
      const hh = String(c.hour).padStart(2, '0');
      const isMidnight = c.hour === 0 && c.minute === 0;
      ticks.push({
        t,
        label: isMidnight ? `${MONTH_SHORT[c.month - 1]} ${c.day}, ${formatYear(c.year)}` : `${hh}:${String(c.minute).padStart(2, '0')}`,
        major: isMidnight,
      });
    }
  }
  return ticks;
}
