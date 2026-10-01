/**
 * Renderer side of reading-plan persistence (task 0073). The rows live in the user database
 * (`electron/ipc/readingPlanHandlers.ts`); this adapter lets core's ReadingPlanService treat that
 * IPC as its IReadingPlanStore. `getReadingPlanService()` is the renderer's single service.
 */
import { ReadingPlans } from '@bible/core/browser';
import { unwrap, type Result } from './ipcResult';

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
let rolloverHour = ReadingPlans.DEFAULT_ROLLOVER_HOUR;

/** Set from the "New reading day starts at" preference. */
export function setReadingPlanRolloverHour(hour: number): void {
  rolloverHour = hour;
}

/**
 * The renderer's ReadingPlanService. Reminders use the core no-op port until the notifications
 * engine (task 0083) lands; then pass its adapter here (the UI shows reminder settings only when
 * `service.reminders.available`).
 */
export function getReadingPlanService(): ReadingPlans.ReadingPlanService {
  if (!service) {
    service = new ReadingPlans.ReadingPlanService(new IpcReadingPlanStore(), { rolloverHour: () => rolloverHour });
  }
  return service;
}

/** Tests only. */
export function setReadingPlanServiceForTests(s: ReadingPlans.ReadingPlanService | null): void {
  service = s;
}
