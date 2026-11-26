import { describe, expect, it } from 'vitest';
import { MemoryUserDb } from '../UserData/MemoryUserDb';
import { UserDataReadingPlanStore } from './store';
import { ReadingPlanService } from './service';
import {
  measurePace, planStats, reschedulePreview, scheduledDay, startDateFor, todayView, weekStrip,
} from './scheduler';
import { chapterOf, chapterSpan, dueReadings, endsInChapter, focusDay, nextDueReading, todaysReadings } from './cursor';
import { parsePlanFile, planFileName, serializePlanFile, MAX_PLAN_FILE_BYTES, PLAN_FILE_FORMAT } from './planFile';
import { ReadingPlanDataError, validateCompletion, validateEnrollment } from './validate';
import { vid } from './versification';
import type { Completion, Enrollment, PlanDefinition, Weekday } from './types';

const plan: PlanDefinition = {
  key: 'user:t', version: 1, name: 'T', source: 'user',
  days: Array.from({ length: 10 }, (_, i) => ({ readings: [{ start: vid(1, i + 1, 1), end: vid(1, i + 1, 2) }] })),
};
const enrollment = (over: Partial<Enrollment> = {}): Enrollment => ({
  id: 'e1', planKey: 'user:t@1', planVersion: 1, planName: 'T', startDate: '2026-10-01', pacing: 'fixed',
  readingDays: [0, 1, 2, 3, 4, 5, 6], status: 'active', createdAt: '2026-10-01T00:00:00Z', ...over,
});
const done = (day: number, date = '2026-10-01', via: Completion['via'] = 'manual'): Completion => ({
  enrollmentId: 'e1', day, reading: 0, at: new Date(`${date}T12:00:00`).toISOString(), via,
});

describe('todayView focus (R3)', () => {
  it('flexible: current, due until something is read today', () => {
    const e = enrollment({ pacing: 'flexible' });
    const v = todayView(plan, e, [], '2026-10-05', 3);
    expect(v).toMatchObject({ focusKind: 'current', day: 1, readToday: false, dueUnread: true, upcomingDay: null, catchUp: null });
    // Today's day is stable: ticking it does not move on to day 2, and nothing is due any more.
    const read = todayView(plan, e, [done(1, '2026-10-05')], '2026-10-05', 3);
    expect(read).toMatchObject({ day: 1, dayDone: true, readToday: true, dueUnread: false });
    // A bulk mark counts as progress made before today and is not "read today".
    const bulk = todayView(plan, e, [done(1, '2026-10-05', 'bulk')], '2026-10-05', 3);
    expect(bulk).toMatchObject({ day: 2, readToday: false, dueUnread: true });
    // Yesterday's reading moves today on.
    expect(todayView(plan, e, [done(1, '2026-10-04')], '2026-10-05', 3)).toMatchObject({ day: 2, dueUnread: true });
    expect(todayView(plan, enrollment({ pacing: 'flexible', readingDays: [1] as Weekday[] }), [], '2026-10-06', 3).dueUnread).toBe(false); // Tuesday
  });

  it('fixed: today, dueUnread until the day is ticked', () => {
    const e = enrollment();
    expect(todayView(plan, e, [done(1), done(2), done(3), done(4)], '2026-10-05', 3))
      .toMatchObject({ focusKind: 'today', day: 5, dueUnread: true, behindBy: 0, catchUp: null });
    const all = [1, 2, 3, 4, 5].map((d) => done(d));
    expect(todayView(plan, e, all, '2026-10-05', 3)).toMatchObject({ focusKind: 'today', dayDone: true, dueUnread: false });
  });

  it('fixed behind: catch-up lists the oldest missed days only while enabled and behind', () => {
    const catching = enrollment({ catchUp: { extraPerDay: 2 } });
    const v = todayView(plan, catching, [], '2026-10-05', 3);
    expect(v.behindBy).toBe(4);
    expect(v.catchUp?.extraPerDay).toBe(2);
    expect(v.catchUp?.days.map((d) => d.day)).toEqual([1, 2]);
    expect(dueReadings(v).map((r) => r.day)).toEqual([5, 1, 2]);
    expect(todayView(plan, enrollment(), [], '2026-10-05', 3).catchUp).toBeNull();
    // Level: catch-up view disappears even though the flag is still stored.
    const level = todayView(plan, catching, [1, 2, 3, 4].map((d) => done(d)), '2026-10-05', 3);
    expect(level.catchUp).toBeNull();
    // Today ticked but catch-up readings remain: still due.
    const only = todayView(plan, catching, [done(5)], '2026-10-05', 3);
    expect(only).toMatchObject({ dayDone: true, dueUnread: true });
  });

  it('fixed pastEnd: next unread', () => {
    const v = todayView(plan, enrollment(), [done(1)], '2026-12-01', 3);
    expect(v).toMatchObject({ focusKind: 'nextUnread', day: 2, dueUnread: true, pastEnd: true });
    expect(focusDay(v)).toBe(2);
  });

  it('fixed rest day: upcoming day and date', () => {
    const e = enrollment({ readingDays: [1, 2, 3, 4, 5] as Weekday[], startDate: '2026-10-05' });
    const v = todayView(plan, e, [1, 2, 3, 4, 5].map((d) => done(d)), '2026-10-10', 3); // Saturday
    expect(v).toMatchObject({ day: null, focusKind: 'upcoming', upcomingDay: 6, upcomingDate: '2026-10-12', dueUnread: false, restDay: true });
    expect(focusDay(v)).toBe(6);
  });

  it('fixed not started: upcoming day 1', () => {
    const v = todayView(plan, enrollment({ startDate: '2026-10-10' }), [], '2026-10-05', 3);
    expect(v).toMatchObject({ notStarted: true, focusKind: 'upcoming', upcomingDay: 1, upcomingDate: '2026-10-10', dueUnread: false });
  });

  it('completed has no focus', () => {
    const v = todayView(plan, enrollment({ pacing: 'flexible' }), plan.days.map((_, i) => done(i + 1)), '2026-10-05', 3);
    expect(v).toMatchObject({ completed: true, focusKind: null, dueUnread: false });
    expect(focusDay(v)).toBeNull();
  });
});

describe('startDateFor / reschedulePreview', () => {
  it('round-trips with scheduledDay on every weekday set', () => {
    const sets: Weekday[][] = [[0, 1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5], [2, 4, 6]];
    for (const readingDays of sets) {
      for (const onDate of ['2026-10-05', '2026-10-06', '2026-10-10', '2026-10-11']) {
        for (const day of [1, 2, 7, 12]) {
          const startDate = startDateFor({ readingDays }, day, onDate);
          const e = { readingDays, startDate };
          // A rest day lands the day on the next reading day.
          let target = onDate;
          for (let i = 0; i < 7; i++) {
            if (readingDays.includes(new Date(`${target}T00:00:00Z`).getUTCDay() as Weekday)) break;
            target = new Date(Date.parse(`${target}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
          }
          expect(scheduledDay(e, target)).toBe(day);
        }
      }
    }
  });

  it('previews the move: new start, both end dates, remaining days', () => {
    const e = enrollment();
    const p = reschedulePreview(plan, e, [done(1)], '2026-10-05');
    expect(p).toEqual({ newStartDate: '2026-10-04', oldEnd: '2026-10-10', newEnd: '2026-10-13', remainingDays: 9, restartDate: '2026-10-05' });
    expect(reschedulePreview(plan, e, plan.days.map((_, i) => done(i + 1)), '2026-10-05').remainingDays).toBe(0);
  });
});

describe('weekStrip', () => {
  const e = enrollment({ readingDays: [1, 2, 3, 4, 5, 6] as Weekday[], startDate: '2026-10-06' });
  it('runs Monday to Sunday with read / unread / rest / future', () => {
    const strip = weekStrip(plan, e, [done(1, '2026-10-07'), done(2, '2026-10-08', 'bulk')], '2026-10-09', 3);
    expect(strip.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(strip.map((d) => d.state)).toEqual(['rest', 'read', 'read', 'unread', 'unread', 'future', 'future']);
    expect(strip.filter((d) => d.today).map((d) => d.date)).toEqual(['2026-10-09']);
  });
  it('crosses the week boundary and honours weekStart', () => {
    expect(weekStrip(plan, e, [], '2026-10-12', 3).map((d) => d.state)).toEqual(['unread', ...Array(6).fill('future')]);
    expect(weekStrip(plan, e, [], '2026-10-11', 3)[0].date).toBe('2026-10-05');
    const sunday = weekStrip(plan, e, [], '2026-10-11', 3, 0);
    expect(sunday[0].date).toBe('2026-10-11');
    expect(sunday[0]).toMatchObject({ state: 'rest', today: true, weekday: 0 });
  });
});

describe('stable today (S1-S5)', () => {
  const catching = enrollment({ catchUp: { extraPerDay: 2 } });
  it('the catch-up quota and the focus day stay put while ticking', () => {
    const before = todayView(plan, catching, [], '2026-10-05', 3);
    const after = todayView(plan, catching, [done(1, '2026-10-05'), done(5, '2026-10-05')], '2026-10-05', 3);
    expect(before.catchUp?.days.map((d) => d.day)).toEqual([1, 2]);
    expect(after.catchUp?.days.map((d) => [d.day, d.readings[0].done])).toEqual([[1, true], [2, false]]);
    expect(after.day).toBe(5);
    expect(todaysReadings(after).map((r) => [r.day, r.done])).toEqual([[5, true], [1, true], [2, false]]);
    expect(dueReadings(after).map((r) => r.day)).toEqual([2]);
    // Tomorrow the quota is the next missed days.
    expect(todayView(plan, catching, [done(1, '2026-10-05'), done(2, '2026-10-05'), done(5, '2026-10-05')], '2026-10-06', 3).catchUp?.days.map((d) => d.day))
      .toEqual([3, 4]);
  });
  it('past the end there is no catch-up quota', () => {
    expect(todayView(plan, catching, [], '2026-12-01', 3).catchUp).toBeNull();
  });
  it('a 02:30 completion belongs to the previous reading day', () => {
    const e = enrollment({ pacing: 'flexible' });
    const late = { enrollmentId: 'e1', day: 1, reading: 0, at: new Date(2026, 9, 6, 2, 30).toISOString(), via: 'manual' as const };
    // At 02:45 on the 6th the reading day is still the 5th: the tick is today's, so the day does not move.
    expect(todayView(plan, e, [late], '2026-10-05', 3)).toMatchObject({ day: 1, readToday: true });
    // From the 6th (after 03:00) it is yesterday's progress.
    expect(todayView(plan, e, [late], '2026-10-06', 3)).toMatchObject({ day: 2, readToday: false });
  });
  it('nextDueReading is positional and survives ticking; flexible stays in its day', () => {
    const two: PlanDefinition = { ...plan, days: plan.days.map((d, i) => (i === 0 ? { readings: [d.readings[0], d.readings[0], d.readings[0]] } : d)) };
    const flex = enrollment({ pacing: 'flexible' });
    const v = todayView(two, flex, [done(1), { ...done(1), reading: 1 }].map((c) => ({ ...c, at: new Date(2026, 9, 5, 12).toISOString() })), '2026-10-05', 3);
    expect(nextDueReading(v, 1, 0)).toMatchObject({ day: 1, index: 2 });
    expect(nextDueReading(v, 1, 1)).toMatchObject({ day: 1, index: 2 });
    expect(nextDueReading(v, 1, 2)).toBeNull();
  });
  it('week strip: part-way start blanks earlier days; fixed counts the scheduled day', () => {
    const flex = enrollment({ pacing: 'flexible', startDate: '2026-10-07', createdAt: new Date(2026, 9, 7, 12).toISOString() });
    expect(weekStrip(plan, flex, [], '2026-10-09', 3).map((d) => d.state)).toEqual(['rest', 'rest', 'unread', 'unread', 'unread', 'future', 'future']);
    // Fixed: plan day 2 is Oct 2 (start Oct 1); ticked later on Oct 7, the 2nd still shows read.
    const fixed = enrollment({ startDate: '2026-10-01', createdAt: '2026-10-01T10:00:00Z' });
    const strip = weekStrip(plan, fixed, [done(5, '2026-10-05')], '2026-10-06', 3);
    expect(strip[0].state).toBe('read');
    expect(strip[1].state).toBe('unread');
  });
});

describe('bulk completions', () => {
  it('do not count toward pace or streak', () => {
    const e = enrollment({ pacing: 'flexible', startDate: '2026-09-01' });
    const bulk = [1, 2, 3, 4].map((d) => done(d, '2026-10-05', 'bulk'));
    expect(measurePace(plan, e, bulk, '2026-10-05')).toBeNull();
    expect(planStats(plan, e, bulk, '2026-10-05').streak).toBe(0);
    expect(planStats(plan, e, bulk, '2026-10-05').daysDone).toBe(4);
    const real = [1, 2, 3, 4].map((d, i) => done(d, `2026-10-0${i + 2}`));
    expect(planStats(plan, e, real, '2026-10-05').streak).toBe(4);
  });
});

describe('cursor helpers (R3)', () => {
  const e = enrollment({ catchUp: { extraPerDay: 1 } });
  const view = todayView(
    { ...plan, days: plan.days.map((d, i) => (i === 4 ? { readings: [d.readings[0], { start: vid(19, 1, 1), end: vid(19, 1, 6) }] } : d)) },
    e, [done(2), done(3), done(4)], '2026-10-05',
  );
  it('dueReadings and nextDueReading follow day then catch-up order', () => {
    expect(dueReadings(view).map((r) => [r.day, r.index])).toEqual([[5, 0], [5, 1], [1, 0]]);
    expect(nextDueReading(view, 5, 0)).toMatchObject({ day: 5, index: 1 });
    expect(nextDueReading(view, 5, 1)).toMatchObject({ day: 1, index: 0 });
    expect(nextDueReading(view, 1, 0)).toBeNull();
    expect(nextDueReading(view, 9, 0)).toBeNull();
  });
  it('chapter helpers', () => {
    const rd = { start: vid(1, 4, 1), end: vid(1, 6, 8) };
    expect(chapterSpan(rd)).toEqual({ first: { book: 1, chapter: 4 }, last: { book: 1, chapter: 6 }, count: 3 });
    expect(chapterOf(rd, 1, 5)).toEqual({ n: 2, count: 3 });
    expect(chapterOf(rd, 1, 7)).toBeNull();
    expect(chapterOf(rd, 2, 5)).toBeNull();
    expect(endsInChapter(rd, 1, 6)).toBe(true);
    expect(endsInChapter(rd, 1, 5)).toBe(false);
  });
});

describe('validation of new fields', () => {
  it('old enrollment JSON without catchUp validates; catchUp round-trips', () => {
    const { catchUp: _c, ...old } = enrollment() as Enrollment & { catchUp?: unknown };
    expect(validateEnrollment(old).catchUp).toBeUndefined();
    expect(validateEnrollment({ ...old, catchUp: { extraPerDay: 2 } }).catchUp).toEqual({ extraPerDay: 2 });
    expect(validateEnrollment({ ...old, catchUp: null }).catchUp).toBeNull();
    expect(() => validateEnrollment({ ...old, catchUp: { extraPerDay: 0, since: 'x' } })).toThrow(ReadingPlanDataError);
  });
  it('accepts the bulk and older completion kinds', () => {
    for (const via of ['manual', 'reader', 'audio', 'bulk']) {
      expect(validateCompletion({ enrollmentId: 'e', day: 1, reading: 0, at: 'x', via }).via).toBe(via);
    }
    expect(() => validateCompletion({ enrollmentId: 'e', day: 1, reading: 0, at: 'x', via: 'nope' })).toThrow();
  });
});

function setup(start = new Date(2026, 9, 5, 12, 0)) {
  const db = new MemoryUserDb();
  const store = new UserDataReadingPlanStore(db.items);
  let now = start;
  let n = 0;
  const service = new ReadingPlanService(store, { now: () => now, newId: () => `id${++n}` });
  const events: string[] = [];
  service.subscribe((e) => events.push(e.type));
  return { store, service, events, setNow: (d: Date) => { now = d; } };
}

describe('service (R3)', () => {
  it('startPlan with startDay: flexible marks earlier days read via bulk', async () => {
    const { service, store, events } = setup();
    const e = await service.startPlan('stock:gospels-30', { startDay: 10 });
    const comps = await store.listCompletions(e.id);
    expect(comps.length).toBeGreaterThanOrEqual(9);
    expect(new Set(comps.map((c) => c.day))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(comps.every((c) => c.via === 'bulk')).toBe(true);
    const [today] = await service.todayViews();
    expect(today).toMatchObject({ day: 10, readToday: false });
    expect((await service.detail(e.id)).stats.pacePerReadingDay).toBeNull();
    expect(events.some((t) => t === 'readingCompleted')).toBe(false);
  });

  it('startPlan with startDay: fixed puts that day on today', async () => {
    const { service } = setup();
    const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed', startDay: 10 });
    expect(scheduledDay(e, '2026-10-05')).toBe(10);
    const [today] = await service.todayViews();
    expect(today).toMatchObject({ day: 10, behindBy: 0, focusKind: 'today' });
    await expect(service.startPlan('stock:gospels-30', { startDay: 31 })).rejects.toThrow(ReadingPlanDataError);
  });

  it('setDaysDoneThrough completes and reopens a plan in one batch', async () => {
    const { service, store, events } = setup();
    const plan = await service.savePlan({ name: 'Two', days: plan2() });
    const e = await service.startPlan(plan.key);
    events.length = 0;
    await service.setDaysDoneThrough(e.id, 2, true);
    expect(events.filter((t) => t === 'planCompleted')).toHaveLength(1);
    expect((await service.enrollments())[0].status).toBe('completed');
    expect((await store.listCompletions(e.id)).length).toBe(3);
    await service.setDaysDoneThrough(e.id, 1, false);
    expect((await service.enrollments())[0].status).toBe('active');
    expect((await store.listCompletions(e.id)).map((c) => c.day).sort()).toEqual([2]);
    await service.setDaysDoneThrough(e.id, 2, false);
    expect(await store.listCompletions(e.id)).toEqual([]);
    await expect(service.setDaysDoneThrough(e.id, 3, true)).rejects.toThrow(ReadingPlanDataError);
  });

  it('catch-up starts, stops, and ends itself when level; shift and flexible clear it', async () => {
    const { service, setNow } = setup(new Date(2026, 9, 1, 12, 0));
    const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
    await expect(service.startCatchUp(e.id)).rejects.toThrow(ReadingPlanDataError); // not behind
    setNow(new Date(2026, 9, 5, 12, 0));
    const on = await service.startCatchUp(e.id);
    expect(on.catchUp).toEqual({ extraPerDay: 1 });
    const [view] = await service.todayViews();
    expect(view.catchUp?.days.map((d) => d.day)).toEqual([1]);
    expect((await service.stopCatchUp(e.id)).catchUp).toBeNull();
    await service.startCatchUp(e.id);
    for (const d of [1, 2, 3]) await service.setDayDone(e.id, d, true);
    expect((await service.enrollments())[0].catchUp).toBeTruthy(); // 4 still missed
    await service.setDayDone(e.id, 4, true);
    expect((await service.enrollments())[0].catchUp).toBeNull();
    setNow(new Date(2026, 9, 9, 12, 0));
    await service.startCatchUp(e.id);
    expect((await service.shiftSchedule(e.id)).catchUp).toBeNull();
    setNow(new Date(2026, 9, 12, 12, 0));
    await service.startCatchUp(e.id);
    expect((await service.switchToFlexible(e.id)).catchUp).toBeNull();
  });

  it('editing the schedule ends catch-up unless the patch restores it (Undo); detail has the week; preview by id', async () => {
    const { service, setNow } = setup(new Date(2026, 9, 1, 12, 0));
    const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
    setNow(new Date(2026, 9, 5, 12, 0));
    const on = await service.startCatchUp(e.id);
    expect((await service.updateEnrollment(e.id, { startDate: '2026-10-02' })).catchUp).toBeNull();
    const back = await service.updateEnrollment(e.id, { startDate: e.startDate, catchUp: on.catchUp });
    expect(back).toMatchObject({ startDate: '2026-10-01', catchUp: { extraPerDay: 1 } });
    const detail = await service.detail(e.id);
    expect(detail.week).toHaveLength(7);
    expect(detail.week.find((d) => d.today)?.date).toBe('2026-10-05');
    expect(await service.reschedulePreview(e.id)).toMatchObject({ newStartDate: '2026-10-05', restartDate: '2026-10-05', remainingDays: 30 });
  });

  it('startPlan emits changed once with a part-way start', async () => {
    const { service, events } = setup();
    await service.startPlan('stock:gospels-30', { startDay: 5 });
    expect(events).toEqual(['changed']);
  });

  it('savePlan accepts tracks for a new plan', async () => {
    const { service } = setup();
    const p = await service.savePlan({
      name: 'Tracked', tracks: [{ id: 'a', name: 'A' }],
      days: [{ readings: [{ start: vid(1, 1, 1), end: vid(1, 1, 2), track: 'a' }] }],
    });
    expect(p.tracks).toEqual([{ id: 'a', name: 'A' }]);
    expect(p.days[0].readings[0].track).toBe('a');
  });
});

function plan2() {
  return [
    { readings: [{ start: vid(1, 1, 1), end: vid(1, 1, 2) }, { start: vid(1, 2, 1), end: vid(1, 2, 2) }] },
    { readings: [{ start: vid(1, 3, 1), end: vid(1, 3, 2) }] },
  ];
}

describe('plan file', () => {
  it('makes a safe file name', () => {
    expect(planFileName('Genesis 1-3')).toBe('Genesis 1-3.readingplan.json');
    expect(planFileName('../../etc/passwd')).toBe('etc passwd.readingplan.json');
    expect(planFileName('a:b*c?"<>|')).toBe('a b c.readingplan.json');
    expect(planFileName('...')).toBe('reading-plan.readingplan.json');
    expect(planFileName('x'.repeat(300)).length).toBe(80 + '.readingplan.json'.length);
  });

  it('round-trips a plan without key, source or spec', async () => {
    const { service } = setup();
    const saved = await service.savePlan({
      name: 'Mine', description: 'd', tracks: [{ id: 'a', name: 'A' }],
      days: [{ readings: [{ start: vid(1, 1, 1), end: vid(1, 1, 2), track: 'a' }] }],
    });
    const text = serializePlanFile(saved);
    expect(text).toContain('\n  "format"');
    const obj = JSON.parse(text);
    expect(obj).toMatchObject({ format: PLAN_FILE_FORMAT, version: 1, name: 'Mine' });
    expect(obj.key).toBeUndefined();
    expect(obj.source).toBeUndefined();
    const again = await service.savePlan(parsePlanFile(text));
    expect(again.key).not.toBe(saved.key);
    expect(again.days).toEqual(saved.days);
    expect(again.tracks).toEqual(saved.tracks);
    expect(again.description).toBe('d');
  });

  it('rejects bad files', async () => {
    const bad = (t: string) => expect(() => parsePlanFile(t)).toThrow(ReadingPlanDataError);
    bad('not json');
    bad('[]');
    bad(JSON.stringify({ format: 'other', version: 1, name: 'x', days: [{ readings: [] }] }));
    bad(JSON.stringify({ format: PLAN_FILE_FORMAT, version: 2, name: 'x', days: [{ readings: [] }] }));
    bad(JSON.stringify({ format: PLAN_FILE_FORMAT, version: 1, name: '', days: [{ readings: [] }] }));
    bad(JSON.stringify({ format: PLAN_FILE_FORMAT, version: 1, name: 'x', days: [] }));
    bad(JSON.stringify({ format: PLAN_FILE_FORMAT, version: 1, name: 'x', days: Array.from({ length: 3661 }, () => ({ readings: [] })) }));
    bad('x'.repeat(MAX_PLAN_FILE_BYTES + 1));
    const track = (tracks: unknown) => JSON.stringify({ format: PLAN_FILE_FORMAT, version: 1, name: 'x', tracks, days: [{ readings: [] }] });
    bad(track([{ id: '', name: 'A' }]));
    bad(track([{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }]));
    bad(track([{ id: 'a'.repeat(41), name: 'A' }]));
    bad(track('nope'));
    // Invalid ranges are caught by savePlan.
    const { service } = setup();
    await expect(service.savePlan(parsePlanFile(JSON.stringify({
      format: PLAN_FILE_FORMAT, version: 1, name: 'x', days: [{ readings: [{ start: 5, end: 1 }] }],
    })))).rejects.toThrow(ReadingPlanDataError);
  });
});
