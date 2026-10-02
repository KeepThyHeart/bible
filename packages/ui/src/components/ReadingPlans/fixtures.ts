import { ReadingPlans } from '@bible/core/browser';

/** A 5-day Jude+Philemon-ish plan built with the real core engine. */
export function smallPlan(): ReadingPlans.PlanDefinition {
  const spec: ReadingPlans.BuilderSpec = {
    name: 'Short epistles',
    scope: [ReadingPlans.booksRange(65), ReadingPlans.booksRange(57), ReadingPlans.booksRange(63)],
    order: 'canonical',
    pace: { by: 'days', days: 5 },
    split: 'verse',
  };
  return { key: 'user:t', version: 1, name: spec.name, source: 'user', days: ReadingPlans.buildPlanDays(spec), spec };
}

export function enrollment(over: Partial<ReadingPlans.Enrollment> = {}): ReadingPlans.Enrollment {
  return {
    id: 'e1', planKey: 'user:t', planVersion: 1, planName: 'Short epistles', startDate: '2026-01-05', pacing: 'fixed',
    readingDays: [0, 1, 2, 3, 4, 5, 6], status: 'active', createdAt: '2026-01-05T00:00:00Z', ...over,
  };
}

export const bookName = (b: number) => ({ 57: 'Philemon', 63: '2 John', 65: 'Jude' } as Record<number, string>)[b] ?? `Book ${b}`;
export const fmt = (r: ReadingPlans.Reading) => ReadingPlans.formatReading(r, bookName);
