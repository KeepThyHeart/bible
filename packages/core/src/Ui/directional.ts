/**
 * Direction-aware geometry and keyboard helpers (task 0076).
 *
 * CSS logical properties handle almost all mirroring declaratively. These
 * helpers cover the few places that compute a physical value in JavaScript:
 * arrow keys, horizontal scroll offsets and overlays anchored to a pointer
 * x-coordinate. They take the direction as an argument (no DOM reads beyond
 * the element passed in), so they are testable and usable from either app.
 *
 * Two directions, never conflated:
 *  - roving focus in toolbars, tab strips and pickers follows the **UI**
 *    direction;
 *  - chapter keys and swipe follow the **content** direction (a page turn in
 *    an RTL Bible goes the other way).
 * History keys (Alt+Left/Right) stay physical, as in browsers; do not route
 * them through here.
 */

import type { LocaleDirection } from '../Data/Locales/LocaleRegistry';

/** Logical meaning of a horizontal arrow key. */
export type LogicalStep = 'prev' | 'next';

/**
 * Map a `KeyboardEvent.key` to a logical step for the given direction.
 * `ArrowRight` is "next" in LTR and "prev" in RTL; `ArrowLeft` the reverse.
 * Any other key returns `null`, so callers can fall through to their own
 * handling (vertical arrows, Home/End).
 */
export function logicalArrow(key: string, dir: LocaleDirection): LogicalStep | null {
  if (key === 'ArrowRight') return dir === 'rtl' ? 'prev' : 'next';
  if (key === 'ArrowLeft') return dir === 'rtl' ? 'next' : 'prev';
  return null;
}

/**
 * Map a horizontal swipe to a logical step for the given (content) direction.
 * `deltaX` is end minus start in physical pixels: a swipe to the left
 * (negative) advances in LTR (like turning a page) and goes back in RTL.
 */
export function logicalSwipe(deltaX: number, dir: LocaleDirection): LogicalStep | null {
  if (deltaX === 0) return null;
  const leftward = deltaX < 0;
  if (dir === 'rtl') return leftward ? 'prev' : 'next';
  return leftward ? 'next' : 'prev';
}

/** The subset of `Element` the scroll helpers read and write. */
export interface HorizontalScroller {
  scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

function maxScroll(el: HorizontalScroller): number {
  return Math.max(0, el.scrollWidth - el.clientWidth);
}

/**
 * Distance scrolled from the inline-start edge: `0` at the start, positive
 * towards the end, in both directions.
 *
 * Browsers report `scrollLeft` in RTL as `0` at the start and negative towards
 * the end (the CSSOM spec, Chromium 85+, Firefox, Safari). Older Chromium used
 * positive values counting from the far left; that form is detected (a
 * positive value in RTL) and normalized too.
 */
export function scrollStart(el: HorizontalScroller, dir: LocaleDirection): number {
  if (dir !== 'rtl') return el.scrollLeft;
  if (el.scrollLeft <= 0) return el.scrollLeft === 0 ? 0 : -el.scrollLeft;
  return maxScroll(el) - el.scrollLeft;
}

/** Set the scroll position as a distance from the inline-start edge (see {@link scrollStart}). */
export function setScrollStart(el: HorizontalScroller, offset: number, dir: LocaleDirection): void {
  const clamped = Math.min(Math.max(0, offset), maxScroll(el));
  el.scrollLeft = dir === 'rtl' ? -clamped : clamped;
}

/**
 * Inline position for an overlay (context menu) opened at a pointer
 * x-coordinate, as a CSS `inset-inline-start` value.
 *
 * Platform convention: the menu unfolds away from the pointer in the reading
 * direction (rightward in LTR, leftward in RTL). When it would not fit on that
 * side it unfolds the other way, and it is always clamped to the viewport.
 *
 * Use the result as `style={{ insetInlineStart }}`: with `<html dir="rtl">`
 * that is a distance from the right edge, which is exactly what is computed.
 */
export function anchorAtPointer(
  x: number,
  menuWidth: number,
  viewportWidth: number,
  dir: LocaleDirection,
): { insetInlineStart: number } {
  // Work in "inline" coordinates: distance of the pointer from the start edge.
  const pointer = dir === 'rtl' ? viewportWidth - x : x;
  let start = pointer;
  if (start + menuWidth > viewportWidth) start = pointer - menuWidth;
  start = Math.min(Math.max(0, start), Math.max(0, viewportWidth - menuWidth));
  return { insetInlineStart: start };
}
