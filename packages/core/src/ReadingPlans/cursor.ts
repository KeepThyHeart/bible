/**
 * Reading cursor helpers (task 0196): where a reading sits in its plan, the readings just before and after
 * today's, readings left overdue, the next reading to open after one, and where a reading's start and
 * end blocks belong in a chapter. Pure: plan + progress in, positions out.
 */
import type { PlanDefinition, Reading, VerseIdNumber } from './types';
import type { ProgressIndex, TodayView } from './scheduler';
import { firstUnreadDay } from './scheduler';
import { chapterCount, splitVid } from './versification';

/** One reading with its place in the plan (`day` is 1-based, `index` 0-based within the day). */
export interface PlanReadingRef {
  day: number;
  index: number;
  reading: Reading;
}

/** Every reading of the plan in reading order. */
export function flattenPlan(plan: PlanDefinition): PlanReadingRef[] {
  const out: PlanReadingRef[] = [];
  plan.days.forEach((d, i) => d.readings.forEach((reading, index) => out.push({ day: i + 1, index, reading })));
  return out;
}

function positionOf(flat: readonly PlanReadingRef[], day: number, index: number): number {
  return flat.findIndex((r) => r.day === day && r.index === index);
}

/**
 * The reading just before today's block and the one just after it, for the "Previous / Next" strip.
 * `day` is the plan day shown today (all its readings are on the card already, so the strip steps outside them).
 */
export function readingNeighbours(plan: PlanDefinition, day: number): { previous: PlanReadingRef | null; next: PlanReadingRef | null } {
  const flat = flattenPlan(plan);
  const first = flat.findIndex((r) => r.day === day);
  if (first < 0) return { previous: null, next: null };
  let last = first;
  while (last + 1 < flat.length && flat[last + 1].day === day) last++;
  return { previous: first > 0 ? flat[first - 1] : null, next: last + 1 < flat.length ? flat[last + 1] : null };
}

/** Unread readings of the given (missed) days, oldest first. */
export function overdueReadings(plan: PlanDefinition, progress: ProgressIndex, missedDays: readonly number[]): PlanReadingRef[] {
  const out: PlanReadingRef[] = [];
  for (const day of [...missedDays].sort((a, b) => a - b)) {
    const done = progress.get(day);
    plan.days[day - 1]?.readings.forEach((reading, index) => {
      if (!done?.has(index)) out.push({ day, index, reading });
    });
  }
  return out;
}

/** The reading after this one: the next passage of the same day, else the first reading of the next day. */
export function nextReadingAfter(plan: PlanDefinition, day: number, index: number): PlanReadingRef | null {
  const flat = flattenPlan(plan);
  const at = positionOf(flat, day, index);
  return at >= 0 && at + 1 < flat.length ? flat[at + 1] : null;
}

/**
 * Where a reading's blocks belong while a chapter's verses are drawn in order. `verseId` is the verse being
 * drawn, `prev` / `next` its neighbours in the chapter on screen (null at the chapter's edges).
 * `start`: show the start block before this verse; `end`: show the end block after it. A reading that spills
 * past the chapter (Genesis 1-3 seen in chapter 1) shows its start only where it begins and its end only where it ends.
 */
export function blockPlacement(
  reading: Pick<Reading, 'start' | 'end'>, verseId: VerseIdNumber, prev: VerseIdNumber | null, next: VerseIdNumber | null,
): { start: boolean; end: boolean } {
  const sameChapter = (a: VerseIdNumber, b: VerseIdNumber) => {
    const x = splitVid(a);
    const y = splitVid(b);
    return x.book === y.book && x.chapter === y.chapter;
  };
  const start = verseId >= reading.start && (prev === null ? sameChapter(reading.start, verseId) : prev < reading.start);
  const end = verseId <= reading.end && (next === null ? sameChapter(reading.end, verseId) : next > reading.end);
  return { start: start && verseId <= reading.end, end: end && verseId >= reading.start };
}

/**
 * The plan days around the reader's place: `current` is the first day with an unfinished reading, `previous`
 * and `next` its neighbours (null at the plan's edges). A finished plan has no current or next day and
 * `previous` is the last day.
 */
export function currentDayWindow(
  plan: PlanDefinition, progress: ProgressIndex,
): { previous: number | null; current: number | null; next: number | null } {
  const current = firstUnreadDay(plan, progress);
  const count = plan.days.length;
  if (current === null) return { previous: count > 0 ? count : null, current: null, next: null };
  return { previous: current > 1 ? current - 1 : null, current, next: current < count ? current + 1 : null };
}

/** The one shared "today" for Home, the Today tab and the reader bar: the day to read now, else the next one due. */
export function focusDay(view: TodayView): number | null {
  return view.day ?? view.upcomingDay;
}

/** One of today's readings with its tick state. */
export interface TodayReadingRef extends PlanReadingRef {
  done: boolean;
}

/**
 * Today's readings, ticked and unticked, in reading order: the focus day, then the catch-up quota days.
 * The set is stable through the day (see `todayView`), so a reading stays in it after it is ticked.
 */
export function todaysReadings(view: TodayView): TodayReadingRef[] {
  const out: TodayReadingRef[] = [];
  if (view.day !== null) for (const r of view.readings) out.push({ day: view.day, index: r.index, reading: r.reading, done: r.done });
  for (const c of view.catchUp?.days ?? []) for (const r of c.readings) out.push({ day: c.day, index: r.index, reading: r.reading, done: r.done });
  return out;
}

/** The unticked subset of `todaysReadings(view)`. */
export function dueReadings(view: TodayView): PlanReadingRef[] {
  return todaysReadings(view).filter((r) => !r.done).map(({ day, index, reading }) => ({ day, index, reading }));
}

/**
 * The next unticked reading after (`day`, `index`) in `todaysReadings(view)` order (positional, so it works right after
 * the reading was ticked), or null when none is left: "Day N done". A flexible plan stays within the reading's own day.
 */
export function nextDueReading(view: TodayView, day: number, index: number): PlanReadingRef | null {
  const all = todaysReadings(view);
  const at = all.findIndex((r) => r.day === day && r.index === index);
  if (at < 0) return null;
  for (let i = at + 1; i < all.length; i++) {
    const r = all[i];
    if (view.pacing === 'flexible' && r.day !== day) return null;
    if (!r.done) return { day: r.day, index: r.index, reading: r.reading };
  }
  return null;
}

function chaptersOf(reading: Pick<Reading, 'start' | 'end'>): { book: number; chapter: number }[] {
  const a = splitVid(reading.start);
  const b = splitVid(reading.end);
  const out: { book: number; chapter: number }[] = [];
  for (let book = a.book; book <= b.book; book++) {
    const from = book === a.book ? a.chapter : 1;
    const to = book === b.book ? b.chapter : chapterCount(book);
    for (let chapter = from; chapter <= to; chapter++) out.push({ book, chapter });
  }
  return out;
}

/** The first and last chapter a reading touches and how many chapters it spans. */
export function chapterSpan(
  reading: Pick<Reading, 'start' | 'end'>,
): { first: { book: number; chapter: number }; last: { book: number; chapter: number }; count: number } {
  const a = splitVid(reading.start);
  const b = splitVid(reading.end);
  return { first: { book: a.book, chapter: a.chapter }, last: { book: b.book, chapter: b.chapter }, count: chaptersOf(reading).length };
}

/** "Chapter n of count" of a reading for the chapter on screen, or null when the chapter is not part of it. */
export function chapterOf(
  reading: Pick<Reading, 'start' | 'end'>, book: number, chapter: number,
): { n: number; count: number } | null {
  const list = chaptersOf(reading);
  const i = list.findIndex((c) => c.book === book && c.chapter === chapter);
  return i < 0 ? null : { n: i + 1, count: list.length };
}

/** The reading's last verse is in this chapter. */
export function endsInChapter(reading: Pick<Reading, 'end'>, book: number, chapter: number): boolean {
  const e = splitVid(reading.end);
  return e.book === book && e.chapter === chapter;
}

/** The chapter after (`book`, `chapter`) within the reading's own chapter list (across book boundaries), or null. */
export function nextChapterIn(
  reading: Pick<Reading, 'start' | 'end'>, book: number, chapter: number,
): { book: number; chapter: number } | null {
  const list = chaptersOf(reading);
  const i = list.findIndex((c) => c.book === book && c.chapter === chapter);
  return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
}
