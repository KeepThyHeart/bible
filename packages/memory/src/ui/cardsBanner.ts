/**
 * The "memory cards waiting" banner on the plan screen (task 0072).
 *
 * Shown whenever notification cards have fired (or degraded-mode ticks have
 * promoted them) and not yet been answered. One real button: pressing it opens
 * the card stack.
 */

import { el } from './dom';
import type { PanelHost } from './host';

/** `null` when nothing is waiting, so callers can append it unconditionally. */
export function cardsWaitingBanner(host: PanelHost, count: number): HTMLElement | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const label = count === 1 ? '1 memory card waiting' : `${count} memory cards waiting`;
  const b = el('button', {
    class: 'sm-cards-banner',
    attrs: { 'aria-label': `${label}. Open the cards.` },
  }, [
    el('span', { class: 'sm-cards-banner-text', text: label }),
    el('span', { class: 'sm-cards-banner-go', text: 'Review', attrs: { 'aria-hidden': 'true' } }),
  ]);
  b.type = 'button';
  b.addEventListener('click', () => host.go({ type: 'goCard' }));
  return b;
}
