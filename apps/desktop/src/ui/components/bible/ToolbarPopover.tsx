import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
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

interface Placement {
  top: number;
  left?: number;
  right?: number;
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
  const [placement, setPlacement] = useState<Placement | null>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // 4px gap, matching the `mt-1` these menus used when they were inline.
    const top = rect.bottom + 4;
    setPlacement(
      align === 'end'
        // Pinning the trailing edge keeps a menu on the right of the toolbar
        // from running off the window when its content is wide.
        ? { top, right: Math.max(0, window.innerWidth - rect.right) }
        : { top, left: rect.left },
    );
  }, [anchorRef, align]);

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
        left: placement.left,
        right: placement.right,
        minWidth,
        backgroundColor: 'var(--theme-surface-elevated)',
      }}
      role={role}
      aria-label={rest['aria-label']}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
    >
      {children}
    </div>,
    document.body,
  );
};

export default ToolbarPopover;
