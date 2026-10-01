/**
 * Data hook shared by the Reading plans pane views (task 0073): the user's enrollments, their
 * detail (plan, stats, statuses) and the plan library, reloaded whenever the service reports a change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReadingPlans } from '@bible/core/browser';
import { getReadingPlanService } from '../../services/readingPlansAPI';

export interface ReadingPlanData {
  enrollments: ReadingPlans.Enrollment[];
  details: Map<string, ReadingPlans.EnrollmentDetail>;
  library: ReadingPlans.PlanSummary[];
}

const EMPTY: ReadingPlanData = { enrollments: [], details: new Map(), library: [] };

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
      await Promise.all(enrollments.map(async (e) => {
        try {
          details.set(e.id, await service.detail(e.id));
        } catch { /* a broken plan does not hide the others */ }
      }));
      if (!alive.current) return;
      setData({ enrollments, details, library });
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
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [reload]);

  return { data, loaded, error, reload };
}
