/**
 * Turning a font *step* into actual type on an actual screen.
 *
 * The protocol carries a step from 1 to 10, never a pixel size, because the
 * same session is read on a television across a hall and on a phone in a pew.
 * Everything below is the viewer's own translation of that step for the panel
 * it happens to be attached to.
 */

/**
 * Font size per step, as a percentage of viewport height.
 *
 * Viewport-relative, not pixels: a 1080p television and a 4K one should show
 * the same number of words, and they do not if the size is fixed in px. The
 * curve is geometric rather than linear, because a step from 2 to 3 has to feel
 * like the same change as a step from 8 to 9.
 *
 * Step 5 is the default and lands at roughly 56px on a 1080p panel, which is
 * comfortably readable at the back of a mid-sized room.
 */
const FONT_SCALE_VH = [2.6, 3.1, 3.7, 4.4, 5.2, 6.0, 6.9, 7.9, 9.0, 10.2];

export function fontScaleForStep(step: number): number {
  const index = Math.min(Math.max(Math.round(step), 1), FONT_SCALE_VH.length) - 1;
  return FONT_SCALE_VH[index];
}

/**
 * How far a single verse may be shrunk before we stop trying.
 *
 * Below about two thirds the verse is no longer the size the presenter chose,
 * and letting it fall further produces a wall of small text nobody can read --
 * which is worse than a verse that scrolls.
 */
const MIN_SHRINK = 0.66;

/**
 * Shrink one verse until it fits the available height, and report the scale.
 *
 * The presenter picks a size for the passage; occasionally one verse (Esther
 * 8:9, say) is long enough that it alone overflows the screen at that size.
 * Shrinking that verse alone is far less disruptive than dropping the size of
 * everything, which is what a whole-view auto-fit would do -- one long verse
 * would silently shrink the rest of the reading.
 *
 * Returns 1 when no shrinking was needed, so the caller can skip the write.
 */
export function shrinkToFit(element: HTMLElement, availableHeight: number): number {
  if (availableHeight <= 0) return 1;

  // Measure unshrunk. Reading `scrollHeight` with a stale transform still in
  // place is how this kind of code ends up ratcheting smaller on every render.
  element.style.removeProperty('--verse-shrink');
  if (element.scrollHeight <= availableHeight) return 1;

  // Binary search rather than stepping down: each probe costs a synchronous
  // layout, and eight of them is already more than this should need.
  let low = MIN_SHRINK;
  let high = 1;
  let best = MIN_SHRINK;

  for (let probe = 0; probe < 6; probe++) {
    const mid = (low + high) / 2;
    element.style.setProperty('--verse-shrink', String(mid));
    if (element.scrollHeight <= availableHeight) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  element.style.setProperty('--verse-shrink', String(best));
  return best;
}

/**
 * Whether to animate at all.
 *
 * Honoured for the same reason it is honoured anywhere, and one more: a viewer
 * pinned to a machine with animations disabled system-wide is often an old one,
 * where a smooth scroll of a full chapter is a slideshow rather than a glide.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
