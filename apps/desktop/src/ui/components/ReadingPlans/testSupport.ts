/** Test helpers for the Reading plans pane and bar (task 0073). */
import { ReadingPlans, UserData } from '@bible/core/browser';
import { setReadingPlanServiceForTests } from '../../services/readingPlansAPI';
import { resetReadingPlanStoreForTests } from '../../stores/useReadingPlanStore';

/** A real service over an in-memory store, installed as the renderer's service. `now` is mutable via `setNow`. */
export function installTestService(start = new Date(2026, 9, 1, 12, 0)) {
  const db = new UserData.MemoryUserDb();
  let now = start;
  let n = 0;
  const service = new ReadingPlans.ReadingPlanService(
    new ReadingPlans.UserDataReadingPlanStore(db.items),
    { now: () => now, newId: () => `id${++n}` },
  );
  resetReadingPlanStoreForTests();
  setReadingPlanServiceForTests(service);
  return { service, setNow: (d: Date) => { now = d; } };
}

export function uninstallTestService(): void {
  setReadingPlanServiceForTests(null);
  resetReadingPlanStoreForTests();
}
