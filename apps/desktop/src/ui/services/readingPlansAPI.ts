/**
 * Renderer side of reading-plan persistence (task 0073). The rows live in the user database
 * (`electron/ipc/readingPlanHandlers.ts`); this adapter lets core's ReadingPlanService treat that
 * IPC as its IReadingPlanStore. `getReadingPlanService()` is the renderer's single service.
 */
import { ReadingPlans } from '@bible/core/browser';
import { unwrap, type Result } from './ipcResult';
import { usePreferencesStore } from '../stores/usePreferencesStore';

type PlanDefinition = ReadingPlans.PlanDefinition;
type Enrollment = ReadingPlans.Enrollment;
type Completion = ReadingPlans.Completion;
type CompletionChange = ReadingPlans.CompletionChange;

export type ReadingPlanChannel =
  | 'reading-plans:list-plans'
  | 'reading-plans:get-plan'
  | 'reading-plans:put-plan'
  | 'reading-plans:remove-plan'
  | 'reading-plans:put-snapshot'
  | 'reading-plans:list-enrollments'
  | 'reading-plans:put-enrollment'
  | 'reading-plans:remove-enrollment'
  | 'reading-plans:list-completions'
  | 'reading-plans:set-completions';

type Invoke = (channel: ReadingPlanChannel, ...args: unknown[]) => Promise<Result<unknown>>;

const defaultInvoke: Invoke = (channel, ...args) =>
  window.electron.ipcRenderer.invoke<Result<unknown>>(channel, ...args);

export class IpcReadingPlanStore implements ReadingPlans.IReadingPlanStore {
  constructor(private readonly invoke: Invoke = defaultInvoke) {}

  private call<T>(channel: ReadingPlanChannel, ...args: unknown[]): Promise<T> {
    return unwrap(this.invoke(channel, ...args) as Promise<Result<T>>);
  }

  listPlans(): Promise<PlanDefinition[]> { return this.call('reading-plans:list-plans'); }
  getPlan(key: string): Promise<PlanDefinition | null> { return this.call('reading-plans:get-plan', key); }
  async putPlan(plan: PlanDefinition): Promise<void> { await this.call('reading-plans:put-plan', plan); }
  async removePlan(key: string): Promise<void> { await this.call('reading-plans:remove-plan', key); }
  async putSnapshot(plan: PlanDefinition): Promise<void> { await this.call('reading-plans:put-snapshot', plan); }
  listEnrollments(): Promise<Enrollment[]> { return this.call('reading-plans:list-enrollments'); }
  async putEnrollment(e: Enrollment): Promise<void> { await this.call('reading-plans:put-enrollment', e); }
  async removeEnrollment(id: string): Promise<void> { await this.call('reading-plans:remove-enrollment', id); }
  listCompletions(enrollmentId?: string): Promise<Completion[]> { return this.call('reading-plans:list-completions', enrollmentId); }
  async setCompletions(changes: CompletionChange[]): Promise<void> { await this.call('reading-plans:set-completions', changes); }
}

let service: ReadingPlans.ReadingPlanService | null = null;

/** The "New reading day starts at" preference, read on every call so it is right from the first load. */
export function currentRolloverHour(): number {
  const hour = usePreferencesStore.getState().readingPlanRolloverHour;
  return typeof hour === 'number' && Number.isFinite(hour) ? hour : ReadingPlans.DEFAULT_ROLLOVER_HOUR;
}

/**
 * The renderer's ReadingPlanService. Reminders use the core no-op port: the notifications engine
 * (task 0083) is merged, but no reading-plan adapter for it exists yet; pass one here (the UI shows
 * reminder settings only when `service.reminders.available`).
 */
export function getReadingPlanService(): ReadingPlans.ReadingPlanService {
  if (!service) {
    service = new ReadingPlans.ReadingPlanService(new IpcReadingPlanStore(), { rolloverHour: currentRolloverHour });
  }
  return service;
}

/** Tests only. */
export function setReadingPlanServiceForTests(s: ReadingPlans.ReadingPlanService | null): void {
  service = s;
}
