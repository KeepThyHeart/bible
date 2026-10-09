/**
 * Renderer side of reading-plan persistence (task 0073). The rows live in the user database
 * (`electron/modules/reading-plans/index.ts`); this adapter lets core's ReadingPlanService treat that
 * IPC as its IReadingPlanStore. `getReadingPlanService()` is the renderer's single service.
 */
import { ReadingPlans } from '@bible/core/browser';
import { createModuleClient, type ModuleClient } from '../../services/moduleClient';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import type { ReadingPlansApi } from '../../../../electron/modules/reading-plans/types';

type PlanDefinition = ReadingPlans.PlanDefinition;
type Enrollment = ReadingPlans.Enrollment;
type Completion = ReadingPlans.Completion;
type CompletionChange = ReadingPlans.CompletionChange;

export class IpcReadingPlanStore implements ReadingPlans.IReadingPlanStore {
  constructor(private readonly client: ModuleClient<ReadingPlansApi> = createModuleClient<ReadingPlansApi>('reading-plans')) {}

  listPlans(): Promise<PlanDefinition[]> { return this.client.listPlans(); }
  getPlan(key: string): Promise<PlanDefinition | null> { return this.client.getPlan(key); }
  async putPlan(plan: PlanDefinition): Promise<void> { await this.client.putPlan(plan); }
  async removePlan(key: string): Promise<void> { await this.client.removePlan(key); }
  async putSnapshot(plan: PlanDefinition): Promise<void> { await this.client.putSnapshot(plan); }
  listEnrollments(): Promise<Enrollment[]> { return this.client.listEnrollments(); }
  async putEnrollment(e: Enrollment): Promise<void> { await this.client.putEnrollment(e); }
  async removeEnrollment(id: string): Promise<void> { await this.client.removeEnrollment(id); }
  listCompletions(enrollmentId?: string): Promise<Completion[]> { return this.client.listCompletions(enrollmentId); }
  async setCompletions(changes: CompletionChange[]): Promise<void> { await this.client.setCompletions(changes); }
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
