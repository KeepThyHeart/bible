/**
 * Small repairs over the memory tables that run outside the core (task 0114).
 * Synchronous, over the host `ISql`; light enough for the desktop main module
 * to import at startup.
 */

import type { ISql } from '@bible/core';

/**
 * For each soft-deleted passage: how many of its attempts are newer than its
 * removal. Taken just before a backup is merged, so `reviveMergedPassages` can
 * tell what the merge brought from what was already here.
 */
export function deletedPassageActivity(db: ISql): Map<number, number> {
  const rows = db.queryAll<{ id: number; n: number }>(
    `SELECT p.id AS id,
            (SELECT COUNT(*) FROM memory_card c JOIN memory_attempt a ON a.card_id = c.id
              WHERE c.passage_id = p.id AND a.at > p.deleted_at) AS n
       FROM memory_passage p
      WHERE p.deleted_at IS NOT NULL`,
  );
  return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * After a backup is MERGED: a passage the user removed here (soft-deleted) but
 * kept practising on the machine the backup came from now has attempts newer
 * than its removal that the merge brought in. Merge matches the backup's
 * passage onto the removed local row, so without this the history would sit on
 * a hidden passage and be purged with it a week later. Such passages come back.
 *
 * `before` is `deletedPassageActivity` from just before the merge: only
 * passages that GAINED newer attempts in the merge come back. Attempts that
 * were already here (a session that finished just after a removal) and
 * passages whose merged history all predates the removal stay removed.
 * Returns how many came back.
 */
export function reviveMergedPassages(db: ISql, before: ReadonlyMap<number, number>): number {
  let revived = 0;
  for (const [id, n] of deletedPassageActivity(db)) {
    const was = before.get(id);
    if (was === undefined || n <= was) continue;
    revived += db.execute('UPDATE memory_passage SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL', [id]).changes;
  }
  return revived;
}

/** Whether the user has push cards switched on (their settings JSON says `enabled: true`). */
export function pushCardsEnabled(db: ISql): boolean {
  const row = db.queryOne<{ value: string }>("SELECT value FROM memory_setting WHERE key = 'pushCards'");
  if (!row) return false;
  try {
    return (JSON.parse(row.value) as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}
