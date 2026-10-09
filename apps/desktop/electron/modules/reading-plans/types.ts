/**
 * Shared types of the reading-plans main module: its `TApi` (method name ->
 * function), implemented in `./index.ts` through `ipc.handle` and called by the
 * renderer through `createModuleClient<ReadingPlansApi>('reading-plans')`.
 * Type-only imports, so the renderer pulls no main-process code in.
 */
import type { ReadingPlans } from '@bible/core/browser';

export interface ReadingPlansApi {
  listPlans(): ReadingPlans.PlanDefinition[];
  getPlan(key: string): ReadingPlans.PlanDefinition | null;
  putPlan(plan: unknown): void;
  removePlan(key: string): void;
  putSnapshot(plan: unknown): void;
  listEnrollments(): ReadingPlans.Enrollment[];
  putEnrollment(enrollment: unknown): void;
  removeEnrollment(id: string): void;
  listCompletions(enrollmentId?: string): ReadingPlans.Completion[];
  setCompletions(changes: unknown): void;
}
