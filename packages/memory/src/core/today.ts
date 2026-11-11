/**
 * Today's queue (task 0219): which verses to practise now, in what order.
 *
 * Pure and DOM-free; `now` always arrives as an argument. "Done today" is
 * derived from attempt timestamps (`lastPractisedAt`), never stored.
 */

import type { PassageView, Rung, RungView } from './types';
import { RUNG_ORDER } from './types';
import { isOptionalRung, WELL_LEARNED_LEVEL } from './ladder';
import { localDayStart } from './status';

/** Most brand-new verses started per local day. */
export const MAX_NEW_PER_DAY = 3;
/** Rough practice time per verse, used for the minutes estimate. */
export const SECONDS_PER_VERSE = 30;

/** Midnight local time for the day containing `ms` (one function, shared with `status.ts`). */
export const startOfLocalDay = localDayStart;

function startOfNextLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * The activity a verse's Practice button should start: the applicable one due
 * soonest; else the first applicable one below level 4; else the hardest one.
 * Null when nothing applies.
 */
export function suggestedRung(rungs: readonly RungView[], now: number): Rung | null {
  return pickSuggestedRung(
    rungs.filter((r) => r.applicable).map((r) => ({ rung: r.rung, dueAt: r.dueAt, level: r.level })),
    now,
  );
}

/**
 * The one rule behind every "which activity next" decision (Today's queue, the
 * verse page, Add and start): the candidate due soonest; else the first in
 * ladder order below level 4; else the hardest. Optional rungs (recite) are
 * ignored. Pass only the applicable candidates.
 */
export function pickSuggestedRung(
  candidates: readonly { rung: Rung; dueAt: number | null; level: number }[],
  now: number,
): Rung | null {
  const applicable = candidates.filter((r) => !isOptionalRung(r.rung));
  if (applicable.length === 0) return null;

  const due = applicable.filter((r) => r.dueAt !== null && r.dueAt <= now);
  if (due.length > 0) {
    due.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
    return due[0]!.rung;
  }

  for (const rung of RUNG_ORDER) {
    const rv = applicable.find((r) => r.rung === rung);
    if (rv && rv.level < WELL_LEARNED_LEVEL) return rv.rung;
  }
  return applicable[applicable.length - 1]!.rung;
}

export type VerseStatus = 'new' | 'learning' | 'known';

export interface VerseStatusInfo {
  status: VerseStatus;
  /** Min dueAt over applicable non-optional rungs; null if none scheduled. */
  nextReviewAt: number | null;
  /** Any applicable non-optional rung with dueAt <= now. */
  dueNow: boolean;
  /** Any non-optional rung practised at or after the start of today. */
  doneToday: boolean;
  /** Not new, and its first practice was today. */
  startedToday: boolean;
  /** The suggested rung has a resume point. */
  paused: boolean;
}

export function verseStatus(
  pv: PassageView,
  now: number,
  dayStart: number = startOfLocalDay(now),
): VerseStatusInfo {
  const core = pv.rungs.filter((r) => !isOptionalRung(r.rung));
  const applicable = core.filter((r) => r.applicable);

  const status: VerseStatus = core.every((r) => r.attempts === 0)
    ? 'new'
    : pv.wellLearned
      ? 'known'
      : 'learning';

  let nextReviewAt: number | null = null;
  let dueNow = false;
  for (const r of applicable) {
    if (r.dueAt === null) continue;
    if (nextReviewAt === null || r.dueAt < nextReviewAt) nextReviewAt = r.dueAt;
    if (r.dueAt <= now) dueNow = true;
  }

  const doneToday = core.some((r) => (r.lastPractisedAt ?? 0) >= dayStart && r.lastPractisedAt != null);

  let first: number | null = null;
  for (const r of core) {
    if (r.firstPractisedAt == null) continue;
    if (first === null || r.firstPractisedAt < first) first = r.firstPractisedAt;
  }
  const startedToday = status !== 'new' && first !== null && first >= dayStart;

  const sug = suggestedRung(pv.rungs, now);
  const paused = sug !== null && (pv.rungs.find((r) => r.rung === sug)?.resume ?? null) !== null;

  return { status, nextReviewAt, dueNow, doneToday, startedToday, paused };
}

/** Verses first practiced today; pass the all-lists passages for the global new-verse cap. */
export function countStartedToday(passages: readonly PassageView[], now: number): number {
  const dayStart = startOfLocalDay(now);
  return passages.filter((pv) => verseStatus(pv, now, dayStart).startedToday).length;
}

export interface TodayItem {
  passageId: number;
  reference: string;
  moduleId: string;
  verseCount: number;
  kind: 'review' | 'new';
  rung: Rung;
  dueAt: number | null;
  paused: boolean;
}

export interface TodayQueue {
  /** Remaining today, in order. */
  items: TodayItem[];
  reviewCount: number;
  newCount: number;
  /** Verses in scope done today. */
  doneToday: number;
  /** Verses in scope. */
  totalVerses: number;
  /** First new verse not in `items` ("Learn a new verse"). */
  nextNewAvailable: TodayItem | null;
  /** Earliest future local day with reviews, and how many verses share it. */
  upcoming: { day: number; count: number } | null;
  /** Rough estimate; 0 when items is empty. */
  minutes: number;
}

interface Entry {
  pv: PassageView;
  info: VerseStatusInfo;
  rung: Rung | null;
}

function toItem(e: Entry, kind: 'review' | 'new'): TodayItem {
  const rv = e.pv.rungs.find((r) => r.rung === e.rung);
  return {
    passageId: e.pv.passage.id,
    reference: e.pv.passage.reference,
    moduleId: e.pv.passage.moduleId,
    verseCount: e.pv.passage.verseCount,
    kind,
    rung: e.rung!,
    dueAt: rv?.dueAt ?? null,
    paused: e.info.paused,
  };
}

function byDueThenAdded(a: Entry, b: Entry): number {
  const ad = a.info.nextReviewAt ?? Infinity;
  const bd = b.info.nextReviewAt ?? Infinity;
  if (ad !== bd) return ad < bd ? -1 : 1;
  return byAdded(a, b);
}

function byAdded(a: Entry, b: Entry): number {
  if (a.pv.passage.addedAt !== b.pv.passage.addedAt) return a.pv.passage.addedAt - b.pv.passage.addedAt;
  return a.pv.passage.id - b.pv.passage.id;
}

export function todayQueue(
  passages: readonly PassageView[],
  now: number,
  opts: { dayStart?: number; skipped?: ReadonlySet<number>; startedToday?: number } = {},
): TodayQueue {
  const dayStart = opts.dayStart ?? startOfLocalDay(now);
  const skipped = opts.skipped;
  const entries: Entry[] = passages.map((pv) => ({
    pv,
    info: verseStatus(pv, now, dayStart),
    rung: suggestedRung(pv.rungs, now),
  }));
  const open = entries.filter(
    (e) => e.rung !== null && !e.info.doneToday && !(skipped?.has(e.pv.passage.id) ?? false),
  );

  const reviews = open.filter((e) => e.info.dueNow && e.info.status !== 'new').sort(byDueThenAdded);
  const news = open.filter((e) => e.info.status === 'new').sort(byAdded);
  // Callers that see only one list pass the count across all lists.
  const startedToday = opts.startedToday ?? entries.filter((e) => e.info.startedToday).length;
  const room = Math.max(0, MAX_NEW_PER_DAY - startedToday);

  const items = [
    ...reviews.map((e) => toItem(e, 'review')),
    ...news.slice(0, room).map((e) => toItem(e, 'new')),
  ];
  const nextNew = news[room];

  // Upcoming: earliest future day with reviews among non-new verses.
  const days = new Map<number, number>();
  for (const e of entries) {
    if (e.info.status === 'new') continue;
    let day: number | null = null;
    if (e.info.doneToday && e.info.dueNow) day = startOfNextLocalDay(now);
    else if (e.info.nextReviewAt !== null && e.info.nextReviewAt > now) {
      day = startOfLocalDay(e.info.nextReviewAt);
    }
    if (day !== null) days.set(day, (days.get(day) ?? 0) + 1);
  }
  let upcoming: TodayQueue['upcoming'] = null;
  for (const [day, count] of days) {
    if (upcoming === null || day < upcoming.day) upcoming = { day, count };
  }

  const minutes = items.length
    ? Math.max(
        1,
        Math.round((items.reduce((s, i) => s + Math.min(i.verseCount, 12), 0) * SECONDS_PER_VERSE) / 60),
      )
    : 0;

  return {
    items,
    reviewCount: reviews.length,
    newCount: Math.min(room, news.length),
    doneToday: entries.filter((e) => e.info.doneToday).length,
    totalVerses: passages.length,
    nextNewAvailable: nextNew ? toItem(nextNew, 'new') : null,
    upcoming,
    minutes,
  };
}

/**
 * "Practice anyway" order once today is done: not-yet-visited verses that are
 * due (even if done today) by earliest due, then every other non-new verse by
 * next review (unscheduled last), then new verses last (oldest first), so the
 * order is never empty while any verse can be practiced.
 */
export function anywayOrder(
  passages: readonly PassageView[],
  now: number,
  visited: ReadonlySet<number>,
): TodayItem[] {
  const dayStart = startOfLocalDay(now);
  const entries: Entry[] = passages
    .filter((pv) => !visited.has(pv.passage.id))
    .map((pv) => ({ pv, info: verseStatus(pv, now, dayStart), rung: suggestedRung(pv.rungs, now) }))
    .filter((e) => e.rung !== null);
  const old = entries.filter((e) => e.info.status !== 'new');
  const due = old.filter((e) => e.info.dueNow).sort(byDueThenAdded);
  const rest = old.filter((e) => !e.info.dueNow).sort(byDueThenAdded);
  const fresh = entries.filter((e) => e.info.status === 'new').sort(byAdded);
  return [...due, ...rest].map((e) => toItem(e, 'review')).concat(fresh.map((e) => toItem(e, 'new')));
}
