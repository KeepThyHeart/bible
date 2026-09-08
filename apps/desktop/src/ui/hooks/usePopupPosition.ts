import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * The one shared positioning hook for desktop's hover popups (verse-reference
 * preview, Strong's definition preview). Replaces four hand-rolled copies of
 * "render at the raw position, then measure `getBoundingClientRect()` after
 * paint and imperatively overwrite left/top" - that pattern always paints
 * once in the wrong place first, producing a visible flash-and-jump.
 *
 * Ported from web's known-good approach (`apps/web/src/hooks/useVersePopup.tsx`
 * `getPopupStyle`, apps/web/src/hooks/useViewportPosition.ts): compute the
 * position SYNCHRONOUSLY during render using an estimated height, so the very
 * first paint already lands in the right place. `window.visualViewport` is
 * used when available so mobile/scaled browser chrome doesn't skew the
 * viewport bounds. Width is clamped to the viewport. When there isn't room
 * below the trigger point, the popup flips to sit above it with a computed
 * `maxHeight` - constraining the popup's height to the space actually
 * available, not just moving it and hoping.
 *
 * A post-mount measurement pass refines the estimate ONLY when the popup's
 * true content height (`scrollHeight`, which reflects the full content size
 * even while `overflow`/`maxHeight` clip it - using `getBoundingClientRect()`
 * here would just measure the clipped box and could oscillate) differs
 * materially from what was used to compute the current layout. This corrects
 * a bad estimate (e.g. a long Strong's definition, or a multi-verse range)
 * without reintroducing a visible jump for the common case where the
 * estimate was already close.
 */
/**
 * Renders a popup into `document.body`, out of whatever pane it was declared in.
 *
 * Required for anything positioned by {@link usePopupPosition}, because that
 * hook's coordinates are viewport-relative (`clientX`/`clientY`) and its style
 * is `position: fixed` - which only means "relative to the viewport" while no
 * ancestor establishes a containing block.
 *
 * Dockview's own stylesheet does establish one: `.dv-dockview { contain: layout }`.
 * CSS containment makes a `contain: layout` element the containing block for
 * fixed-position descendants, so a popup rendered inside any dock pane is
 * displaced by the dock grid's origin. Measured here: a probe at `top: 0`
 * inside the Study pane painted at y = 100, the exact height of the chrome
 * above the grid - a constant offset on every popup in every pane, which is why
 * it reads as systemic rather than as a positioning miscalculation.
 *
 * A portal to `document.body` leaves that subtree, so `fixed` resolves against
 * the viewport again and the hook's existing arithmetic lands where it always
 * intended to. Nothing else about the popup changes.
 *
 * Renders nothing during SSR/tests where `document` is unavailable.
 */
export const PopupPortal: React.FC<{ children: ReactNode }> = ({ children }) => {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
};

export interface PopupPositionInput {
  /** Trigger point, e.g. the mouse position where the hover started. */
  x: number;
  y: number;
}

export interface PopupPositionOptions {
  /** Desired popup width in px (clamped to the viewport). */
  width: number;
  /** Estimated popup height in px, used for the synchronous first paint. */
  estimatedHeight: number;
  /** Vertical offset from the trigger point to the top of the popup. Default 20. */
  offsetY?: number;
  /** Minimum distance from viewport edges. Default 16. */
  padding?: number;
}

export interface PopupPositionResult {
  /** Attach to the popup's root element. */
  ref: RefObject<HTMLDivElement>;
  /** Spread onto the popup's root element's `style`. */
  style: CSSProperties;
}

/** Minimum px difference between the estimate and the measured content height worth re-flowing for. */
const REFINE_THRESHOLD_PX = 24;

function computeStyle(
  position: PopupPositionInput,
  height: number,
  width: number,
  offsetY: number,
  padding: number,
): CSSProperties {
  const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
  const viewportWidth = vv ? vv.width : window.innerWidth;
  const viewportHeight = vv ? vv.height : window.innerHeight;

  const clampedWidth = Math.min(width, Math.max(0, viewportWidth - padding * 2));
  const left = Math.max(padding, Math.min(position.x, viewportWidth - clampedWidth - padding));

  const desiredTop = position.y + offsetY;
  const spaceBelow = viewportHeight - desiredTop - padding;

  const style: CSSProperties = {
    position: 'fixed',
    left,
    width: clampedWidth,
    overflowY: 'auto',
  };

  if (spaceBelow < height) {
    // Not enough room below - flip to sit above the trigger point, and
    // constrain height to whatever space is actually available above it
    // rather than letting the popup run off the top of the screen.
    const spaceAbove = Math.max(0, position.y - padding - 10);
    style.top = Math.max(padding, position.y - height - 10);
    style.maxHeight = Math.max(80, Math.min(height, spaceAbove));
  } else {
    style.top = Math.max(padding, desiredTop);
    style.maxHeight = spaceBelow;
  }

  return style;
}

export function usePopupPosition(
  position: PopupPositionInput,
  options: PopupPositionOptions,
): PopupPositionResult {
  const ref = useRef<HTMLDivElement>(null);
  const width = options.width;
  const estimatedHeight = options.estimatedHeight;
  const offsetY = options.offsetY ?? 20;
  const padding = options.padding ?? 16;

  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  // Tracks the trigger point as of the last render, using state (not a ref)
  // so this "derive state from a changed prop" bailout follows React's
  // documented pattern (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // and survives abandoned/concurrent render passes.
  const [prevTrigger, setPrevTrigger] = useState({ x: position.x, y: position.y });

  // A new trigger point means a new hover target: forget any refinement made
  // for the previous popup content rather than reusing a stale measurement.
  if (prevTrigger.x !== position.x || prevTrigger.y !== position.y) {
    setPrevTrigger({ x: position.x, y: position.y });
    if (measuredHeight !== null) {
      setMeasuredHeight(null);
    }
  }

  const effectiveHeight = measuredHeight ?? estimatedHeight;

  const style = useMemo(
    () => computeStyle(position, effectiveHeight, width, offsetY, padding),
    [position.x, position.y, effectiveHeight, width, offsetY, padding],
  );

  // Runs after every render (content - e.g. verse text or a Strong's
  // definition - can finish loading without the trigger point moving).
  // Cheap: reading `scrollHeight` on a small popup element.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const actual = ref.current.scrollHeight;
    // A zero measurement means the element has no real layout yet (e.g. not
    // painted, `display: none`, or a non-layout test environment like jsdom)
    // rather than a genuinely empty popup - trusting it would collapse the
    // estimate to 0 and make positioning worse, not better.
    if (actual > 0 && Math.abs(actual - effectiveHeight) > REFINE_THRESHOLD_PX) {
      setMeasuredHeight(actual);
    }
  });

  return { ref, style };
}
