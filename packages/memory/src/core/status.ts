/**
 * The memory status (verses due, push cards waiting) read straight from the
 * user database, without starting the core (task 0114).
 *
 * The desktop shows a "verses due" badge on the Memory app from boot. Starting
 * the core for that would load the whole feature (and run the one-time
 * import) for every user at every launch; these two counts are all the badge
 * needs. The SQL is the same as `MemoryStore.dueCount({ kind: 'all' })` and
 * `MemoryStore.waitingCount()`; `status.test.ts` holds them equal.
 *
 * Tiny on purpose: the desktop main module imports it at startup.
 */

import type { ISql } from '@bible/core';
import type { MemoryStatus } from './api';

export function readMemoryStatus(db: ISql, now: number): MemoryStatus {
  const due =
    db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM memory_card c
         JOIN memory_passage p ON p.id = c.passage_id
        WHERE c.due_at IS NOT NULL AND c.due_at <= ? AND c.rung NOT IN ('recite', 'recall') AND p.deleted_at IS NULL`,
      [now],
    )?.n ?? 0;
  const waiting =
    db.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM memory_push_card pc JOIN memory_passage p ON p.id = pc.passage_id
        WHERE pc.state = 'waiting' AND p.deleted_at IS NULL`,
    )?.n ?? 0;
  return { due, waiting };
}
