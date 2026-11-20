/**
 * ReadingPlanService: the one facade both apps use. Runs wherever the store is reachable (desktop:
 * the renderer over an IPC store). Emits events for the UI, extensions and the quiz (0074), and
 * implements IReadingScopeProvider.
 */
import type {
  BuilderSpec, Completion, CompletionVia, Enrollment, IsoDate, Pacing, PlanDay, PlanDefinition, PlanSummary, Reading, Weekday,
} from './types';
import { ALL_WEEKDAYS } from './types';
import type { IReadingPlanStore } from './store';
import { snapshotKey } from './store';
import { buildPlanDays, MAX_PLAN_DAYS, MAX_READINGS_PER_DAY } from './builder';
import { isValidVerseId, splitVid } from './versification';
import { getStockPlan, isStockPlanKey, listStockPlans, summarizePlan } from './stock';
import {
  dayStatuses, firstUnreadDay, indexCompletions, isDayDone, planStats, shiftedStartDate, todayView,
} from './scheduler';
import type { DayStatus, PlanStats, TodayView } from './scheduler';
import { DEFAULT_ROLLOVER_HOUR, readingDate } from './dates';
import { validateBuilderSpec, validatePlanDefinition, validateWeekdays, ReadingPlanDataError } from './validate';
import { NO_REMINDERS } from './reminders';
import type { ReadingPlanReminderPort } from './reminders';

export type ReadingPlanEvent =
  | { type: 'changed' }
  | { type: 'readingCompleted'; enrollmentId: string; day: number; reading: Reading; via: CompletionVia }
  | { type: 'dayCompleted'; enrollmentId: string; day: number; readings: Reading[] }
  | { type: 'planCompleted'; enrollmentId: string };

export type ReadingPlanListener = (event: ReadingPlanEvent) => void;

/** What the reader is reading in a plan (for the quiz, 0074, and extensions). */
export interface ReadingScope {
  enrollmentId: string;
  planName: string;
  day: number;
  readings: Reading[];
  /** Every reading of that day is ticked. */
  done: boolean;
}

/** Read access to "what am I reading" without the rest of the service. */
export interface IReadingScopeProvider {
  /** The current day of every active plan. */
  getTodayScope(): Promise<ReadingScope[]>;
  /** One day of one enrollment, or null when either does not exist. */
  getDayScope(enrollmentId: string, day: number): Promise<ReadingScope | null>;
}

export interface StartPlanOptions {
  startDate?: IsoDate;
  pacing?: Pacing;
  readingDays?: Weekday[];
}

/** A hand-made plan to save (see `ReadingPlanService.savePlan`). Without `key` a new plan is created. */
export interface SavePlanInput {
  key?: string;
  name: string;
  description?: string;
  days: PlanDay[];
}

export type EnrollmentPatch = Partial<Pick<Enrollment, 'pacing' | 'readingDays' | 'status' | 'startDate' | 'reminder'>>;

export interface EnrollmentDetail {
  enrollment: Enrollment;
  plan: PlanDefinition;
  today: TodayView;
  stats: PlanStats;
  statuses: DayStatus[];
}

export interface ReadingPlanServiceOptions {
  now?: () => Date;
  /** Hour at which a new reading day begins (setting; default 3). */
  rolloverHour?: () => number;
  newId?: () => string;
  reminders?: ReadingPlanReminderPort;
}

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ReadingPlanService implements IReadingScopeProvider {
  private readonly listeners = new Set<ReadingPlanListener>();
  private readonly now: () => Date;
  private readonly rollover: () => number;
  private readonly newId: () => string;
  readonly reminders: ReadingPlanReminderPort;

  constructor(private readonly store: IReadingPlanStore, options: ReadingPlanServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.rollover = options.rolloverHour ?? (() => DEFAULT_ROLLOVER_HOUR);
    this.newId = options.newId ?? defaultId;
    this.reminders = options.reminders ?? NO_REMINDERS;
  }

  subscribe(listener: ReadingPlanListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ReadingPlanEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(event);
      } catch { /* a listener never breaks the service */ }
    }
  }

  /** Today's reading date (local, after the rollover hour). */
  today(): IsoDate {
    return readingDate(this.now(), this.rollover());
  }

  // ---- library ---------------------------------------------------------

  /** Stock plans followed by the user's own plans. */
  async library(): Promise<PlanSummary[]> {
    const own = await this.store.listPlans();
    return [...listStockPlans(), ...own.map(summarizePlan)];
  }

  /** A plan by key: stock (current version), user, or a `key@version` snapshot. */
  async getPlan(key: string): Promise<PlanDefinition | null> {
    if (isStockPlanKey(key) && !key.includes('@')) return getStockPlan(key);
    return this.store.getPlan(key);
  }

  /** Build and save a user plan from a builder spec. */
  async createPlan(rawSpec: BuilderSpec): Promise<PlanDefinition> {
    const spec = validateBuilderSpec(rawSpec);
    const days = buildPlanDays(spec);
    const plan: PlanDefinition = {
      key: `user:${this.newId()}`, version: 1, name: spec.name, source: 'user', days, spec,
      ...(spec.description ? { description: spec.description } : {}),
      ...(spec.tracks?.length ? { tracks: spec.tracks.map((t) => ({ id: t.id, name: t.name })) } : {}),
    };
    await this.store.putPlan(plan);
    this.emit({ type: 'changed' });
    return plan;
  }

  /**
   * Save a hand-made plan. Without `key`: a new `user:` plan at version 1. With `key`: an edit of an existing
   * user plan; enrollments that still point at it directly are first moved onto a snapshot of the old days, so
   * no reader moves, and the version is bumped. The builder `spec` is dropped on edit (it no longer describes the days);
   * tracks and the description are kept.
   */
  async savePlan(input: SavePlanInput): Promise<PlanDefinition> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 1 || name.length > 200) throw new ReadingPlanDataError('The plan needs a name of 1-200 characters.');
    if (!Array.isArray(input.days) || input.days.length < 1 || input.days.length > MAX_PLAN_DAYS) {
      throw new ReadingPlanDataError(`A plan needs 1-${MAX_PLAN_DAYS} days.`);
    }
    const old = input.key === undefined
      ? null
      : input.key.startsWith('user:') && !input.key.includes('@') ? await this.store.getPlan(input.key) : null;
    if (input.key !== undefined && !old) throw new ReadingPlanDataError('Only your own existing plans can be edited.');
    // An edited plan keeps its tracks (a builder plan with parallel readings); a reading keeps its track label
    // while that track still exists.
    const tracks = old?.tracks?.length ? old.tracks : undefined;
    const trackIds = new Set(tracks?.map((t) => t.id));
    const days: PlanDay[] = input.days.map((d, i) => {
      const readings = d?.readings;
      if (!Array.isArray(readings) || readings.length < 1) throw new ReadingPlanDataError(`Day ${i + 1} needs at least one reading.`);
      if (readings.length > MAX_READINGS_PER_DAY) throw new ReadingPlanDataError(`Day ${i + 1} has too many readings.`);
      return {
        readings: readings.map((r, j) => {
          const start = r?.start;
          const end = r?.end;
          if (!isValidVerseId(start) || !isValidVerseId(end) || end < start) {
            throw new ReadingPlanDataError(`Day ${i + 1}, reading ${j + 1} is not a valid verse range.`);
          }
          if (splitVid(start).book !== splitVid(end).book) {
            throw new ReadingPlanDataError(`Day ${i + 1}, reading ${j + 1} must stay within one book.`);
          }
          return typeof r.track === 'string' && trackIds.has(r.track) ? { start, end, track: r.track } : { start, end };
        }),
      };
    });
    // `description` absent keeps the old one; an empty string clears it.
    const description = input.description === undefined ? old?.description : input.description.trim();
    const extras = { ...(description ? { description } : {}), ...(tracks ? { tracks } : {}) };
    const plan: PlanDefinition = old
      ? { key: old.key, version: old.version + 1, name, source: 'user', days, ...extras }
      : { key: `user:${this.newId()}`, version: 1, name, source: 'user', days, ...extras };
    validatePlanDefinition(plan);
    if (old) await this.detachEnrollments(old);
    await this.store.putPlan(plan);
    this.emit({ type: 'changed' });
    return plan;
  }

  /**
   * Move every enrollment that points straight at a user plan (how plans were followed before user plans were
   * snapshotted) onto a snapshot of the plan as it is now, so editing or deleting the plan never moves a reader.
   */
  private async detachEnrollments(old: PlanDefinition): Promise<void> {
    const direct = (await this.store.listEnrollments()).filter((e) => e.planKey === old.key);
    if (direct.length === 0) return;
    await this.store.putSnapshot(old);
    const key = snapshotKey(old.key, old.version);
    for (const e of direct) await this.store.putEnrollment({ ...e, planKey: key, planVersion: old.version });
  }

  /** Delete a user plan. Enrollments that follow it keep working: they move onto a snapshot first. */
  async deletePlan(key: string): Promise<void> {
    if (!key.startsWith('user:') || key.includes('@')) throw new ReadingPlanDataError('Only your own plans can be deleted.');
    const old = await this.store.getPlan(key);
    if (old) await this.detachEnrollments(old);
    await this.store.removePlan(key);
    this.emit({ type: 'changed' });
  }

  // ---- enrollments -------------------------------------------------------

  async enrollments(): Promise<Enrollment[]> {
    return this.store.listEnrollments();
  }

  /** Start following a plan. Stock and user plans are snapshotted so a later update or edit never moves the reader. */
  async startPlan(planKey: string, options: StartPlanOptions = {}): Promise<Enrollment> {
    const plan = await this.getPlan(planKey);
    if (!plan) throw new ReadingPlanDataError(`Unknown plan ${planKey}`);
    let storedKey = plan.key;
    if (plan.source === 'stock' || (plan.source === 'user' && plan.key.startsWith('user:'))) {
      await this.store.putSnapshot(plan);
      storedKey = snapshotKey(plan.key, plan.version);
    }
    const enrollment: Enrollment = {
      id: this.newId(),
      planKey: storedKey,
      planVersion: plan.version,
      planName: plan.name,
      startDate: options.startDate ?? this.today(),
      pacing: options.pacing ?? 'flexible',
      readingDays: options.readingDays ? validateWeekdays(options.readingDays) : [...ALL_WEEKDAYS],
      status: 'active',
      createdAt: this.now().toISOString(),
    };
    await this.store.putEnrollment(enrollment);
    this.emit({ type: 'changed' });
    await this.syncReminders();
    return enrollment;
  }

  private async getEnrollment(id: string): Promise<Enrollment> {
    const e = (await this.store.listEnrollments()).find((x) => x.id === id);
    if (!e) throw new ReadingPlanDataError(`Unknown enrollment ${id}`);
    return e;
  }

  async updateEnrollment(id: string, patch: EnrollmentPatch): Promise<Enrollment> {
    const e = await this.getEnrollment(id);
    const next: Enrollment = { ...e, ...patch };
    if (patch.readingDays) next.readingDays = validateWeekdays(patch.readingDays);
    if (patch.status && patch.status !== 'completed') delete next.completedAt;
    await this.store.putEnrollment(next);
    this.emit({ type: 'changed' });
    await this.syncReminders();
    return next;
  }

  async removeEnrollment(id: string): Promise<void> {
    await this.store.removeEnrollment(id);
    this.emit({ type: 'changed' });
    await this.syncReminders();
  }

  /** Fixed schedule: move the start date so the first unread day is today's. */
  async shiftSchedule(id: string): Promise<Enrollment> {
    const e = await this.getEnrollment(id);
    const plan = await this.planFor(e);
    const completions = await this.store.listCompletions(id);
    return this.updateEnrollment(id, { startDate: shiftedStartDate(plan, e, completions, this.today()) });
  }

  /** Pause a plan: it leaves Today and its reminders stop. */
  async pause(id: string): Promise<Enrollment> {
    return this.updateEnrollment(id, { status: 'paused' });
  }

  /** Resume a paused plan. A fixed schedule restarts from today, so the paused days are not counted as missed. */
  async resume(id: string): Promise<Enrollment> {
    const e = await this.updateEnrollment(id, { status: 'active' });
    // A plan paused before its start date keeps that start date.
    return e.pacing === 'fixed' && e.startDate < this.today() ? this.shiftSchedule(id) : e;
  }

  /** Stop tracking a schedule: today becomes the first unread day and nothing is ever overdue. */
  async switchToFlexible(id: string): Promise<Enrollment> {
    return this.updateEnrollment(id, { pacing: 'flexible' });
  }

  /** The plan an enrollment follows (its snapshot). */
  async planFor(e: Enrollment): Promise<PlanDefinition> {
    const plan = await this.store.getPlan(e.planKey);
    if (plan) return plan;
    // A missing snapshot (restored from an old backup) falls back to the current stock plan.
    const base = e.planKey.split('@')[0];
    const stock = isStockPlanKey(base) ? getStockPlan(base) : null;
    if (stock) return stock;
    throw new ReadingPlanDataError(`The plan for "${e.planName}" is missing.`);
  }

  // ---- progress ----------------------------------------------------------

  async setReadingDone(enrollmentId: string, day: number, reading: number, done: boolean, via: CompletionVia = 'manual'): Promise<void> {
    await this.setReadings(enrollmentId, day, [reading], done, via);
  }

  /** Tick or untick a whole day. */
  async setDayDone(enrollmentId: string, day: number, done: boolean, via: CompletionVia = 'manual'): Promise<void> {
    const e = await this.getEnrollment(enrollmentId);
    const plan = await this.planFor(e);
    const count = plan.days[day - 1]?.readings.length ?? 0;
    await this.setReadings(enrollmentId, day, Array.from({ length: count }, (_, i) => i), done, via);
  }

  private async setReadings(enrollmentId: string, day: number, readings: number[], done: boolean, via: CompletionVia): Promise<void> {
    const e = await this.getEnrollment(enrollmentId);
    const plan = await this.planFor(e);
    const dayDef = plan.days[day - 1];
    if (!dayDef) throw new ReadingPlanDataError(`Day ${day} is not in this plan`);
    const before = await this.store.listCompletions(enrollmentId);
    const progress = indexCompletions(before);
    const wasDayDone = isDayDone(plan, progress, day);
    const at = this.now().toISOString();
    const changes = readings
      .filter((r) => r >= 0 && r < dayDef.readings.length && (progress.get(day)?.has(r) ?? false) !== done)
      .map((r) => ({ completion: { enrollmentId, day, reading: r, at, via } as Completion, done }));
    if (changes.length === 0) return;
    await this.store.setCompletions(changes);
    for (const c of changes) {
      const set = progress.get(day) ?? new Set<number>();
      if (done) set.add(c.completion.reading);
      else set.delete(c.completion.reading);
      progress.set(day, set);
    }
    if (done) {
      this.emit({ type: 'changed' });
      for (const c of changes) this.emit({ type: 'readingCompleted', enrollmentId, day, reading: dayDef.readings[c.completion.reading], via });
      if (!wasDayDone && isDayDone(plan, progress, day)) this.emit({ type: 'dayCompleted', enrollmentId, day, readings: dayDef.readings });
      if (firstUnreadDay(plan, progress) === null && e.status !== 'completed') {
        await this.store.putEnrollment({ ...e, status: 'completed', completedAt: at });
        this.emit({ type: 'planCompleted', enrollmentId });
        this.emit({ type: 'changed' });
        await this.syncReminders();
      }
    } else {
      // Reopen a completed plan before anyone re-reads it.
      const reopen = e.status === 'completed';
      if (reopen) {
        const next = { ...e, status: 'active' as const };
        delete next.completedAt;
        await this.store.putEnrollment(next);
      }
      this.emit({ type: 'changed' });
      if (reopen) await this.syncReminders();
    }
  }

  /** Every ticked reading of one enrollment (for exports). */
  async completions(enrollmentId: string): Promise<Completion[]> {
    return this.store.listCompletions(enrollmentId);
  }

  // ---- views -------------------------------------------------------------

  /** Today's card for every active plan. */
  async todayViews(): Promise<TodayView[]> {
    const today = this.today();
    const out: TodayView[] = [];
    const completions = await this.store.listCompletions();
    for (const e of await this.store.listEnrollments()) {
      if (e.status !== 'active') continue;
      try {
        out.push(todayView(await this.planFor(e), e, completions, today));
      } catch { /* a broken plan does not hide the others */ }
    }
    return out;
  }

  async detail(enrollmentId: string): Promise<EnrollmentDetail> {
    const enrollment = await this.getEnrollment(enrollmentId);
    const plan = await this.planFor(enrollment);
    const completions = await this.store.listCompletions(enrollmentId);
    const today = this.today();
    return {
      enrollment,
      plan,
      today: todayView(plan, enrollment, completions, today),
      stats: planStats(plan, enrollment, completions, today, this.rollover()),
      statuses: dayStatuses(plan, enrollment, completions, today),
    };
  }

  /** Ticked reading indexes of one day. */
  async dayProgress(enrollmentId: string, day: number): Promise<number[]> {
    return (await this.store.listCompletions(enrollmentId)).filter((c) => c.day === day).map((c) => c.reading).sort((a, b) => a - b);
  }

  // ---- IReadingScopeProvider ---------------------------------------------

  async getTodayScope(): Promise<ReadingScope[]> {
    return (await this.todayViews())
      .filter((v) => v.day !== null)
      .map((v) => ({ enrollmentId: v.enrollmentId, planName: v.planName, day: v.day!, readings: v.readings.map((r) => r.reading), done: v.dayDone }));
  }

  async getDayScope(enrollmentId: string, day: number): Promise<ReadingScope | null> {
    const e = (await this.store.listEnrollments()).find((x) => x.id === enrollmentId);
    if (!e) return null;
    const plan = await this.planFor(e);
    const d = plan.days[day - 1];
    if (!d) return null;
    const progress = indexCompletions(await this.store.listCompletions(enrollmentId));
    return { enrollmentId, planName: e.planName, day, readings: d.readings, done: isDayDone(plan, progress, day) };
  }

  // ---- reminders ---------------------------------------------------------

  /** Hand the active reminders to the reminder port (0083 seam). */
  async syncReminders(): Promise<void> {
    if (!this.reminders.available) return;
    const rules = (await this.store.listEnrollments())
      .filter((e) => e.status === 'active' && e.reminder)
      .map((e) => ({ enrollmentId: e.id, planName: e.planName, time: e.reminder!.time, days: e.readingDays }));
    try {
      await this.reminders.sync(rules);
    } catch { /* reminders are best-effort */ }
  }
}
