/**
 * PlanBuilder: "these passages, at this pace" in, plan days out. Pure and deterministic, so a
 * stock plan built from a spec is the same on every machine (a drift test pins them).
 *
 * Granularity is the verse: a day may be a few verses, one-chapter books may span days, and an
 * as-listed scope may pick out single verses (Proverbs) or follow a chronological order that cuts
 * through chapters.
 */
import type { BuilderSpec, BuilderTrackSpec, IsoDate, PlanDay, Reading, ScopeRange, VerseIdNumber, Weekday } from './types';
import { ALL_WEEKDAYS } from './types';
import { countVerses, estimateMinutes, isValidVerseId, nextVerse, splitByBook, splitVid, versesBetween, versesInChapter } from './versification';
import { addDays, parseIsoDate, weekdayOf } from './dates';

export class PlanBuildError extends Error {
  constructor(public readonly code: 'empty_scope' | 'invalid_range' | 'invalid_pace' | 'too_many_days', message: string) {
    super(message);
    this.name = 'PlanBuildError';
  }
}

export interface BuildOptions {
  /** Chronological order of the whole Bible as ordered ranges (defaults to the shipped order). */
  chronology?: readonly ScopeRange[];
}

/** Upper bound on plan length (ten years of daily reading). */
export const MAX_PLAN_DAYS = 3660;

/** Cut preferences: a cut after a scope piece's end beats one at a chapter end, which beats one mid-chapter. */
const PRIORITY_VERSE = 1;
const PRIORITY_CHAPTER = 2;
const PRIORITY_PIECE = 3;

interface Stream {
  verses: VerseIdNumber[];
  /** `priority[i]`: how good a cut right after `verses[i]` is. */
  priority: number[];
}

let defaultChronology: readonly ScopeRange[] | undefined;

/** Registered by the stock module so the builder does not import the data itself. */
export function setDefaultChronology(order: readonly ScopeRange[]): void {
  defaultChronology = order;
}

export function validateRange(r: ScopeRange): void {
  if (!isValidVerseId(r.start) || !isValidVerseId(r.end) || r.end < r.start) {
    throw new PlanBuildError('invalid_range', `Invalid range ${r.start}-${r.end}`);
  }
}

/** Sort ranges canonically and merge overlapping or adjacent ones. */
export function mergeRanges(ranges: readonly ScopeRange[]): ScopeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: ScopeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && (r.start <= last.end || r.start === nextVerse(last.end))) {
      if (r.end > last.end) last.end = r.end;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

function orderScope(scope: readonly ScopeRange[], order: BuilderSpec['order'], chronology: readonly ScopeRange[] | undefined): ScopeRange[] {
  if (order === 'as-listed') return scope.map((r) => ({ ...r }));
  const merged = mergeRanges(scope);
  if (order === 'canonical') return merged;
  const chrono = chronology ?? defaultChronology;
  if (!chrono || chrono.length === 0) return merged;
  const out: ScopeRange[] = [];
  for (const seg of chrono) {
    for (const m of merged) {
      const start = Math.max(seg.start, m.start);
      const end = Math.min(seg.end, m.end);
      if (start <= end) out.push({ start, end });
    }
  }
  // Anything the chronology does not cover keeps its canonical place at the end.
  const covered = mergeRanges(out);
  for (const m of merged) {
    for (const gap of subtract(m, covered)) out.push(gap);
  }
  return out;
}

function subtract(r: ScopeRange, covered: readonly ScopeRange[]): ScopeRange[] {
  const out: ScopeRange[] = [];
  let cur: VerseIdNumber | null = r.start;
  for (const c of covered) {
    if (cur === null || c.end < cur || c.start > r.end) continue;
    if (c.start > cur) out.push({ start: cur, end: prevVerseWithin(c.start, cur) });
    cur = c.end >= r.end ? null : nextVerse(c.end);
  }
  if (cur !== null && cur <= r.end) out.push({ start: cur, end: r.end });
  return out;
}

function prevVerseWithin(id: VerseIdNumber, floor: VerseIdNumber): VerseIdNumber {
  let last = floor;
  for (const v of versesBetween(floor, id)) {
    if (v >= id) break;
    last = v;
  }
  return last;
}

function toStream(pieces: readonly ScopeRange[]): Stream {
  const verses: VerseIdNumber[] = [];
  const priority: number[] = [];
  for (const piece of pieces) {
    for (const part of splitByBook(piece)) {
      for (const v of versesBetween(part.start, part.end)) {
        const { book, chapter, verse } = splitVid(v);
        verses.push(v);
        priority.push(verse === versesInChapter(book, chapter) ? PRIORITY_CHAPTER : PRIORITY_VERSE);
      }
    }
    if (priority.length > 0) priority[priority.length - 1] = PRIORITY_PIECE;
  }
  return { verses, priority };
}

/** Indexes `i` such that a chapter-mode day may end after `verses[i]` (a chapter end or a piece end). */
function unitEnds(s: Stream): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.verses.length; i++) if (s.priority[i] >= PRIORITY_CHAPTER) out.push(i);
  return out;
}

/** Count the reading days from `start` to `end` inclusive. */
export function countReadingDays(start: IsoDate, end: IsoDate, readingDays: readonly Weekday[] = ALL_WEEKDAYS): number {
  const days = new Set(readingDays.length ? readingDays : ALL_WEEKDAYS);
  const a = parseIsoDate(start);
  const z = parseIsoDate(end);
  if (!a || !z || z < a) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (days.has(weekdayOf(d))) n++;
  return n;
}

function resolveDayCount(spec: BuilderSpec, streams: Stream[]): number {
  const pace = spec.pace;
  const maxVerses = Math.max(...streams.map((s) => s.verses.length));
  let days: number;
  switch (pace.by) {
    case 'days':
      days = pace.days;
      break;
    case 'endDate':
      days = countReadingDays(pace.startDate, pace.endDate, spec.readingDays);
      break;
    case 'chaptersPerDay':
      if (!(pace.chapters > 0)) throw new PlanBuildError('invalid_pace', 'Chapters per day must be positive');
      days = Math.max(...streams.map((s) => Math.ceil(unitEnds(s).length / pace.chapters)));
      break;
    case 'versesPerDay':
      if (!(pace.verses > 0)) throw new PlanBuildError('invalid_pace', 'Verses per day must be positive');
      days = Math.ceil(maxVerses / pace.verses);
      break;
    default:
      throw new PlanBuildError('invalid_pace', 'Unknown pace');
  }
  if (!Number.isFinite(days) || days < 1) throw new PlanBuildError('invalid_pace', 'A plan needs at least one day');
  days = Math.floor(days);
  if (days > MAX_PLAN_DAYS) throw new PlanBuildError('too_many_days', `A plan can have at most ${MAX_PLAN_DAYS} days`);
  // Never more days than verses in the longest track; shorter tracks get empty days at the end.
  return Math.min(days, maxVerses);
}

/** Cut positions (inclusive end index of each day), length = days. */
function cutsChapter(s: Stream, days: number, perDay?: number): number[] | null {
  const ends = unitEnds(s);
  if (perDay !== undefined) {
    // Exactly `perDay` chapters a day; a shorter track simply runs out early.
    const out: number[] = [];
    for (let d = 1; d <= days && (d - 1) * perDay < ends.length; d++) out.push(ends[Math.min(ends.length, d * perDay) - 1]);
    return out;
  }
  if (ends.length < days) return null;
  const total = s.verses.length;
  const out: number[] = [];
  let prevJ = -1;
  for (let k = 1; k < days; k++) {
    const target = (k * total) / days;
    const maxJ = ends.length - 1 - (days - k);
    let best = prevJ + 1;
    let bestDist = Infinity;
    for (let j = prevJ + 1; j <= maxJ; j++) {
      const dist = Math.abs(ends[j] + 1 - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = j;
      } else if (ends[j] + 1 > target) {
        break;
      }
    }
    out.push(ends[best]);
    prevJ = best;
  }
  out.push(total - 1);
  return out;
}

function cutsVerse(s: Stream, days: number): number[] {
  const total = s.verses.length;
  const per = total / days;
  const tol = Math.max(0.5, per * 0.3);
  const out: number[] = [];
  let prev = -1;
  for (let k = 1; k < days; k++) {
    const target = (k * total) / days; // verses read by the end of day k
    const lo = prev + 1;
    const hi = total - 1 - (days - k);
    let best = -1;
    let bestPri = -1;
    let bestDist = Infinity;
    const from = Math.max(lo, Math.floor(target - tol) - 1);
    const to = Math.min(hi, Math.ceil(target + tol) - 1);
    for (let i = from; i <= to; i++) {
      const dist = Math.abs(i + 1 - target);
      if (dist > tol) continue;
      const pri = s.priority[i];
      if (pri > bestPri || (pri === bestPri && dist < bestDist)) {
        best = i;
        bestPri = pri;
        bestDist = dist;
      }
    }
    if (best < 0) best = Math.min(hi, Math.max(lo, Math.round(target) - 1));
    out.push(best);
    prev = best;
  }
  out.push(total - 1);
  return out;
}

/** Turn a run of verses into readings: contiguous verses in one book become one range. */
export function versesToReadings(verses: readonly VerseIdNumber[], track?: string): Reading[] {
  const out: Reading[] = [];
  for (const v of verses) {
    const last = out[out.length - 1];
    if (last && nextVerse(last.end) === v && splitVid(last.end).book === splitVid(v).book) {
      last.end = v;
    } else {
      out.push(track ? { start: v, end: v, track } : { start: v, end: v });
    }
  }
  return out;
}

function buildTrack(s: Stream, days: number, spec: BuilderSpec, track?: string): Reading[][] {
  if (s.verses.length === 0) return Array.from({ length: days }, () => []);
  const effectiveDays = Math.min(days, s.verses.length);
  let cuts: number[] | null = null;
  if (spec.split === 'chapter') {
    const perDay = spec.pace.by === 'chaptersPerDay' ? spec.pace.chapters : undefined;
    cuts = cutsChapter(s, effectiveDays, perDay);
  }
  if (!cuts) cuts = cutsVerse(s, effectiveDays);
  const out: Reading[][] = [];
  let from = 0;
  for (const cut of cuts) {
    out.push(versesToReadings(s.verses.slice(from, cut + 1), track));
    from = cut + 1;
  }
  while (out.length < days) out.push([]);
  return out;
}

function trackSpecs(spec: BuilderSpec): (BuilderTrackSpec | { id: undefined; name: string; scope: ScopeRange[] })[] {
  if (spec.tracks && spec.tracks.length > 0) return spec.tracks;
  return [{ id: undefined, name: spec.name, scope: spec.scope }];
}

/** Build the days of a plan. Throws PlanBuildError on an empty scope, a bad range or a bad pace. */
export function buildPlanDays(spec: BuilderSpec, options: BuildOptions = {}): PlanDay[] {
  const tracks = trackSpecs(spec);
  for (const t of tracks) for (const r of t.scope) validateRange(r);
  const streams = tracks.map((t) => toStream(orderScope(t.scope, spec.order, options.chronology)));
  if (streams.every((s) => s.verses.length === 0)) throw new PlanBuildError('empty_scope', 'Nothing to read');
  const days = resolveDayCount(spec, streams);
  const perTrack = streams.map((s, i) => buildTrack(s, days, spec, tracks[i].id));
  const out: PlanDay[] = [];
  for (let d = 0; d < days; d++) out.push({ readings: perTrack.flatMap((t) => t[d] ?? []) });
  return out;
}

export interface PlanPreview {
  days: number;
  verses: number;
  avgMinutes: number;
  maxMinutes: number;
  firstDays: PlanDay[];
}

/** Summary for the builder's live preview. */
export function previewPlan(spec: BuilderSpec, options: BuildOptions = {}): PlanPreview {
  const days = buildPlanDays(spec, options);
  const perDay = days.map((d) => d.readings.reduce((n, r) => n + countRange(r), 0));
  const verses = perDay.reduce((a, b) => a + b, 0);
  return {
    days: days.length,
    verses,
    avgMinutes: estimateMinutes(verses / Math.max(1, days.length)),
    maxMinutes: estimateMinutes(Math.max(0, ...perDay)),
    firstDays: days.slice(0, 7),
  };
}

function countRange(r: Reading): number {
  return countVerses(r.start, r.end);
}
