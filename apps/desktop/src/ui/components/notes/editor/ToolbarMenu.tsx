import React, { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * A toolbar dropdown (highlight swatches, text colours, list styles, table
 * operations) that is guaranteed to stay inside the visible window.
 *
 * Plain `absolute top-full start-0 | end-0` children of the trigger's
 * `relative` wrapper fail in two separate ways once the notes pane is narrow
 * or docked against an edge:
 *
 * 1. `end-0` right-aligns the panel with the trigger, so the swatches grow
 *    *leftwards*. With the colour button near the start of a wrapped toolbar
 *    row in a narrow pane, most of the palette renders at a negative offset -
 *    hence reports like "the palette extends past the left of the panel and
 *    I can't see most of the colours".
 * 2. An `absolute` popup is still laid out inside the pane, so it is clipped by
 *    any scrolling/overflow-hidden ancestor even when it does have room on
 *    screen.
 *
 * `position: fixed` escapes the pane's clipping, and the trigger's own
 * `getBoundingClientRect()` plus a clamp against the visual viewport keeps the
 * panel on screen on every side - start-aligned with the trigger when it fits,
 * pushed back inside when it does not, and flipped above the trigger when
 * there is no room below.
 *
 * The measure-then-place pass runs in `useLayoutEffect` (before paint, so no
 * flash) and the panel is rendered `visibility: hidden` until it has been
 * placed, so the first *visible* paint is already in the right spot. The
 * natural width has to be measured rather than declared because these menus
 * size to their content, which is localized text.
 */

/** Gap between the trigger and the panel. Small enough that the pointer can cross it. */
const GAP = 4;
/** Minimum distance kept from every viewport edge. */
const EDGE_PADDING = 8;

export interface ToolbarMenuProps {
  /** Whether the panel is open. */
  open: boolean;
  /** The trigger button. Rendered inside the anchor wrapper. */
  trigger: React.ReactNode;
  /** Accessible name for the popup's `role="menu"`. */
  label: string;
  /** Called when the pointer leaves the panel (the existing dismissal behaviour). */
  onMouseLeave?: () => void;
  /** Extra classes for the panel, e.g. `flex gap-1` or `py-1 min-w-[140px]`. */
  panelClassName?: string;
  children: React.ReactNode;
}

function computeStyle(anchor: DOMRect, panel: DOMRect): CSSProperties {
  const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
  const viewportWidth = vv ? vv.width : window.innerWidth;
  const viewportHeight = vv ? vv.height : window.innerHeight;

  const maxWidth = Math.max(0, viewportWidth - EDGE_PADDING * 2);
  const width = Math.min(panel.width, maxWidth);
  const left = Math.max(EDGE_PADDING, Math.min(anchor.left, viewportWidth - width - EDGE_PADDING));

  const below = anchor.bottom + GAP;
  const fitsBelow = below + panel.height + EDGE_PADDING <= viewportHeight;
  const top = fitsBelow
    ? below
    : Math.max(EDGE_PADDING, anchor.top - GAP - panel.height);

  return { position: 'fixed', top, left, maxWidth, visibility: 'visible' };
}

/** Off-screen-but-measurable starting point, before the panel has been placed. */
const HIDDEN_STYLE: CSSProperties = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };

const ToolbarMenu: React.FC<ToolbarMenuProps> = ({
  open,
  trigger,
  label,
  onMouseLeave,
  panelClassName = '',
  children,
}) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(HIDDEN_STYLE);

  useLayoutEffect(() => {
    if (!open) {
      // Reset so the next open measures its natural size again rather than
      // reusing the previous trigger's placement.
      setStyle(HIDDEN_STYLE);
      return;
    }
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    // Measure the trigger itself, not the wrapper. The wrapper is a flex child
    // and picks up whatever height the row gives it, so anchoring to it opened
    // the panel a row-height below the button that spawned it - the reported
    // "the menu is too low, it's not beside the button".
    const triggerRect = anchor.firstElementChild?.getBoundingClientRect() ?? anchor.getBoundingClientRect();
    setStyle(computeStyle(triggerRect, panel.getBoundingClientRect()));
    // Placement depends only on the open transition: the panel's contents are
    // static for as long as it is open, and re-running on every render would
    // loop through its own setState.
  }, [open]);

  return (
    <div className="relative" ref={anchorRef}>
      {trigger}
      {open && (
        <div
          ref={panelRef}
          style={style}
          className={`bg-surface-elevated border border-border rounded shadow-lg z-50 ${panelClassName}`}
          onMouseLeave={onMouseLeave}
          role="menu"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default ToolbarMenu;
