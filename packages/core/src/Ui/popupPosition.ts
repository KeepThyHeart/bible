/**
 * Framework-free popup positioning, shared by the `Popover`, `HoverCard` and
 * `BottomSheet` components in `@bible/ui` and by app code that positions its
 * own popups.
 *
 * Pure function: viewport-relative numbers in, `position: fixed` numbers out.
 * It never touches the DOM, so the caller decides what "viewport" means
 * (`window.visualViewport` when available, so mobile browser chrome does not
 * skew the bounds).
 *
 * Two anchor kinds:
 * - a point (`{x, y}`, e.g. where a hover started). Defaults reproduce the
 *   desktop preview: 20px below the point, 10px above it when flipped.
 * - a rectangle (`{left, top, right, bottom}`, e.g. a link's bounding box).
 *   Defaults: 4px gap either side.
 *
 * Horizontal alignment is logical, so it is RTL-correct: `align: 'start'`
 * (default) lines the popup's inline-start edge up with the anchor's inline-start
 * edge (left in LTR, right in RTL); `'end'` the opposite; `'center'` centres.
 */

export interface PopupPoint {
  x: number;
  y: number;
}

export interface PopupRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type PopupAnchor = PopupPoint | PopupRect;

export type PopupPlacement = 'auto' | 'below' | 'above';
export type PopupAlign = 'start' | 'center' | 'end';
export type PopupDir = 'ltr' | 'rtl';

export interface PopupPositionInput {
  anchor: PopupAnchor;
  /** Desired width in px (clamped to the viewport). */
  width: number;
  /** Popup height in px (measured, or an estimate for the first paint). */
  height: number;
  viewport: { width: number; height: number };
  /** Default `'ltr'`. */
  dir?: PopupDir;
  /**
   * `'auto'` (default) sits below the anchor and flips above when the popup does not fit below.
   * `'below'` / `'above'` force a side (the height is still constrained to the space there).
   */
  placement?: PopupPlacement;
  /** Default `'start'`. */
  align?: PopupAlign;
  /** Gap between anchor and popup. Default 20 for a point anchor, 4 for a rectangle. */
  offset?: number;
  /** Minimum distance from the viewport edges. Default 16. */
  padding?: number;
}

export interface PopupPositionResult {
  /** `position: fixed` coordinates, physical (left/top). */
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  /** Which side of the anchor the popup ended up on. */
  placement: 'below' | 'above';
  /** Distance from the popup's `left` edge to the anchor's centre, clamped inside the popup (for an arrow). */
  arrowOffset: number;
}

export function isPopupRect(anchor: PopupAnchor): anchor is PopupRect {
  return 'left' in anchor && 'bottom' in anchor;
}

/** Above a point the popup sits this far from it (matches the legacy desktop preview). */
const POINT_FLIP_GAP = 10;
/** A flipped popup never shrinks below this height while there is any room. */
const MIN_FLIPPED_HEIGHT = 80;

export function computePopupPosition(input: PopupPositionInput): PopupPositionResult {
  const { anchor, viewport, height } = input;
  const dir: PopupDir = input.dir ?? 'ltr';
  const padding = input.padding ?? 16;
  const align: PopupAlign = input.align ?? 'start';
  const placementPref: PopupPlacement = input.placement ?? 'auto';

  const isRect = isPopupRect(anchor);
  const rect: PopupRect = isRect
    ? anchor
    : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };

  const belowGap = input.offset ?? (isRect ? 4 : 20);
  const aboveGap = isRect ? (input.offset ?? 4) : POINT_FLIP_GAP;

  const width = Math.min(input.width, Math.max(0, viewport.width - padding * 2));

  // Horizontal: logical alignment, then clamp.
  const rtl = dir === 'rtl';
  let rawLeft: number;
  if (align === 'center') {
    rawLeft = (rect.left + rect.right) / 2 - width / 2;
  } else if ((align === 'start') !== rtl) {
    // start in LTR, end in RTL: popup's left edge on the anchor's left edge.
    rawLeft = rect.left;
  } else {
    // start in RTL, end in LTR: popup's right edge on the anchor's right edge.
    rawLeft = rect.right - width;
  }
  const left = Math.max(padding, Math.min(rawLeft, viewport.width - width - padding));

  const desiredTop = rect.bottom + belowGap;
  const spaceBelow = viewport.height - desiredTop - padding;
  const spaceAbove = Math.max(0, rect.top - aboveGap - padding);

  const goAbove = placementPref === 'above' || (placementPref === 'auto' && spaceBelow < height);

  let top: number;
  let maxHeight: number;
  let placement: 'below' | 'above';
  if (goAbove) {
    placement = 'above';
    top = Math.max(padding, rect.top - aboveGap - height);
    maxHeight = Math.max(MIN_FLIPPED_HEIGHT, Math.min(height, spaceAbove));
  } else {
    placement = 'below';
    top = Math.max(padding, desiredTop);
    maxHeight = spaceBelow;
  }

  const centre = (rect.left + rect.right) / 2;
  const arrowOffset = Math.max(12, Math.min(centre - left, width - 12));

  return { left, top, width, maxHeight, placement, arrowOffset };
}
