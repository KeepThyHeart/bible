/**
 * Eased horizontal scrolling for a pane's tab strip (`.dv-tabs-container`).
 *
 * dockview scrolls the strip from its own `wheel` listener on the
 * `.dv-scrollable` wrapper by assigning `scrollLeft += deltaY` directly, so a
 * mouse wheel moved the tabs in ~100px jumps with no animation. Native
 * `scrollTo({ behavior: 'smooth' })` is no way out: dockview writes
 * `scrollLeft` back on every `scroll` event, which cancels a native smooth
 * scroll mid-flight. So the animation is done here, one `scrollLeft`
 * assignment per frame; dockview's write-back then sees the value it already
 * has.
 *
 * It also holds the strip still while a tab is pressed. dockview activates a
 * tab on pointerdown, and when the tab is partly clipped it snaps `scrollLeft`
 * so the tab starts at the strip's edge. That slid the tab out from under the
 * pointer mid-press, so dragging a clipped, inactive tab failed the first time
 * and worked the second (by then it was active and fully visible). The snap is
 * undone before paint, and the tab is eased into view on release instead.
 */

/** Share of the remaining distance covered per frame (~150ms to settle). */
const EASING = 0.25;
/** Pixels per wheel "line" when the device reports in lines (Firefox-style). */
const LINE_HEIGHT = 40;

export interface TabStripScroller {
  /** Scroll by `delta` physical pixels (positive = right), eased. */
  scrollBy(delta: number): void;
  /** Detach the wheel listener and stop any running animation. */
  dispose(): void;
}

/**
 * Attaches eased wheel scrolling to `el` and returns a scroller the chevron
 * buttons can share, so wheel and chevrons animate toward one target instead
 * of fighting each other.
 */
export function attachTabStripScroller(el: HTMLElement): TabStripScroller {
  let target: number | null = null;
  let frame = 0;

  // Chromium reports RTL scrollLeft as 0 at the start and negative toward the
  // end, so the valid range depends on direction.
  const range = (): [number, number] => {
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    return getComputedStyle(el).direction === 'rtl' ? [-max, 0] : [0, max];
  };

  const step = (): void => {
    frame = 0;
    if (target === null) return;
    const remaining = target - el.scrollLeft;
    if (Math.abs(remaining) < 1) {
      el.scrollLeft = target;
      target = null;
      return;
    }
    const before = el.scrollLeft;
    el.scrollLeft = before + remaining * EASING;
    // Stuck (layout changed under us, or sub-pixel rounding): stop rather
    // than spin forever.
    if (el.scrollLeft === before) {
      target = null;
      return;
    }
    frame = requestAnimationFrame(step);
  };

  const scrollBy = (delta: number): void => {
    const [min, max] = range();
    const from = target ?? el.scrollLeft;
    target = Math.min(max, Math.max(min, from + delta));
    if (!frame) frame = requestAnimationFrame(step);
  };

  const onWheel = (event: WheelEvent): void => {
    // Horizontal gestures (trackpad swipe, tilt wheel) scroll natively.
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
      event.stopPropagation();
      return;
    }
    const unit = event.deltaMode === 1 ? LINE_HEIGHT : event.deltaMode === 2 ? el.clientWidth : 1;
    const delta = event.deltaY * unit;
    const [min, max] = range();
    if (min === max) return;
    // Keep dockview's instant jump from also applying, and the pane body from
    // scrolling vertically underneath.
    event.preventDefault();
    event.stopPropagation();
    // Wheel down / away moves toward the end of the strip, which is leftward
    // in RTL.
    scrollBy(getComputedStyle(el).direction === 'rtl' ? -delta : delta);
  };

  // Capture runs before dockview's pointerdown on the tab; bubble runs after
  // it, once any snap has been applied, and puts the old offset back.
  let pressedTab: HTMLElement | null = null;
  let scrollAtPress = 0;
  const onPointerDownCapture = (event: PointerEvent): void => {
    pressedTab = (event.target as Element | null)?.closest<HTMLElement>('.dv-tab') ?? null;
    scrollAtPress = el.scrollLeft;
  };
  const onPointerDown = (): void => {
    if (pressedTab && el.scrollLeft !== scrollAtPress) el.scrollLeft = scrollAtPress;
  };
  const onRelease = (): void => {
    const tab = pressedTab;
    pressedTab = null;
    if (!tab?.isConnected) return;
    const strip = el.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    if (rect.left < strip.left) scrollBy(rect.left - strip.left);
    else if (rect.right > strip.right) scrollBy(Math.min(rect.right - strip.right, rect.left - strip.left));
  };
  // A drag that starts from the press is not a click; leave the strip alone.
  const onDragStart = (): void => {
    pressedTab = null;
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onPointerDownCapture, true);
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('dragstart', onDragStart);
  window.addEventListener('pointerup', onRelease);

  return {
    scrollBy,
    dispose: () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDownCapture, true);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('pointerup', onRelease);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      target = null;
    },
  };
}
