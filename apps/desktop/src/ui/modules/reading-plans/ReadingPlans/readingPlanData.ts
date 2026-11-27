/**
 * Data hook shared by the Reading plans pane views (task 0073): the user's enrollments, their
 * detail (plan, stats, statuses) and the plan library, reloaded whenever the service reports a change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import { currentRolloverHour, getReadingPlanService } from '../readingPlansAPI';
import { watchReadingDay } from '../readingDayWatcher';

/**
 * A plan's progress for display: one decimal while it is young (so the first days do not read as 0%), whole
 * numbers after, and never 100 before the plan is finished.
 */
export function shownPercent(percent: number): number {
  if (percent >= 100) return 100;
  return percent > 0 && percent < 10 ? Math.floor(percent * 10) / 10 : Math.floor(percent);
}

export interface ReadingPlanData {
  enrollments: ReadingPlans.Enrollment[];
  details: Map<string, ReadingPlans.EnrollmentDetail>;
  /** Ticked readings per enrollment (`day -> reading indexes`). */
  progress: Map<string, ReadingPlans.ProgressIndex>;
  /** Each plan's ticked readings, with when they were ticked (the month calendar places them on dates). */
  completions: Map<string, ReadingPlans.Completion[]>;
  library: ReadingPlans.PlanSummary[];
}

const EMPTY: ReadingPlanData = { enrollments: [], details: new Map(), progress: new Map(), completions: new Map(), library: [] };

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
      const completionsById = new Map<string, ReadingPlans.Completion[]>();
      await Promise.all(enrollments.map(async (e) => {
        try {
          const [detail, completions] = await Promise.all([service.detail(e.id), service.completions(e.id)]);
          details.set(e.id, detail);
          progress.set(e.id, ReadingPlans.indexCompletions(completions, e.id));
          completionsById.set(e.id, completions);
        } catch { /* a broken plan does not hide the others */ }
      }));
      if (!alive.current) return;
      setData({ enrollments, details, progress, completions: completionsById, library });
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
