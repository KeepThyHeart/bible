/**
 * One-time notices about the move from the old extension (task 0114).
 *
 * They are recorded in `memory_import` as `pending` and handed to the renderer only when it asks
 * (`takeNotices`, while its window is visible), then marked `shown`. Pushing them as events lost
 * them on a hidden or tray launch: the event reached a window nobody was looking at, and the row
 * said "shown". Imports only `ISql`, so the main module can use it without loading the core.
 */
import type { ISql } from '@bible/core';
import { LEGACY_EXTENSION_ID } from '@bible/memory/legacy';
import type { MemoryNotice } from '@bible/memory/api';

export const RETIRED_KEY = `retired:${LEGACY_EXTENSION_ID}`;
export const RETIRED_NOTICE_KEY = `notice:retired:${LEGACY_EXTENSION_ID}`;
export const SKIPPED_NOTICE_KEY = `notice:skipped:${LEGACY_EXTENSION_ID}`;

/** English texts; the renderer looks up `memory.notice.<id>` and falls back to these. */
export const RETIRED_NOTICE =
  'Scripture Memory is now built in: open it from the Memory app. Your plan and progress were brought over, and the old Scripture Memory extension was turned off.';
export const SKIPPED_NOTICE =
  'Your old Scripture Memory extension data was not brought over automatically because Memory already has a plan. To add it, use "Import data from the old Scripture Memory extension" in Memory\'s settings.';

const NOTICES: ReadonlyArray<{ id: MemoryNotice['id']; key: string; message: string }> = [
  { id: 'retired', key: RETIRED_NOTICE_KEY, message: RETIRED_NOTICE },
  { id: 'skipped', key: SKIPPED_NOTICE_KEY, message: SKIPPED_NOTICE },
];

/** Record a notice as waiting to be shown, once per machine. True when this call recorded it. */
export function queueNotice(db: ISql, id: MemoryNotice['id'], now: number): boolean {
  const notice = NOTICES.find((n) => n.id === id)!;
  return db.execute('INSERT OR IGNORE INTO memory_import (source, status, recorded_at) VALUES (?, ?, ?)', [notice.key, 'pending', now]).changes > 0;
}

/** The notices waiting to be shown; each is marked shown, so a second call returns none. */
export function takePendingNotices(db: ISql, now: number): MemoryNotice[] {
  const out: MemoryNotice[] = [];
  for (const n of NOTICES) {
    const changed = db.execute("UPDATE memory_import SET status = 'shown', recorded_at = ? WHERE source = ? AND status = 'pending'", [now, n.key]).changes;
    if (changed > 0) out.push({ id: n.id, message: n.message });
  }
  return out;
}
