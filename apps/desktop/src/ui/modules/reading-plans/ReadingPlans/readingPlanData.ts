/**
 * Data hook shared by the Reading plans pane views (task 0073): the user's enrollments, their
 * detail (plan, stats, statuses) and the plan library, reloaded whenever the service reports a change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { currentRolloverHour, getReadingPlanService } from '../readingPlansAPI';
import { watchReadingDay } from '../readingDayWatcher';

export interface ReadingPlanData {
  enrollments: ReadingPlans.Enrollment[];
  details: Map<string, ReadingPlans.EnrollmentDetail>;
  /** Ticked readings per enrollment (`day -> reading indexes`). */
  progress: Map<string, ReadingPlans.ProgressIndex>;
  library: ReadingPlans.PlanSummary[];
}

const EMPTY: ReadingPlanData = { enrollments: [], details: new Map(), progress: new Map(), library: [] };

export function useReadingPlanData(): { data: ReadingPlanData; loaded: boolean; error: string | null; reload: () => Promise<void> } {
  const [data, setData] = useState<ReadingPlanData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const service = getReadingPlanService();
      const [enrollments, library] = await Promise.all([service.enrollments(), service.library()]);
      const details = new Map<string, ReadingPlans.EnrollmentDetail>();
      const progress = new Map<string, ReadingPlans.ProgressIndex>();
      await Promise.all(enrollments.map(async (e) => {
        try {
          const [detail, completions] = await Promise.all([service.detail(e.id), service.completions(e.id)]);
          details.set(e.id, detail);
          progress.set(e.id, ReadingPlans.indexCompletions(completions, e.id));
        } catch { /* a broken plan does not hide the others */ }
      }));
      if (!alive.current) return;
      setData({ enrollments, details, progress, library });
      setError(null);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const unsubscribe = getReadingPlanService().subscribe((event) => {
      if (event.type === 'changed') void reload();
    });
    const stopWatching = watchReadingDay(() => { void reload(); }, currentRolloverHour);
    return () => {
      alive.current = false;
      unsubscribe();
      stopWatching();
    };
  }, [reload]);

  return { data, loaded, error, reload };
}
