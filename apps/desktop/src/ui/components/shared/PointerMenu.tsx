import React, { forwardRef, useCallback, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { anchorAtPointer } from '@bible/core/browser';
import { useDirection } from '@bible/ui';
import { PopupPortal } from '../../hooks/usePopupPosition';

type Dir = 'ltr' | 'rtl';

/**
 * Where a menu opened at pointer (x, y) goes so all of it is in the window:
 * it unfolds away from the pointer in the reading direction, flips to the
 * other side when there is no room, and opens upward from the pointer when
 * there is no room below (pinned to the bottom edge when there is no room
 * above either).
 */
export function placePointerMenu(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  dir: Dir,
  pad: number,
): { top: number; insetInlineStart: number } {
  const { insetInlineStart } = anchorAtPointer(x, width, viewportWidth, dir, pad);
  let top = y;
  if (y + height > viewportHeight - pad) {
    top = y - height >= pad ? y - height : viewportHeight - height - pad;
  }
  return { top: Math.max(pad, top), insetInlineStart };
}

export interface PointerMenuProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'style'> {
  /** Pointer position (clientX / clientY) the menu opens at. */
  x: number;
  y: number;
  /** Width assumed for the first layout, before the menu is measured. Default 180. */
  estimatedWidth?: number;
  /** Smallest gap to the window edges. Default 8. */
  edgePadding?: number;
  /** Default 10000: above dock panes, headers and their popups. */
  zIndex?: number;
  /** Visual styles only; the position is the menu's own. */
  style?: CSSProperties;
}

/**
 * The one container for menus opened at the pointer (right-click menus).
 *
 * - Rendered into `document.body`. Inside a dock pane, `position: fixed` is
 *   relative to the pane rather than the window (dockview sets
 *   `contain: layout`; see {@link PopupPortal}), so a menu declared in a pane
 *   showed up offset from the pointer.
 * - Measured before paint and re-measured when its size changes (items that
 *   arrive late, sections that expand), so it never runs off an edge.
 * - A menu taller than the window scrolls; any other menu does not, so
 *   flyouts inside it are not clipped.
 *
 * React events still bubble to the component that rendered it, so handlers on
 * its ancestors (click-to-close, stopPropagation) keep working.
 */
export const PointerMenu = forwardRef<HTMLDivElement, PointerMenuProps>(function PointerMenu(
  { x, y, estimatedWidth = 180, edgePadding = 8, zIndex = 10000, style, children, ...rest },
  forwardedRef,
) {
  const dir = useDirection() as Dir;
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const place = () => {
      const rect = node.getBoundingClientRect();
      const { top, insetInlineStart } = placePointerMenu(
        x, y, rect.width, rect.height, window.innerWidth, window.innerHeight, dir, edgePadding,
      );
      node.style.top = `${top}px`;
      node.style.insetInlineStart = `${insetInlineStart}px`;
      node.style.overflowY = node.scrollHeight > node.clientHeight + 1 ? 'auto' : 'visible';
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(place);
    observer.observe(node);
    return () => observer.disconnect();
  }, [x, y, dir, edgePadding]);

  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  return (
    <PopupPortal>
      <div
        ref={setRef}
        {...rest}
        style={{
          ...style,
          position: 'fixed',
          top: y,
          insetInlineStart: anchorAtPointer(x, estimatedWidth, viewportWidth, dir, edgePadding).insetInlineStart,
          zIndex,
          maxHeight: `calc(100vh - ${edgePadding * 2}px)`,
        }}
      >
        {children}
      </div>
    </PopupPortal>
  );
});

export default PointerMenu;
