/**
 * Wording and chips for a verse's single status (New / Learning / Known) and its
 * next review. Status is always text; the class only adds colour.
 */

import type { VerseStatus } from '../core/today';
import { calendarDaysBetween, formatShortDate } from './format';
import { tr } from './i18n';
import { el } from './dom';

export function statusLabel(status: VerseStatus): string {
  switch (status) {
    case 'new':
      return tr('memory.ui.common.statusNew', 'New');
    case 'known':
      return tr('memory.ui.common.statusKnown', 'Known');
    default:
      return tr('memory.ui.common.statusLearning', 'Learning');
  }
}

/** A status chip: the word is always shown, so colour is never the only signal. */
export function statusChip(status: VerseStatus): HTMLElement {
  return el('span', { class: `sm-status sm-status-${status}`, text: statusLabel(status) });
}

/**
 * "Due today", "Done today" (due, but already practiced today), "Tomorrow",
 * "In 3 days", a date, "Not scheduled" (started, no scheduled review) or
 * "Not started" (a new verse).
 */
export function nextReviewText(
  info: { status: VerseStatus; nextReviewAt: number | null; doneToday?: boolean },
  now: number,
): string {
  if (info.status === 'new') return tr('memory.ui.common.nextNotStarted', 'Not started');
  if (info.nextReviewAt === null) return tr('memory.ui.common.nextNotScheduled', 'Not scheduled');
  const at = info.nextReviewAt;
  const days = calendarDaysBetween(now, at);
  if (at <= now || days <= 0) {
    return info.doneToday
      ? tr('memory.ui.common.nextDoneToday', 'Done today')
      : tr('memory.ui.common.nextToday', 'Due today');
  }
  if (days === 1) return tr('memory.ui.common.nextTomorrow', 'Tomorrow');
  if (days < 7) return tr('memory.ui.common.nextInDays', '{days, plural, one {In # day} other {In # days}}', { days });
  return formatShortDate(at, now);
}
