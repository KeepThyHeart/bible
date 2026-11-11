/**
 * The memory status (verses to review today, push cards waiting) read straight from the
 * user database, without starting the core (task 0114).
 *
 * The desktop shows a "verses due" badge on the Memory app from boot. Starting
 * the core for that would load the whole feature (and run the one-time
 * import) for every user at every launch; these two counts are all the badge
 * needs. The SQL is the same as `MemoryStore.todayReviewCount` and
 * `MemoryStore.waitingCount()`; `status.test.ts` holds them equal.
 *
 * Tiny on purpose: the desktop main module imports it at startup.
 */

import type { ISql } from '@bible/core';
import type { MemoryStatus } from './api';

/** Midnight at the start of the local day containing `ms` (re-exported as `today.ts#startOfLocalDay`). */
export function localDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The badge: verses to review today = passages with a due text-activity card
 * and no attempt since `dayStart`, in the persisted focus (`practiceScope`; a
 * missing or deleted list means all). Same SQL as `MemoryStore.todayReviewCount`.
 * Known approximation: ignores read-time applicability (e.g. a due `refmatch`
 * card in a list that has since fallen below 25 verses).
 */
export function readMemoryStatus(db: ISql, now: number, dayStart: number = localDayStart(now)): MemoryStatus {
  let listId: number | null = null;
  const raw = db.queryOne<{ value: string }>(`SELECT value FROM memory_setting WHERE key = 'practiceScope'`)?.value;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { kind?: unknown; id?: unknown } | null;
      if (parsed && parsed.kind === 'list' && typeof parsed.id === 'number') {
        const exists = db.queryOne<{ id: number }>(`SELECT id FROM memory_collection WHERE id = ?`, [parsed.id]);
        if (exists) listId = parsed.id;
      }
    } catch {
      // unreadable scope: treat as all
    }
  }
  const due =
    db.queryOne<{ n: number }>(
      `SELECT COUNT(DISTINCT c.passage_id) AS n
         FROM memory_card c
         JOIN memory_passage p ON p.id = c.passage_id
        WHERE c.due_at IS NOT NULL AND c.due_at <= ? AND c.rung NOT IN ('recite', 'recall')
          AND p.deleted_at IS NULL${listId === null ? '' : ' AND p.collection_id = ?'}
          AND NOT EXISTS (
            SELECT 1 FROM memory_attempt a
              JOIN memory_card c2 ON c2.id = a.card_id
             WHERE c2.passage_id = c.passage_id AND c2.rung NOT IN ('recite', 'recall')
               AND a.at >= ? AND (c2.progress_reset_at IS NULL OR a.at > c2.progress_reset_at))`,
      listId === null ? [now, dayStart] : [now, listId, dayStart],
    )?.n ?? 0;
  const waiting =
    db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM memory_push_card pc JOIN memory_passage p ON p.id = pc.passage_id
        WHERE pc.state = 'waiting' AND p.deleted_at IS NULL`,
    )?.n ?? 0;
  return { due, waiting };
}
