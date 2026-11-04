/**
 * Reading cursor helpers (task 0196): where a reading sits in its plan, the readings just before and after
 * today's, readings left overdue, the next reading to open after one, and where a reading's start and
 * end blocks belong in a chapter. Pure: plan + progress in, positions out.
 */
import type { PlanDefinition, Reading, VerseIdNumber } from './types';
import type { ProgressIndex } from './scheduler';
import { splitVid } from './versification';

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
