/**
 * Positioning helpers for overlays anchored to a pointer coordinate.
 *
 * Absolutely-positioned overlays that anchor to an *element* should use
 * Tailwind's logical inset utilities (`start-0`, `end-2`, ...) and need nothing
 * from this file. Overlays anchored to a raw `clientX` - context menus opened
 * from a right-click - cannot: the coordinate is a physical viewport offset,
 * so the flip has to be computed.
 *
 * Convention followed here is the platform one: a context menu unfolds AWAY
 * from the pointer in the reading direction. LTR menus grow rightward from the
 * click; RTL menus grow leftward.
 *
 * Direction is read from `document.documentElement.dir` rather than a React
 * hook on purpose - these menus mount fresh on every open, and the callers are
 * plain style objects rather than components with i18n context.
 */

import type React from 'react';

/** Writing direction currently applied to the document. */
export function isDocumentRtl(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('dir') === 'rtl';
}

/**
 * Inline style pinning an overlay's leading edge to viewport x-coordinate `x`.
 *
 * In LTR this is `{ left: x }`, identical to what the call sites did before. In
 * RTL it becomes `{ right: viewportWidth - x }`, which anchors the menu's right
 * edge at the pointer so it opens leftwards.
 */
export function anchorAtPointerX(x: number): React.CSSProperties {
  if (!isDocumentRtl() || typeof window === 'undefined') return { left: x };
  return { right: Math.max(0, window.innerWidth - x) };
}
