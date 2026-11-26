/**
 * Keeps reading-plan views from showing a stale "today" (task 0073). `watchReadingDay(onTick)` calls
 * `onTick` when the reading day rolls over (one timeout to the next rollover-hour boundary, capped at
 * 24 hours and re-armed after every tick) and when the window regains focus or becomes visible.
 */
import { usePreferencesStore } from '../../stores/usePreferencesStore';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds from `now` to the next local time at `rolloverHour`, never more than 24 hours. */
export function msUntilNextRollover(now: Date, rolloverHour: number): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), rolloverHour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return Math.min(Math.max(next.getTime() - now.getTime(), 1000), DAY_MS);
}

export function watchReadingDay(onTick: () => void, getRolloverHour: () => number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(tick, msUntilNextRollover(new Date(), getRolloverHour()));
  };
  const tick = () => { onTick(); arm(); };
  const onVisibility = () => { if (document.visibilityState === 'visible') tick(); };
  arm();
  // The rollover hour moved: the armed timeout aims at the old boundary, so re-arm for the new one.
  let lastHour = usePreferencesStore.getState().readingPlanRolloverHour;
  const stopPref = usePreferencesStore.subscribe((state) => {
    if (state.readingPlanRolloverHour === lastHour) return;
    lastHour = state.readingPlanRolloverHour;
    arm();
  });
  window.addEventListener('focus', tick);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    stopPref();
    window.removeEventListener('focus', tick);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
