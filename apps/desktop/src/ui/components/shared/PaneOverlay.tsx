import React from 'react';
import { createPortal } from 'react-dom';

/**
 * A full-window modal backdrop for a dialog opened from inside a dockview pane.
 *
 * A bare `fixed inset-0 ... z-50` rendered where it sits in the tree loses to
 * the pane splitter every time. Dockview's `.dv-dockview` sets
 * `contain: layout`, which makes it both a stacking context and the
 * containing block for `position: fixed` descendants - so a dialog inside a
 * pane never reaches the document at all. Its `z-index: 50` then competes
 * with the splitter's own `.dv-sash { z-index: 99 }` *inside that same
 * context*, and 99 wins: the drag handle paints over an open dialog and
 * lights up on hover through it.
 *
 * Portalling to `<body>` is the fix - the same one `bible/ToolbarPopover` uses
 * for the toolbar menus. Outside `.dv-dockview` there is no sash to lose to, so
 * an ordinary modal z-index is enough again.
 */

export interface PaneOverlayProps {
  /** Clicking the backdrop, and Escape from within, dismiss the dialog. */
  onDismiss: () => void;
  /** The dialog box. Its own click handler should stop propagation. */
  children: React.ReactNode;
  testId?: string;
}

/**
 * Above dockview's sash (99) and its floating groups, below the tab context
 * menus that deliberately sit at 10000.
 */
const OVERLAY_Z_INDEX = 500;

export const PaneOverlay: React.FC<PaneOverlayProps> = ({ onDismiss, children, testId }) => {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-background-overlay flex items-center justify-center"
      style={{ zIndex: OVERLAY_Z_INDEX }}
      onClick={onDismiss}
      data-testid={testId}
    >
      {children}
    </div>,
    document.body,
  );
};

export default PaneOverlay;
