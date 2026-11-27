import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { VERSE_COUNTS } from './versificationData';
import {
  TOTAL_VERSES, booksRange, countVerses, formatReading, vid, versesBetween, isValidVerseId,
} from './versification';
import { buildPlanDays, countReadingDays, mergeRanges, previewPlan, PlanBuildError } from './builder';
import { addDays, readingDate, weekdayOf, daysBetween } from './dates';
import {
  catchUpSuggestion, dateForDay, dayStatuses, measurePace, planStats, scheduledDay, shiftedStartDate, todayView,
} from './scheduler';
import { CHRONOLOGICAL_ORDER, getStockPlan, listStockPlans, stockPlanIds, stockPlanKey } from './stock';
import type { BuilderSpec, Completion, Enrollment, PlanDay, PlanDefinition, Weekday } from './types';
import { validateBuilderSpec, validateEnrollment, validatePlanDefinition, ReadingPlanDataError } from './validate';

const name = (b: number) => ['', 'Genesis', 'Exodus'][b] ?? `B${b}`;

function versesOf(days: PlanDay[], track?: string): number[] {
  const out: number[] = [];
  for (const d of days) for (const r of d.readings) if (track === undefined || r.track === track) out.push(...versesBetween(r.start, r.end));
  return out;
}

function spec(over: Partial<BuilderSpec>): BuilderSpec {
  return { name: 'Test', scope: [booksRange(1)], order: 'canonical', pace: { by: 'days', days: 10 }, split: 'chapter', ...over };
}

describe('versification', () => {
  it('matches the checked-in KJV versification file', () => {
    const file = JSON.parse(readFileSync(join(__dirname, '../../../../apps/desktop/scripts/data/kjv-versification.json'), 'utf8'));
    expect(file.books.map((b: { verse_counts: number[] }) => b.verse_counts)).toEqual(VERSE_COUNTS);
    expect(VERSE_COUNTS.flat().reduce((a, b) => a + b, 0)).toBe(TOTAL_VERSES);
    expect(countVerses(vid(1, 1, 1), vid(66, 22, 21))).toBe(TOTAL_VERSES);
  });

  it('counts and validates ranges', () => {
    expect(countVerses(vid(19, 119, 1), vid(19, 119, 176))).toBe(176);
    expect(countVerses(vid(1, 1, 30), vid(1, 2, 2))).toBe(4);
    expect(isValidVerseId(vid(65, 1, 25))).toBe(true);
    expect(isValidVerseId(vid(65, 1, 26))).toBe(false);
  });

  it('formats readings', () => {
    expect(formatReading({ start: vid(1, 1, 1), end: vid(1, 3, 24) }, name)).toBe('Genesis 1-3');
    expect(formatReading({ start: vid(1, 1, 1), end: vid(1, 1, 31) }, name)).toBe('Genesis 1');
    expect(formatReading({ start: vid(1, 1, 1), end: vid(1, 50, 26) }, name)).toBe('Genesis');
    expect(formatReading({ start: vid(1, 1, 3), end: vid(1, 1, 5) }, name)).toBe('Genesis 1:3-5');
    expect(formatReading({ start: vid(1, 1, 3), end: vid(1, 2, 5) }, name)).toBe('Genesis 1:3-2:5');
    expect(formatReading({ start: vid(65, 1, 1), end: vid(65, 1, 8) }, () => 'Jude')).toBe('Jude 1:1-8');
    expect(formatReading({ start: vid(65, 1, 1), end: vid(65, 1, 25) }, () => 'Jude')).toBe('Jude');
  });
});

describe('dates', () => {
  it('rolls the reading day over at the rollover hour', () => {
    expect(readingDate(new Date(2026, 9, 2, 2, 30), 3)).toBe('2026-10-01');
    expect(readingDate(new Date(2026, 9, 2, 3, 0), 3)).toBe('2026-10-02');
    expect(readingDate(new Date(2026, 9, 2, 0, 30), 0)).toBe('2026-10-02');
  });
  it('does date maths across months and leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(weekdayOf('2026-10-01')).toBe(4);
  });
});

describe('PlanBuilder', () => {
  it('covers every verse of the scope exactly once, in order', () => {
    const days = buildPlanDays(spec({ scope: [booksRange(1, 2)], pace: { by: 'days', days: 30 } }));
    expect(days).toHaveLength(30);
    const verses = versesOf(days);
    expect(verses).toEqual([...versesBetween(vid(1, 1, 1), vid(2, 40, 38))]);
  });

  it('keeps whole chapters in chapter mode and balances by verses', () => {
    const days = buildPlanDays(spec({ pace: { by: 'days', days: 10 } }));
    for (const d of days) for (const r of d.readings) expect(r.start % 1000).toBe(1);
    const sizes = days.map((d) => d.readings.reduce((n, r) => n + countVerses(r.start, r.end), 0));
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.5);
  });

  it('gives exactly N chapters a day for a chapters-per-day pace', () => {
    const days = buildPlanDays(spec({ pace: { by: 'chaptersPerDay', chapters: 3 } }));
    expect(days).toHaveLength(17);
    expect(formatReading(days[0].readings[0], name)).toBe('Genesis 1-3');
    expect(formatReading(days[16].readings[0], name)).toBe('Genesis 49-50');
  });

  it('splits a one-chapter book across days (Jude in 3 days)', () => {
    const days = buildPlanDays(spec({ scope: [booksRange(65)], pace: { by: 'days', days: 3 } }));
    expect(days.map((d) => d.readings.map((r) => [r.start % 1000, r.end % 1000]))).toEqual([[[1, 8]], [[9, 17]], [[18, 25]]]);
  });

  it('falls back to verse splitting when there are more days than chapters', () => {
    const days = buildPlanDays(spec({ scope: [booksRange(19, 19)], pace: { by: 'days', days: 300 } }));
    expect(days).toHaveLength(300);
    expect(versesOf(days)).toHaveLength(2461);
    expect(days.every((d) => d.readings.length > 0)).toBe(true);
  });

  it('balances by verses in verse mode, preferring chapter ends', () => {
    const days = buildPlanDays(spec({ scope: [booksRange(19)], split: 'verse', pace: { by: 'days', days: 60 } }));
    const sizes = days.map((d) => d.readings.reduce((n, r) => n + countVerses(r.start, r.end), 0));
    const avg = 2461 / 60;
    for (const s of sizes) expect(s).toBeLessThanOrEqual(avg * 1.7);
    // Psalm 119 (176 verses) is cut inside the chapter.
    const cut119 = days.some((d) => d.readings.some((r) => Math.floor(r.end / 1000) % 1000 === 119 && r.end % 1000 < 176));
    expect(cut119).toBe(true);
  });

  it('keeps selected verses in the listed order', () => {
    const days = buildPlanDays(spec({
      order: 'as-listed', split: 'verse', pace: { by: 'days', days: 2 },
      scope: [{ start: vid(20, 3, 5), end: vid(20, 3, 6) }, { start: vid(20, 1, 7), end: vid(20, 1, 7) }],
    }));
    expect(days.map((d) => d.readings.map((r) => [r.start, r.end]))).toEqual([
      // A cut at the end of a listed piece beats an equally close one inside it.
      [[vid(20, 3, 5), vid(20, 3, 6)]], [[vid(20, 1, 7), vid(20, 1, 7)]],
    ]);
  });

  it('resolves an end date with rest days', () => {
    // Mon 5 Oct 2026 .. Sun 18 Oct 2026, weekdays only = 10 days.
    expect(countReadingDays('2026-10-05', '2026-10-18', [1, 2, 3, 4, 5])).toBe(10);
    const days = buildPlanDays(spec({ pace: { by: 'endDate', startDate: '2026-10-05', endDate: '2026-10-18' }, readingDays: [1, 2, 3, 4, 5] }));
    expect(days).toHaveLength(10);
  });

  it('zips tracks to the same number of days', () => {
    const days = buildPlanDays(spec({
      scope: [], pace: { by: 'days', days: 31 },
      tracks: [{ id: 'ps', name: 'Psalms', scope: [booksRange(19)] }, { id: 'pr', name: 'Proverbs', scope: [booksRange(20)] }],
    }));
    expect(days).toHaveLength(31);
    expect(days.every((d) => d.readings.some((r) => r.track === 'pr'))).toBe(true);
    expect(versesOf(days, 'ps')).toHaveLength(2461);
  });

  it('orders chronologically by intersecting the chronological order', () => {
    const days = buildPlanDays(spec({ scope: [booksRange(9, 14), booksRange(19)], order: 'chronological', split: 'verse', pace: { by: 'days', days: 40 } }));
    const verses = versesOf(days);
    expect(new Set(verses).size).toBe(verses.length);
    expect(verses.length).toBe(countVerses(vid(9, 1, 1), vid(14, 36, 23)) + 2461);
    // Some psalm is read before the end of 2 Chronicles.
    const firstPsalm = verses.findIndex((v) => Math.floor(v / 1e6) === 19);
    expect(firstPsalm).toBeLessThan(verses.length - 2461);
  });

  it('rejects bad input', () => {
    expect(() => buildPlanDays(spec({ scope: [] }))).toThrow(PlanBuildError);
    expect(() => buildPlanDays(spec({ scope: [{ start: vid(1, 1, 40), end: vid(1, 2, 1) }] }))).toThrow(PlanBuildError);
    expect(() => buildPlanDays(spec({ pace: { by: 'days', days: 0 } }))).toThrow(PlanBuildError);
  });

  it('merges ranges and previews', () => {
    expect(mergeRanges([{ start: vid(1, 2, 1), end: vid(1, 3, 24) }, { start: vid(1, 1, 1), end: vid(1, 1, 31) }])).toEqual([{ start: vid(1, 1, 1), end: vid(1, 3, 24) }]);
    const p = previewPlan(spec({ pace: { by: 'days', days: 50 } }));
    expect(p.days).toBe(50);
    expect(p.verses).toBe(1533);
    expect(p.firstDays).toHaveLength(7);
  });
});

describe('stock plans', () => {
  it('the chronological order covers every verse exactly once', () => {
    const seen = new Set<number>();
    let n = 0;
    for (const r of CHRONOLOGICAL_ORDER) for (const v of versesBetween(r.start, r.end)) { seen.add(v); n++; }
    expect(n).toBe(TOTAL_VERSES);
    expect(seen.size).toBe(TOTAL_VERSES);
  });

  it('builds every stock plan', () => {
    const list = listStockPlans();
    expect(list.map((p) => p.key)).toEqual(stockPlanIds().map(stockPlanKey));
    const byKey = Object.fromEntries(list.map((p) => [p.key, p]));
    expect(byKey['stock:canonical-1y'].dayCount).toBe(365);
    expect(byKey['stock:canonical-1y'].verseCount).toBe(TOTAL_VERSES);
    expect(byKey['stock:chronological-1y'].verseCount).toBe(TOTAL_VERSES);
    expect(byKey['stock:mcheyne'].dayCount).toBe(365);
    expect(byKey['stock:nt-90'].dayCount).toBe(90);
    expect(byKey['stock:psalms-proverbs-31'].dayCount).toBe(31);
    for (const p of list) expect(() => validatePlanDefinition(getStockPlan(p.key))).not.toThrow();
  });

  it("M'Cheyne reads the OT once and the NT and Psalms twice", () => {
    const plan = getStockPlan('stock:mcheyne')!;
    const counts = new Map<number, number>();
    for (const v of versesOf(plan.days)) counts.set(v, (counts.get(v) ?? 0) + 1);
    expect(counts.get(vid(1, 1, 1))).toBe(1);
    expect(counts.get(vid(19, 23, 1))).toBe(2);
    expect(counts.get(vid(43, 3, 16))).toBe(2);
    expect(plan.days[0].readings.map((r) => r.start)).toEqual([vid(1, 1, 1), vid(40, 1, 1), vid(15, 1, 1), vid(44, 1, 1)]);
  });

  // Changing the builder or a stock spec must not silently move a stock plan's days: if this
  // fails on purpose, bump that plan's `version` in stock.ts and update the fingerprint here.
  it('stock plans have not drifted', () => {
    const fp = (key: string) => createHash('sha256').update(JSON.stringify(getStockPlan(key)!.days)).digest('hex').slice(0, 12);
    const actual = Object.fromEntries(stockPlanIds().map((id) => [id, `${getStockPlan(stockPlanKey(id))!.version}:${fp(stockPlanKey(id))}`]));
    expect(actual).toMatchSnapshot();
  });
});

function enrollment(over: Partial<Enrollment> = {}): Enrollment {
  return {
    id: 'e1', planKey: 'user:p', planVersion: 1, planName: 'P', startDate: '2026-10-01', pacing: 'fixed',
    readingDays: [0, 1, 2, 3, 4, 5, 6], status: 'active', createdAt: '2026-10-01T00:00:00Z', ...over,
  };
}

function tenDayPlan(): PlanDefinition {
  return { key: 'user:p', version: 1, name: 'P', source: 'user', days: buildPlanDays(spec({ pace: { by: 'days', days: 10 } })) };
}

function done(day: number, reading = 0, at = '2026-10-01T12:00:00Z'): Completion {
  return { enrollmentId: 'e1', day, reading, at, via: 'manual' };
}

describe('PlanScheduler', () => {
  const plan = tenDayPlan();

  it('maps dates to days with rest days', () => {
    const e = enrollment({ readingDays: [1, 2, 3, 4, 5] as Weekday[], startDate: '2026-10-05' }); // Monday
    expect(scheduledDay(e, '2026-10-04')).toBe(0);
    expect(scheduledDay(e, '2026-10-05')).toBe(1);
    expect(scheduledDay(e, '2026-10-11')).toBe(5); // Sunday: still day 5
    expect(scheduledDay(e, '2026-10-12')).toBe(6);
    expect(dateForDay(e, 6)).toBe('2026-10-12');
    expect(dateForDay(e, 10)).toBe('2026-10-16');
  });

  it('flexible: today is the first unread day, never behind', () => {
    const e = enrollment({ pacing: 'flexible' });
    const v = todayView(plan, e, [done(1)], '2026-12-01', 3);
    expect(v.day).toBe(2);
    expect(v.behindBy).toBe(0);
  });

  it('B-068: fixed, long past the end: flagged pastEnd (and not before the end)', () => {
    const e = enrollment();
    expect(todayView(plan, e, [done(1)], '2026-12-01', 3).pastEnd).toBe(true);
    expect(todayView(plan, e, [done(1), done(3)], '2026-10-05', 3).pastEnd).toBeUndefined();
  });

  it('fixed: shows days behind and the missed days', () => {
    const e = enrollment();
    const v = todayView(plan, e, [done(1), done(3)], '2026-10-05', 3); // day 5 today
    // Behind: the focus is the oldest missed day, today's own day is still known.
    expect(v).toMatchObject({ day: 2, focusKind: 'nextUnread', scheduledToday: 5 });
    expect(v.missedDays).toEqual([2, 4]);
    expect(v.behindBy).toBe(2);
    expect(catchUpSuggestion(v.behindBy)).toEqual({ extraPerDay: 1, days: 2 });
  });

  it('fixed: a rest day counts the last scheduled day as due and focuses it', () => {
    const e = enrollment({ readingDays: [1, 2, 3, 4, 5] as Weekday[], startDate: '2026-10-05' });
    const v = todayView(plan, e, [done(1), done(2), done(3), done(4)], '2026-10-10', 3); // Saturday
    expect(v.restDay).toBe(true);
    expect(v).toMatchObject({ day: 5, focusKind: 'nextUnread', scheduledToday: null, dueUnread: false });
    expect(v.missedDays).toEqual([5]);
  });

  it('shifts the start date so the first unread day is today', () => {
    const e = enrollment();
    const start = shiftedStartDate(plan, e, [done(1), done(2)], '2026-10-08');
    expect(start).toBe('2026-10-06');
    expect(todayView(plan, { ...e, startDate: start }, [done(1), done(2)], '2026-10-08', 3)).toMatchObject({ day: 3, behindBy: 0 });
  });

  it('computes stats and day statuses', () => {
    const e = enrollment({ pacing: 'flexible' });
    const s = planStats(plan, e, [done(1), done(2)], '2026-10-03');
    expect(s.daysDone).toBe(2);
    expect(s.percent).toBeGreaterThan(0);
    expect(s.scheduledFinish).toBe(addDays('2026-10-03', 7));
    expect(s.estimatedFinish).toBeNull(); // only two reading days of history
    expect(s.finishBasis).toBe('schedule');
    const fixed = enrollment();
    expect(dayStatuses(plan, fixed, [done(1)], '2026-10-03', 3).slice(0, 4)).toEqual(['done', 'missed', 'current', 'upcoming']);
  });

  it('reports completion', () => {
    const all = plan.days.map((_, i) => done(i + 1));
    expect(todayView(plan, enrollment(), all, '2026-10-03', 3).completed).toBe(true);
  });
});

describe('validation', () => {
  it('accepts good data and rejects bad', () => {
    expect(() => validateEnrollment(enrollment())).not.toThrow();
    expect(() => validateEnrollment({ ...enrollment(), readingDays: [] })).toThrow(ReadingPlanDataError);
    expect(() => validateEnrollment({ ...enrollment(), reminder: { time: '25:00' } })).toThrow(ReadingPlanDataError);
    expect(() => validateBuilderSpec(spec({}))).not.toThrow();
    expect(() => validateBuilderSpec({ ...spec({}), pace: { by: 'days', days: -1 } })).toThrow(ReadingPlanDataError);
    expect(() => validatePlanDefinition({ key: 'x', version: 1, name: 'n', source: 'user', days: [] })).toThrow(ReadingPlanDataError);
  });
});

describe('review fixes', () => {
  const plan = tenDayPlan();

  it('rejects fractional chapters or verses a day', () => {
    expect(() => buildPlanDays(spec({ pace: { by: 'chaptersPerDay', chapters: 1.5 } }))).toThrow(PlanBuildError);
    expect(() => validateBuilderSpec({ ...spec({}), pace: { by: 'versesPerDay', verses: 2.5 } })).toThrow(ReadingPlanDataError);
  });

  it('after the scheduled end, every unread day is missed and the first one is shown', () => {
    const v = todayView(plan, enrollment(), [done(1), done(3)], '2026-11-30', 3);
    expect(v.day).toBe(2);
    expect(v.missedDays).toEqual([2, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('estimates the finish from today when a fixed plan is behind', () => {
    const s = planStats(plan, enrollment(), [done(1)], '2026-10-05');
    expect(s.scheduledFinish).toBe('2026-10-10');
    expect(s.estimatedFinish).toBeNull(); // one plan day ticked: no pace yet
    expect(s.finishBasis).toBe('schedule');
  });
});

describe('estimated finish from real pace', () => {
  const plan = tenDayPlan();
  /** A tick at local noon on `date`. */
  const tick = (date: string, day: number, reading = 0): Completion => {
    const [y, m, d] = date.split('-').map(Number);
    return { enrollmentId: 'e1', day, reading, at: new Date(y, m - 1, d, 12).toISOString(), via: 'manual' };
  };
  const flex = (over: Partial<Enrollment> = {}) => enrollment({ pacing: 'flexible', ...over });

  it('too little history: no estimate, schedule basis', () => {
    const s = planStats(plan, flex(), [tick('2026-10-01', 1), tick('2026-10-02', 2)], '2026-10-03');
    expect(s.estimatedFinish).toBeNull();
    expect(s.pacePerReadingDay).toBeNull();
    expect(s.finishBasis).toBe('schedule');
    expect(s.scheduledFinish).toBe('2026-10-10');
  });

  it('a steady one-day-per-day reader finishes on the scheduled date', () => {
    const ticks = [1, 2, 3, 4, 5].map((d) => tick(`2026-10-0${d}`, d));
    const s = planStats(plan, flex(), ticks, '2026-10-05');
    expect(s.pacePerReadingDay).toBe(1);
    expect(s.estimatedFinish).toBe('2026-10-10');
    expect(s.scheduledFinish).toBe('2026-10-10');
    expect(s.finishBasis).toBe('pace');
  });

  it('a reader doing two plan days per reading day finishes in about half the days', () => {
    const ticks = [tick('2026-10-01', 1), tick('2026-10-01', 2), tick('2026-10-02', 3), tick('2026-10-02', 4), tick('2026-10-03', 5), tick('2026-10-03', 6)];
    const s = planStats(plan, flex(), ticks, '2026-10-04'); // nothing read yet today
    expect(s.pacePerReadingDay).toBe(2);
    expect(s.estimatedFinish).toBe('2026-10-05');
    expect(s.scheduledFinish).toBe('2026-10-07');
  });

  it('a slow reader gets a later date than the schedule', () => {
    const ticks = [tick('2026-10-01', 1), tick('2026-10-03', 2), tick('2026-10-05', 3), tick('2026-10-07', 4)];
    const s = planStats(plan, flex(), ticks, '2026-10-07');
    expect(s.scheduledFinish).toBe('2026-10-13');
    expect(s.estimatedFinish).toBe('2026-10-18');
    expect(s.estimatedFinish! > s.scheduledFinish!).toBe(true);
  });

  it('a bulk tick in one sitting does not pass for a reading speed', () => {
    // Days 1-6 ticked at once (read on paper before), then one plan day a day.
    const ticks = [1, 2, 3, 4, 5, 6].map((d) => tick('2026-10-01', d)).concat([tick('2026-10-02', 7), tick('2026-10-03', 8)]);
    const m = measurePace(plan, flex(), ticks, '2026-10-03');
    expect(m).toMatchObject({ planDays: 5, readingDays: 3 }); // 3 (capped) + 1 + 1, not 8
    expect(m!.pace).toBeLessThan(2);
  });

  it('counts only the reader\'s reading weekdays', () => {
    const e = flex({ readingDays: [1, 2, 3, 4, 5] as Weekday[], startDate: '2026-10-05' }); // Monday
    const ticks = [5, 6, 7, 8, 9].map((d) => tick(`2026-10-0${d}`, d - 4));
    const s = planStats(plan, e, ticks, '2026-10-09'); // Friday
    expect(measurePace(plan, e, ticks, '2026-10-09')).toMatchObject({ planDays: 5, readingDays: 5, pace: 1 });
    expect(s.estimatedFinish).toBe('2026-10-16'); // Mon-Fri again: the 5th reading day after Friday
  });

  it('ignores ticks older than the 28-day window', () => {
    const long = { ...plan, days: buildPlanDays(spec({ pace: { by: 'days', days: 40 } })) };
    const bulk = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => tick('2026-08-01', d));
    const ticks = [...bulk, tick('2026-10-04', 9)];
    expect(measurePace(long, flex(), ticks, '2026-10-05')).toBeNull();
    expect(planStats(long, flex(), ticks, '2026-10-05').estimatedFinish).toBeNull();
  });

  it('counts partial days fractionally', () => {
    const g = (v: number) => ({ start: vid(1, 1, v), end: vid(1, 1, v) });
    const two: PlanDefinition = {
      key: 'user:two', version: 1, name: 'Two', source: 'user',
      days: [1, 2, 3, 4].map((n) => ({ readings: [g(n), g(n + 10)] })),
    };
    const ticks = [tick('2026-10-01', 1, 0), tick('2026-10-01', 1, 1), tick('2026-10-02', 2, 0), tick('2026-10-03', 2, 1), tick('2026-10-03', 3, 0)];
    const m = measurePace(two, flex(), ticks, '2026-10-04');
    expect(m!.planDays).toBeCloseTo(2.5);
    expect(m!.readingDays).toBe(3);
    // 4 - 2.5 = 1.5 plan days left at 0.833 a day: 2 reading days from today
    expect(planStats(two, flex(), ticks, '2026-10-04').estimatedFinish).toBe('2026-10-05');
  });

  it('a finished plan has no dates', () => {
    const all = plan.days.map((_, i) => tick('2026-10-01', i + 1));
    const s = planStats(plan, flex(), all, '2026-10-05');
    expect(s).toMatchObject({ estimatedFinish: null, scheduledFinish: null, finishBasis: null, pacePerReadingDay: null });
  });

  it('a fixed plan on schedule keeps the calendar\'s last day', () => {
    const s = planStats(plan, enrollment(), [tick('2026-10-01', 1), tick('2026-10-02', 2), tick('2026-10-03', 3)], '2026-10-03');
    expect(s.scheduledFinish).toBe('2026-10-10');
    expect(s.estimatedFinish).toBe('2026-10-10');
    expect(s.finishBasis).toBe('pace');
  });
});
