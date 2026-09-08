/**
 * AdvancedPaneManagerGate.ts (KAN QA 4.5)
 *
 * Dragging a pane (moving/splitting/re-docking) is an "advanced" layout
 * operation the user has to opt into. While `advancedPaneManagerEnabled` is
 * off, a drag must be stopped before it visibly starts, and the user shown a
 * modal explaining what Advanced mode is and that the Layout button can
 * always restore the default arrangement instead.
 *
 * dockview offers three cancelable hooks for this:
 *   - `onWillDragPanel` / `onWillDragGroup` - fire *before* the drag begins.
 *     Cancel via `event.nativeEvent.preventDefault()`. Preferred: the user
 *     never sees a drag start at all, which reads better than starting a drag
 *     and then rejecting the drop.
 *   - `onWillDrop` - fires just before a drop completes. Cancel via
 *     `event.preventDefault()`. Kept as a backstop in case some drag path
 *     doesn't route through the will-drag events (see DockviewLayout.tsx).
 *
 * The three event shapes cancel differently, so the gate itself is factored
 * as a small pure decision (`shouldGateDrag`) plus a thin wrapper
 * (`gateDragEvent`) that takes the caller's own cancel function - that keeps
 * the interesting logic (should we intercept at all?) independent of which
 * dockview event triggered it, and trivially unit-testable without a real
 * DragEvent.
 *
 * MOVEMENT THRESHOLD. dockview owns the native drag, so without a threshold of
 * its own the gate would rely only on the browser's (a couple of pixels) - a
 * twitch while clicking a tab would throw the modal in the user's face.
 * `exceedsDragThreshold`
 * adds a real one, measured from the pointerdown position DockviewLayout
 * records on the workbench container. Below it the drag is still canceled, just
 * silently; DockviewLayout then keeps watching pointermove (which continues to
 * fire precisely *because* the native drag was canceled) and raises the dialog
 * if the gesture grows into a genuine drag.
 */

/** Whether a drag-and-drop pane operation should be intercepted right now. */
export function shouldGateDrag(advancedPaneManagerEnabled: boolean): boolean {
  return !advancedPaneManagerEnabled;
}

/** A pointer position, in client coordinates. */
export interface DragPoint {
  x: number;
  y: number;
}

/**
 * How far the pointer must travel from where it went down before a gated drag
 * is worth interrupting the user over.
 *
 * Without it, the gate is a pure boolean, so the only threshold in play would
 * be the browser's own native HTML5 drag threshold (a few pixels) - a nudge
 * while clicking a tab would pop the modal. Roughly matches the drag
 * thresholds used by other UI toolkits (5-10px).
 */
export const DRAG_GATE_THRESHOLD_PX = 8;

/**
 * Has the pointer moved far enough from `origin` to read as a deliberate drag?
 *
 * Straight-line (Euclidean) distance, so a diagonal nudge is not counted twice.
 * Strictly greater than the threshold: a movement of exactly `thresholdPx` is
 * still "not yet a drag", which keeps the boundary unambiguous.
 *
 * `origin === null` means no pointerdown was observed for this gesture (a
 * synthetic drag, or one that began outside the dockview container). There is
 * then no distance to measure, so it reports `false` - the drag is still
 * blocked by the caller, just without a modal the user cannot connect to
 * anything they did.
 */
export function exceedsDragThreshold(
  origin: DragPoint | null,
  current: DragPoint,
  thresholdPx: number = DRAG_GATE_THRESHOLD_PX,
): boolean {
  if (!origin) return false;
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  return Math.sqrt(dx * dx + dy * dy) > thresholdPx;
}

/**
 * Optional movement test for `gateDragEvent`. When supplied, the drag is still
 * canceled below the threshold - it is only the *dialog* that waits.
 */
export interface DragThresholdCheck {
  /** Where the pointer went down, or `null` if that was never seen. */
  origin: DragPoint | null;
  /** Where the pointer is now (the drag event's own client coordinates). */
  current: DragPoint;
  /** Defaults to `DRAG_GATE_THRESHOLD_PX`. */
  thresholdPx?: number;
}

/**
 * Apply the gate to a single dockview drag/drop event.
 *
 * @param advancedPaneManagerEnabled Current value of the preference.
 * @param cancel Cancels the underlying dockview event (its own
 *   `preventDefault` shape differs per event type - see the doc comment above).
 * @param onGated Called when the drag was intercepted, e.g. to open the
 *   opt-in modal. Not called when the drag is allowed through, nor when
 *   `threshold` is supplied and the pointer has not moved far enough yet.
 * @param threshold Optional movement test (see `DragThresholdCheck`). Omitted,
 *   the gate behaves exactly as it always has: intercept and report.
 * @returns `true` if the event was intercepted, `false` if it was left alone.
 *   Note this is independent of whether `onGated` ran - a sub-threshold drag is
 *   still intercepted, just silently.
 */
export function gateDragEvent(
  advancedPaneManagerEnabled: boolean,
  cancel: () => void,
  onGated: () => void,
  threshold?: DragThresholdCheck,
): boolean {
  if (!shouldGateDrag(advancedPaneManagerEnabled)) return false;
  cancel();
  if (!threshold || exceedsDragThreshold(threshold.origin, threshold.current, threshold.thresholdPx)) {
    onGated();
  }
  return true;
}
