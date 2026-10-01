/**
 * PlanScheduler: where a reader is in a plan, what today's reading is, how far behind a fixed
 * schedule they are, and the stats. Pure: plan + enrollment + completions + date in, views out.
 */
import type { Completion, Enrollment, IsoDate, PlanDefinition, Reading, Weekday } from './types';
import { ALL_WEEKDAYS } from './types';
import { addDays, daysBetween, parseIsoDate, readingDate, weekdayOf } from './dates';
import { countVerses } from './versification';

/** Ticked readings per day: `day -> set of reading indexes`. */
export type ProgressIndex = Map<number, Set<number>>;

export function indexCompletions(completions: readonly Completion[], enrollmentId?: string): ProgressIndex {
  const out: ProgressIndex = new Map();
  for (const c of completions) {
    if (enrollmentId !== undefined && c.enrollmentId !== enrollmentId) continue;
    let set = out.get(c.day);
    if (!set) out.set(c.day, (set = new Set()));
    set.add(c.reading);
  }
  return out;
}

export function isDayDone(plan: PlanDefinition, progress: ProgressIndex, day: number): boolean {
  const readings = plan.days[day - 1]?.readings ?? [];
  if (readings.length === 0) return true;
  const set = progress.get(day);
  if (!set) return false;
  for (let i = 0; i < readings.length; i++) if (!set.has(i)) return false;
  return true;
}

/** First day not fully read, or null when the whole plan is done. */
export function firstUnreadDay(plan: PlanDefinition, progress: ProgressIndex): number | null {
  for (let d = 1; d <= plan.days.length; d++) if (!isDayDone(plan, progress, d)) return d;
  return null;
}

function readingDaySet(e: Pick<Enrollment, 'readingDays'>): Set<Weekday> {
  return new Set(e.readingDays && e.readingDays.length ? e.readingDays : ALL_WEEKDAYS);
}

export function isReadingDay(e: Pick<Enrollment, 'readingDays'>, date: IsoDate): boolean {
  return readingDaySet(e).has(weekdayOf(date));
}

/** Fixed pacing: the plan day scheduled for `date` (reading days counted from the start), 0 before the start. */
export function scheduledDay(e: Pick<Enrollment, 'readingDays' | 'startDate'>, date: IsoDate): number {
  if (daysBetween(e.startDate, date) < 0) return 0;
  const set = readingDaySet(e);
  const span = daysBetween(e.startDate, date) + 1;
  const weeks = Math.floor(span / 7);
  let n = weeks * set.size;
  let d = addDays(e.startDate, weeks * 7);
  for (; d <= date; d = addDays(d, 1)) if (set.has(weekdayOf(d))) n++;
  return n;
}

/** Fixed pacing: the date plan day `day` falls on. */
export function dateForDay(e: Pick<Enrollment, 'readingDays' | 'startDate'>, day: number): IsoDate {
  const set = readingDaySet(e);
  const weeks = Math.floor((day - 1) / set.size);
  let d = addDays(e.startDate, weeks * 7);
  let n = weeks * set.size;
  for (;;) {
    if (set.has(weekdayOf(d))) {
      n++;
      if (n >= day) return d;
    }
    d = addDays(d, 1);
  }
}

/** The `n`-th reading day counting from `from` (n = 1 is `from` itself when it is a reading day). */
function nthReadingDayFrom(e: Pick<Enrollment, 'readingDays'>, from: IsoDate, n: number): IsoDate {
  return dateForDay({ readingDays: e.readingDays, startDate: from }, Math.max(1, n));
}

export interface TodayReading {
  index: number;
  reading: Reading;
  done: boolean;
  verses: number;
}

export interface TodayView {
  enrollmentId: string;
  /** The stored plan key (`stock:<id>@<version>` for stock plans), for localizing the name. */
  planKey: string;
  planName: string;
  pacing: Enrollment['pacing'];
  /** The day to read now, or null when the plan is finished (or, fixed, a rest day with nothing due). */
  day: number | null;
  dayCount: number;
  readings: TodayReading[];
  /** True when every reading of `day` is ticked. */
  dayDone: boolean;
  /** Today is not one of the reader's reading days. */
  restDay: boolean;
  /** Fixed pacing: unread days scheduled before today. Always 0 for flexible plans. */
  behindBy: number;
  /** Fixed pacing: the unread days scheduled before today, oldest first. */
  missedDays: number[];
  /** Fixed pacing: plan days already read beyond today's. */
  aheadBy: number;
  completed: boolean;
  /** Fixed pacing: today is before the start date. */
  notStarted: boolean;
}

function readingsOf(plan: PlanDefinition, progress: ProgressIndex, day: number | null): TodayReading[] {
  if (day === null) return [];
  const set = progress.get(day);
  return (plan.days[day - 1]?.readings ?? []).map((reading, index) => ({
    index,
    reading,
    done: set?.has(index) ?? false,
    verses: countVerses(reading.start, reading.end),
  }));
}

export function todayView(plan: PlanDefinition, e: Enrollment, completions: readonly Completion[], today: IsoDate): TodayView {
  const progress = indexCompletions(completions, e.id);
  const dayCount = plan.days.length;
  const firstUnread = firstUnreadDay(plan, progress);
  const restDay = !isReadingDay(e, today);
  const base = { enrollmentId: e.id, planKey: e.planKey, planName: e.planName, pacing: e.pacing, dayCount, restDay };
  if (firstUnread === null || e.status === 'completed') {
    return { ...base, day: null, readings: [], dayDone: true, behindBy: 0, missedDays: [], aheadBy: 0, completed: true, notStarted: false };
  }
  if (e.pacing === 'flexible') {
    return {
      ...base, day: firstUnread, readings: readingsOf(plan, progress, firstUnread), dayDone: false,
      behindBy: 0, missedDays: [], aheadBy: 0, completed: false, notStarted: false,
    };
  }
  const rawScheduled = scheduledDay(e, today);
  const scheduled = Math.min(rawScheduled, dayCount);
  if (scheduled === 0) {
    return {
      ...base, day: null, readings: [], dayDone: false, behindBy: 0, missedDays: [], aheadBy: 0, completed: false,
      notStarted: true,
    };
  }
  // Past the scheduled end: every unread day is overdue; show the first of them.
  const pastEnd = rawScheduled > dayCount;
  // On a reading day, today's own day is due today, not missed; on a rest day the last scheduled day is.
  const dueThrough = pastEnd || restDay ? scheduled : scheduled - 1;
  const missedDays: number[] = [];
  for (let d = 1; d <= dueThrough; d++) if (!isDayDone(plan, progress, d)) missedDays.push(d);
  let aheadBy = 0;
  for (let d = scheduled + 1; d <= dayCount && isDayDone(plan, progress, d); d++) aheadBy++;
  const day = pastEnd ? firstUnread : restDay ? null : scheduled;
  return {
    ...base,
    day,
    readings: readingsOf(plan, progress, day),
    dayDone: day !== null && isDayDone(plan, progress, day),
    behindBy: missedDays.length,
    missedDays,
    aheadBy,
    completed: false,
    notStarted: false,
  };
}

export interface PlanStats {
  daysDone: number;
  dayCount: number;
  readingsDone: number;
  readingsTotal: number;
  /** Share of the plan's verses read, 0..100. */
  percent: number;
  /** The remaining days laid on reading days from today (fixed and on schedule: the scheduled last day). */
  estimatedFinish: IsoDate | null;
  /** Fixed: the date the plan was scheduled to end. */
  scheduledFinish: IsoDate | null;
  /** Consecutive reading days, up to today, on which something was read (computed, never stored). */
  streak: number;
}

export function planStats(
  plan: PlanDefinition, e: Enrollment, completions: readonly Completion[], today: IsoDate, rolloverHour?: number
): PlanStats {
  const mine = completions.filter((c) => c.enrollmentId === e.id);
  const progress = indexCompletions(mine);
  let daysDone = 0;
  let readingsTotal = 0;
  let readingsDone = 0;
  let versesTotal = 0;
  let versesDone = 0;
  plan.days.forEach((d, i) => {
    const set = progress.get(i + 1);
    if (isDayDone(plan, progress, i + 1)) daysDone++;
    d.readings.forEach((r, j) => {
      const v = countVerses(r.start, r.end);
      readingsTotal++;
      versesTotal += v;
      if (set?.has(j)) {
        readingsDone++;
        versesDone += v;
      }
    });
  });
  const remaining = plan.days.length - daysDone;
  const scheduledFinish = e.pacing === 'fixed' && plan.days.length > 0 ? dateForDay(e, plan.days.length) : null;
  let estimatedFinish: IsoDate | null = null;
  const onSchedule = e.pacing === 'fixed' && todayView(plan, e, mine, today).behindBy === 0;
  if (remaining === 0) estimatedFinish = null;
  else if (onSchedule && scheduledFinish && scheduledFinish >= today) estimatedFinish = scheduledFinish;
  else {
    const todayDay = firstUnreadDay(plan, progress);
    const readToday = mine.some((c) => readingDate(new Date(c.at), rolloverHour) === today);
    const from = readToday && todayDay !== null ? addDays(today, 1) : today;
    estimatedFinish = nthReadingDayFrom(e, from, remaining);
  }
  return {
    daysDone,
    dayCount: plan.days.length,
    readingsDone,
    readingsTotal,
    percent: versesTotal === 0 ? 0 : Math.floor((versesDone / versesTotal) * 1000) / 10,
    estimatedFinish,
    scheduledFinish,
    streak: computeStreak(e, mine, today, rolloverHour),
  };
}

function computeStreak(e: Enrollment, completions: readonly Completion[], today: IsoDate, rolloverHour?: number): number {
  const dates = new Set(completions.map((c) => readingDate(new Date(c.at), rolloverHour)));
  let streak = 0;
  let d = today;
  // Today not read yet does not break the streak.
  if (!dates.has(d)) d = addDays(d, -1);
  for (let guard = 0; guard < 4000; guard++) {
    if (parseIsoDate(d) === null || daysBetween(e.startDate, d) < 0) break;
    if (isReadingDay(e, d)) {
      if (!dates.has(d)) break;
      streak++;
    }
    d = addDays(d, -1);
  }
  return streak;
}

/**
 * Fixed pacing "reset without guilt": the start date that puts the first unread day on `today`
 * (or on the next reading day when today is a rest day). Read days stay read.
 */
export function shiftedStartDate(plan: PlanDefinition, e: Enrollment, completions: readonly Completion[], today: IsoDate): IsoDate {
  const first = firstUnreadDay(plan, indexCompletions(completions, e.id)) ?? plan.days.length;
  const k = isReadingDay(e, today) ? first : first - 1;
  if (k <= 0) {
    let d = addDays(today, 1);
    while (!isReadingDay(e, d)) d = addDays(d, 1);
    return d;
  }
  let count = 0;
  let d = today;
  for (;;) {
    if (isReadingDay(e, d)) {
      count++;
      if (count === k) return d;
    }
    d = addDays(d, -1);
  }
}

/** How to catch up: read `extraPerDay` extra days' readings on each of the next `days` reading days. */
export function catchUpSuggestion(behindBy: number, overDays = 7): { extraPerDay: number; days: number } | null {
  if (behindBy <= 0) return null;
  const extraPerDay = Math.max(1, Math.ceil(behindBy / Math.max(1, overDays)));
  return { extraPerDay, days: Math.ceil(behindBy / extraPerDay) };
}

export type DayStatus = 'done' | 'partial' | 'missed' | 'current' | 'upcoming';

/** One status per plan day, for the plan-detail grid. */
export function dayStatuses(plan: PlanDefinition, e: Enrollment, completions: readonly Completion[], today: IsoDate): DayStatus[] {
  const progress = indexCompletions(completions, e.id);
  const view = todayView(plan, e, completions, today);
  const missed = new Set(view.missedDays);
  return plan.days.map((_, i) => {
    const day = i + 1;
    if (isDayDone(plan, progress, day)) return 'done';
    if (day === view.day) return 'current';
    if (missed.has(day)) return 'missed';
    if ((progress.get(day)?.size ?? 0) > 0) return 'partial';
    return 'upcoming';
  });
}
