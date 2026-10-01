import { describe, expect, it } from 'vitest';
import { MemoryUserDb } from '../UserData/MemoryUserDb';
import { UserDataReadingPlanStore, READING_PLANS_OWNER, COMPLETIONS_COLLECTION, SNAPSHOTS_COLLECTION } from './store';
import { ReadingPlanService } from './service';
import type { ReadingPlanEvent } from './service';
import { RecordingReminderPort } from './reminders';
import { booksRange } from './versification';
import { planToIcs } from './ics';
import { ReadingPlanDataError } from './validate';

function setup(start = new Date(2026, 9, 1, 12, 0)) {
  const db = new MemoryUserDb();
  const store = new UserDataReadingPlanStore(db.items);
  let now = start;
  let n = 0;
  const reminders = new RecordingReminderPort();
  const service = new ReadingPlanService(store, { now: () => now, newId: () => `id${++n}`, reminders });
  const events: ReadingPlanEvent[] = [];
  service.subscribe((e) => events.push(e));
  return { db, store, service, events, reminders, setNow: (d: Date) => { now = d; } };
}

describe('ReadingPlanService', () => {
  it('lists the stock library and user plans', async () => {
    const { service } = setup();
    const before = await service.library();
    expect(before.some((p) => p.key === 'stock:mcheyne')).toBe(true);
    const plan = await service.createPlan({ name: 'Romans', scope: [booksRange(45)], order: 'canonical', pace: { by: 'days', days: 16 }, split: 'chapter' });
    expect(plan.key).toBe('user:id1');
    expect((await service.library()).at(-1)).toMatchObject({ key: 'user:id1', dayCount: 16, source: 'user' });
  });

  it('snapshots a stock plan when started and tracks progress', async () => {
    const { service, db, events } = setup();
    const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
    expect(e.planKey).toBe('stock:gospels-30@1');
    expect(db.items.get(READING_PLANS_OWNER, SNAPSHOTS_COLLECTION, 'stock:gospels-30@1')).toBeDefined();
    expect(e.startDate).toBe('2026-10-01');

    const [today] = await service.todayViews();
    expect(today).toMatchObject({ day: 1, behindBy: 0, dayDone: false });
    await service.setDayDone(e.id, 1, true);
    expect(events.map((x) => x.type)).toEqual(['changed', 'changed', 'readingCompleted', 'dayCompleted']);
    expect(db.items.list(READING_PLANS_OWNER, COMPLETIONS_COLLECTION).map((i) => i.itemKey)).toEqual(['id1/1/0']);
    const detail = await service.detail(e.id);
    expect(detail.stats.daysDone).toBe(1);
    expect(detail.statuses[0]).toBe('done');
  });

  it('shows "behind" on a fixed plan, shifts it and switches to flexible', async () => {
    const { service, setNow } = setup();
    const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
    setNow(new Date(2026, 9, 5, 12, 0));
    expect((await service.todayViews())[0]).toMatchObject({ day: 5, behindBy: 4, missedDays: [1, 2, 3, 4] });
    const shifted = await service.shiftSchedule(e.id);
    expect(shifted.startDate).toBe('2026-10-05');
    expect((await service.todayViews())[0]).toMatchObject({ day: 1, behindBy: 0 });
    setNow(new Date(2026, 9, 9, 12, 0));
    await service.switchToFlexible(e.id);
    expect((await service.todayViews())[0]).toMatchObject({ day: 1, behindBy: 0, pacing: 'flexible' });
  });

  it('completes a plan and reopens it when a day is unticked', async () => {
    const { service, events } = setup();
    const plan = await service.createPlan({ name: 'Jude', scope: [booksRange(65)], order: 'canonical', pace: { by: 'days', days: 3 }, split: 'verse' });
    const e = await service.startPlan(plan.key);
    for (const d of [1, 2, 3]) await service.setDayDone(e.id, d, true);
    expect(events.some((x) => x.type === 'planCompleted')).toBe(true);
    expect((await service.enrollments())[0].status).toBe('completed');
    expect(await service.todayViews()).toEqual([]);
    await service.setReadingDone(e.id, 2, 0, false);
    expect((await service.enrollments())[0].status).toBe('active');
  });

  it('refuses to delete a plan in use, and removes progress with the enrollment', async () => {
    const { service, db } = setup();
    const plan = await service.createPlan({ name: 'Ruth', scope: [booksRange(8)], order: 'canonical', pace: { by: 'days', days: 4 }, split: 'chapter' });
    const e = await service.startPlan(plan.key);
    await service.setDayDone(e.id, 1, true);
    await expect(service.deletePlan(plan.key)).rejects.toThrow(ReadingPlanDataError);
    await service.removeEnrollment(e.id);
    expect(db.items.list(READING_PLANS_OWNER, COMPLETIONS_COLLECTION)).toEqual([]);
    await service.deletePlan(plan.key);
    expect((await service.library()).some((p) => p.key === plan.key)).toBe(false);
  });

  it('hands reminders to the reminder port', async () => {
    const { service, reminders } = setup();
    const e = await service.startPlan('stock:nt-90', { readingDays: [1, 2, 3, 4, 5] });
    await service.updateEnrollment(e.id, { reminder: { time: '07:30' } });
    expect(reminders.rules).toEqual([{ enrollmentId: e.id, planName: 'New Testament in 90 days', time: '07:30', days: [1, 2, 3, 4, 5] }]);
    await service.updateEnrollment(e.id, { status: 'paused' });
    expect(reminders.rules).toEqual([]);
  });

  it('provides the reading scope for the quiz', async () => {
    const { service } = setup();
    const e = await service.startPlan('stock:mcheyne');
    const [scope] = await service.getTodayScope();
    expect(scope).toMatchObject({ enrollmentId: e.id, day: 1, done: false });
    expect(scope.readings).toHaveLength(4);
    expect(await service.getDayScope(e.id, 2)).toMatchObject({ day: 2 });
    expect(await service.getDayScope('nope', 1)).toBeNull();
  });

  it('exports an iCalendar file', async () => {
    const { service } = setup();
    const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
    const d = await service.detail(e.id);
    const ics = planToIcs(d.plan, d.enrollment, [], { formatReading: (r) => String(r.start), today: '2026-10-01', alarmTime: '07:00' });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(30);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261001');
    expect(ics).toContain('TRIGGER;RELATED=START:PT7H0M');
  });
});

describe('ics escaping', () => {
  it('escapes semicolons and folds by UTF-8 octets', async () => {
    const { service } = setup();
    const e = await service.startPlan('stock:mcheyne', { pacing: 'fixed' });
    const d = await service.detail(e.id);
    const ics = planToIcs(d.plan, d.enrollment, [], { formatReading: () => 'Бытие 1', today: '2026-10-01', title: 'План чтения Библии на год' });
    expect(ics).toContain('\; ');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe('pause and resume', () => {
  it('resuming a fixed plan restarts the schedule from today', async () => {
    const { service, setNow } = setup();
    const e = await service.startPlan('stock:gospels-30', { pacing: 'fixed' });
    await service.setDayDone(e.id, 1, true);
    await service.pause(e.id);
    expect(await service.todayViews()).toEqual([]);
    setNow(new Date(2026, 9, 20, 12, 0));
    await service.resume(e.id);
    expect((await service.todayViews())[0]).toMatchObject({ day: 2, behindBy: 0 });
  });
});
