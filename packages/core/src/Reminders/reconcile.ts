/**
 * Missed-reminder reconciliation: what to do with reminders whose time has
 * passed when the engine next looks (after sleep, a quit, quiet hours, or a
 * late timer). Never a backlog: at most one notification per source.
 */
import { DEFAULT_MISSED_POLICY, type MissedPolicy } from './types';

export interface ReconcileResult<T> {
  /** Due within the late tolerance: show as normal. */
  onTime: T[];
  /** Overdue but recent: collapse into one notification per source. */
  summarize: T[];
  /** Too old: drop silently (the feature still knows they are due). */
  drop: T[];
  /** Not due yet. */
  future: T[];
}

/**
 * Split `pending` by how late each item is at `now`. Each list keeps the
 * input's relative order. Items exactly at `now` are on time.
 */
export function reconcileMissed<T extends { fireAt: number }>(
  pending: readonly T[],
  now: number,
  policy: Partial<MissedPolicy> = {},
): ReconcileResult<T> {
  const p = { ...DEFAULT_MISSED_POLICY, ...policy };
  const out: ReconcileResult<T> = { onTime: [], summarize: [], drop: [], future: [] };
  for (const item of pending) {
    const late = now - item.fireAt;
    if (!Number.isFinite(item.fireAt) || late > p.collapseWithinMs) out.drop.push(item);
    else if (late < 0) out.future.push(item);
    else if (late <= p.lateToleranceMs) out.onTime.push(item);
    else out.summarize.push(item);
  }
  return out;
}
