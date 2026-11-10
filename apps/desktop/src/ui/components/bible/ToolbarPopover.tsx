import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDirection } from '@bible/ui';

/**
 * When `role` is `menu` (the default) the popover is a real menu button's menu:
 * focus moves to the first item as it opens, Up/Down/Home/End move between
 * items, and when it closes focus goes back to the button that opened it
 * (Escape and outside-click dismissal stay with the owner's
 * `useOverlayDismissal`).
 *
 * A menu anchored to a Bible-toolbar button but rendered into `<body>`.
 *
 * The toolbar clips its own overflow so the control band never spills out of a
 * narrow pane. That clip also swallowed every absolutely-positioned menu inside
 * it: the navigation-history dropdown was mounted and focusable but painted
 * outside the ~33px-tall clip rectangle, so the button looked completely
 * dead. Portalling the menu to `<body>` and
 * positioning it from the anchor's rect keeps the clip where it is useful (the
 * toolbar) while letting the menus escape it.
 *
 * Position is `fixed`, measured when the menu opens. The toolbar does not move
 * while a menu is open - dockview resizes are a drag on the pane border, which
 * takes the pointer away from the menu and closes it - so a single measurement
 * is enough and avoids a scroll/resize listener per toolbar.
 */
export interface ToolbarPopoverProps {
  /** The button (or its wrapper) the menu should hang from. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** `start` lines the menu up with the anchor's leading edge, `end` its trailing edge. */
  align?: 'start' | 'end';
  /** Minimum width in px. The menu still grows to fit its content. */
  minWidth?: number;
  role?: string;
  'aria-label'?: string;
  onMouseLeave?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}

/** Insets are logical: `insetInlineStart` is the right edge's distance in an RTL UI. */
interface Placement {
  top: number;
  insetInlineStart?: number;
  insetInlineEnd?: number;
}

const ToolbarPopover: React.FC<ToolbarPopoverProps> = ({
  anchorRef,
  align = 'start',
  minWidth = 224,
  role = 'menu',
  onMouseLeave,
  onMouseDown,
  children,
  ...rest
}) => {
  const uiDir = useDirection();
  const rtl = uiDir === 'rtl';
  const [placement, setPlacement] = useState<Placement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isMenu = role === 'menu';
  const placed = placement !== null;

  // Menu button behaviour: take focus on open, give it back on close.
  useEffect(() => {
    if (!isMenu || !placed) return;
    const node = menuRef.current;
    if (!node) return;
    const opener = (document.activeElement as HTMLElement | null) ?? null;
    const first =
      node.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])') ??
      node.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus({ preventScroll: true });
    return () => {
      // The menu is gone, so focus that was inside it is on <body>. Focus that
      // already moved on purpose (a dialog, another control) is left alone.
      const active = document.activeElement;
      const orphaned = !active || active === document.body || node.contains(active);
      if (orphaned && opener && opener !== document.body && opener.isConnected) {
        opener.focus();
      }
    };
  }, [isMenu, placed]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!isMenu) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'),
    );
    if (items.length === 0) return;
    e.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else next = current <= 0 ? items.length - 1 : current - 1;
    items[next].focus();
  };

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // 4px gap, matching the `mt-1` these menus used when they were inline.
    const top = rect.bottom + 4;
    // Distances from the viewport's left/right edges to the anchor's edges.
    const fromLeft = rect.left;
    const fromRight = Math.max(0, window.innerWidth - rect.right);
    // The anchor's inline-start / inline-end edge, measured from the matching viewport edge.
    const anchorStart = rtl ? fromRight : fromLeft;
    const anchorEnd = rtl ? fromLeft : fromRight;
    setPlacement(
      align === 'end'
        // Pinning the trailing edge keeps a menu at the end of the toolbar
        // from running off the window when its content is wide.
        ? { top, insetInlineEnd: anchorEnd }
        : { top, insetInlineStart: anchorStart },
    );
  }, [anchorRef, align, rtl]);

  // The usual case - a menu opened by clicking a button that is already on
  // screen - measures in the layout phase so the menu never paints unplaced.
  useLayoutEffect(measure, [measure]);

  // ...but React attaches a host element's ref *after* its children's layout
  // effects have run, so a popover that mounts in the same commit as its anchor
  // (a toolbar rendered with the menu already open) sees a null ref above. The
  // passive pass runs once the whole commit is done, by which time the anchor
  // exists.
  useEffect(() => {
    if (placement === null) measure();
  }, [placement, measure]);

  if (placement === null) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed border border-border rounded shadow-lg z-50 py-1"
      style={{
        top: placement.top,
        insetInlineStart: placement.insetInlineStart,
        insetInlineEnd: placement.insetInlineEnd,
        minWidth,
        // B-130: a long list (hundreds of bookmarks) scrolls inside the window.
        maxHeight: Math.max(120, window.innerHeight - placement.top - 8),
        overflowY: 'auto',
        backgroundColor: 'var(--theme-surface-elevated)',
      }}
      ref={menuRef}
      role={role}
      aria-label={rest['aria-label']}
      onKeyDown={onKeyDown}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
    >
      {children}
    </div>,
    document.body,
  );
};

export default ToolbarPopover;
