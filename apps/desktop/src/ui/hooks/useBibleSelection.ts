import { useCallback, useEffect, useRef } from 'react';
import { expandSelectionToWordBoundaries } from '../utils/selectionUtils';

/**
 * How long after a mouseup the selection is given to settle before it is
 * normalised and the floating toolbar is measured. Chromium finishes the
 * gesture's own selection work in the same task as the mouseup, so this is a
 * settle window rather than a guess at how long the browser needs.
 */
const SELECTION_SETTLE_MS = 50;

/**
 * Owns the "the user has finished selecting text" moment in the Bible pane.
 *
 * Two rules, both needed to keep the drag from going janky:
 *
 * 1. **Nothing touches the selection while a button is down.**
 *    `expandSelectionToWordBoundaries` calls `setBaseAndExtent`. Doing that in
 *    the middle of a drag replaces the selection Chromium is actively
 *    extending, and Chromium keeps extending from *its* remembered anchor
 *    rather than the new one - the visible result is the selection suddenly
 *    blowing out to the end of the block (the "it selected the rest of the
 *    chapter" report), and the re-render that follows is the freeze that comes
 *    with it. A `dblclick` handler on the scroll container that scheduled the
 *    expansion on a 0ms timer would open a second way into this, beyond the
 *    mouseup path below firing for the first mouseup of a double click (a
 *    double-click followed by a drag lands the timer mid-drag) - which is why
 *    that handler is gone entirely rather than guarded: a double click ends
 *    in a mouseup, so the path below already covers it.
 *
 * 2. **A new gesture cancels the previous gesture's pending work.**
 *    Scheduling the toolbar 50ms after every mouseup with nothing to stop it
 *    would let pressing down again inside that window pop the toolbar up over
 *    a drag that had only just started - "it shows up before I'm done
 *    selecting".
 */
export function useBibleSelection(
  showFloatingToolbar: () => void,
) {
  const pendingRef = useRef<number | null>(null);
  const pointerDownRef = useRef(false);
  /** Which button started the gesture; only the primary one selects text. */
  const gestureButtonRef = useRef(0);

  const cancelPending = useCallback(() => {
    if (pendingRef.current !== null) {
      window.clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Capture phase on `document`, so this runs before React's own handler for
    // the same event and before any component can act on it.
    const onPointerDown = (event: MouseEvent) => {
      gestureButtonRef.current = event.button;
      if (event.button === 0) pointerDownRef.current = true;
      cancelPending();
    };
    const onPointerUp = () => {
      pointerDownRef.current = false;
    };

    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('mouseup', onPointerUp, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('mouseup', onPointerUp, true);
      cancelPending();
    };
  }, [cancelPending]);

  /**
   * Mouseup on the Bible text: the gesture is over, so normalise the selection
   * to whole words and offer the toolbar.
   */
  const handleMouseUpWithToolbar = useCallback(() => {
    // A right-click's mouseup is not a selection gesture; letting it through
    // popped the annotation toolbar up alongside the context menu.
    if (gestureButtonRef.current !== 0) return;

    cancelPending();
    pendingRef.current = window.setTimeout(() => {
      pendingRef.current = null;
      // Belt and braces: a button pressed again during the settle window
      // already cancelled this timer, but never mutate a live drag.
      if (pointerDownRef.current) return;
      expandSelectionToWordBoundaries();
      showFloatingToolbar();
    }, SELECTION_SETTLE_MS);
  }, [cancelPending, showFloatingToolbar]);

  return {
    handleMouseUpWithToolbar,
  };
}
