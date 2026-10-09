/**
 * The "memory cards waiting" banner on the plan screen (task 0072).
 *
 * Shown whenever notification cards have fired (or degraded-mode ticks have
 * promoted them) and not yet been answered. One real button: pressing it opens
 * the card stack.
 */

import { el } from './dom';
import type { PanelHost } from './host';
import { tr } from './i18n';

/** `null` when nothing is waiting, so callers can append it unconditionally. */
export function cardsWaitingBanner(host: PanelHost, count: number): HTMLElement | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const label = tr('memory.ui.plan.cardsWaiting', '{count, plural, one {# memory card waiting} other {# memory cards waiting}}', { count });
  const b = el('button', {
    class: 'sm-cards-banner',
    attrs: { 'aria-label': tr('memory.ui.plan.cardsWaitingAria', '{label}. Open the cards.', { label }) },
  }, [
    el('span', { class: 'sm-cards-banner-text', text: label }),
    el('span', { class: 'sm-cards-banner-go', text: tr('memory.ui.plan.review', 'Review'), attrs: { 'aria-hidden': 'true' } }),
  ]);
  b.type = 'button';
  b.addEventListener('click', () => host.go({ type: 'goCard' }));
  return b;
}
