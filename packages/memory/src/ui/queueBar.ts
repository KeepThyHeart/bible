/**
 * The compact queue status bar on the practice screen (design-r2 R2-3).
 *
 * Shown for every flow except a single verse. `today` and `anyway` flows know how much is left, so
 * they show "{done} of {total} done · {left} left" with a segmented track; the open-ended flows
 * (`mixed`, `activity`) only know what has been done, so they show "{n} done" and no track.
 *
 * `total = max(startTotal, done + left)`: skipping a verse or "Learn a new verse" changes the
 * remainder, and the bar must never claim fewer than were already counted.
 */

import { el } from './dom';
import { tr } from './i18n';

export interface QueueBarInput {
  /** Items finished (or skipped) so far in this flow. */
  done: number;
  /** Items still to go, or `null` when the flow cannot count them. */
  left: number | null;
  /** The total recorded when the flow started, if any. */
  startTotal?: number;
}

/** Most segments drawn; a longer queue is shown as a plain proportional fill. */
const MAX_SEGMENTS = 30;

export function queueBar(input: QueueBarInput): HTMLElement {
  const done = Math.max(0, input.done);

  if (input.left === null) {
    return el('div', { class: 'sm-queue-bar' }, [
      el('span', {
        class: 'sm-queue-text',
        text: tr('memory.ui.practice.queueDoneOnly', '{count} done', { count: done }),
      }),
    ]);
  }

  const left = Math.max(0, input.left);
  const total = Math.max(input.startTotal ?? 0, done + left);
  const text = tr('memory.ui.practice.queueCount', '{done} of {total} done · {left} left', { done, total, left });

  const children: (HTMLElement | null)[] = [el('span', { class: 'sm-queue-text', text })];
  if (total > 0) {
    const track = el(
      'div',
      {
        class: 'sm-queue-track',
        attrs: {
          role: 'progressbar',
          'aria-label': tr('memory.ui.practice.queueProgress', 'Practice queue'),
          'aria-valuemin': '0',
          'aria-valuemax': String(total),
          'aria-valuenow': String(Math.min(done, total)),
          'aria-valuetext': text,
        },
      },
      total <= MAX_SEGMENTS
        ? Array.from({ length: total }, (_, i) =>
            el('span', { class: i < done ? 'sm-queue-seg sm-queue-seg-done' : 'sm-queue-seg' }),
          )
        : [
            el('span', {
              class: 'sm-queue-fill',
              style: { width: `${Math.min(100, (done / total) * 100)}%` },
            }),
          ],
    );
    children.push(track);
  }
  return el('div', { class: 'sm-queue-bar' }, children);
}
