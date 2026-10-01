import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { computePopupPosition } from '@bible/core/browser';
import type { PopupAlign, PopupAnchor, PopupDir, PopupPlacement } from '@bible/core/browser';
import { documentDir, getViewportSize, useEscape, useFocusScope, useOutsidePress, useViewportTick } from './popupUtils';

export interface PopoverProps {
  open: boolean;
  /** Viewport-relative point (a hover position) or rectangle (an element's `getBoundingClientRect()`). No anchor renders nothing. */
  anchor: PopupAnchor | null;
  /** Called on Escape, an outside press and a backdrop click. Omit for a popup its owner dismisses itself. */
  onClose?: () => void;
  /** Desired width in px (clamped to the viewport). Default 380. */
  width?: number;
  /** Height used for the very first paint, refined once the content is measured. Default 220. */
  estimatedHeight?: number;
  /** `'auto'` (default): below the anchor, above when it does not fit. */
  placement?: PopupPlacement;
  /** Logical alignment to the anchor: `'start'` (default), `'center'`, `'end'`. */
  align?: PopupAlign;
  /** Gap to the anchor in px (default 20 for a point, 4 for a rectangle). */
  offset?: number;
  /** Upper bound for the popup height in px (it also never exceeds the room on its side of the anchor). */
  maxHeight?: number;
  /** Minimum distance from the viewport edges. Default 16. */
  padding?: number;
  /** Reading direction; default the document's. Positioning mirrors in RTL. */
  dir?: PopupDir;
  /** `'dialog'` (default), `'tooltip'` for a non-interactive hover preview, or `'group'`. */
  role?: 'dialog' | 'tooltip' | 'group';
  /** Accessible name (no visible title) or the id of the element that titles the popup. */
  label?: string;
  labelledBy?: string;
  id?: string;
  /** Escape closes. Default true. */
  closeOnEscape?: boolean;
  /** A mouse or touch press outside closes. Default true. */
  closeOnOutsidePress?: boolean;
  /** Extra elements that count as "inside" for outside presses (e.g. a hover trigger). */
  insideRefs?: Array<{ current: Element | null }>;
  /** Render a full-screen click-catcher behind the popup that closes it (modal-ish popups). */
  backdrop?: boolean;
  /** Extra class for the backdrop element. */
  backdropClassName?: string;
  /** Move focus into the popup on open and back to where it was on close. Default false (hover previews). */
  autoFocus?: boolean;
  /** Render into `document.body` (default true). Needed to escape `contain: layout` ancestors such as dockview panes. */
  portal?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Hoverable: keep the popup open while the pointer is on it. */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: ReactNode;
}

/** A measured height only replaces the estimate when it differs by more than this. */
const REFINE_THRESHOLD_PX = 24;

/**
 * An anchored popup: positions itself beside a point or rectangle (below, flipping above; RTL-aware),
 * stays inside the viewport, and is dismissible (Escape, outside press, optional backdrop).
 * Position is computed during render from an estimated height, so the first paint is already in place,
 * then refined after the content is measured.
 */
export function Popover(props: PopoverProps) {
  const {
    open, anchor, onClose, width = 380, estimatedHeight = 220, placement, align, offset, padding, maxHeight, dir,
    role = 'dialog', label, labelledBy, id, closeOnEscape = true, closeOnOutsidePress = true, insideRefs,
    backdrop = false, backdropClassName, autoFocus = false, portal = true, className, style,
    onMouseEnter, onMouseLeave, children,
  } = props;

  const ref = useRef<HTMLDivElement>(null);
  const visible = open && anchor !== null;
  const tick = useViewportTick(visible);
  const anchorKey = anchor ? JSON.stringify(anchor) : '';
  const [measured, setMeasured] = useState<{ key: string; height: number } | null>(null);
  const measuredHeight = measured && measured.key === anchorKey ? measured.height : null;
  const height = measuredHeight ?? estimatedHeight;
  const effectiveDir = dir ?? documentDir();

  const position = useMemo(() => {
    if (!anchor) return null;
    return computePopupPosition({
      anchor, width, height, viewport: getViewportSize(), dir: effectiveDir, placement, align, offset, padding,
    });
  }, [anchorKey, width, height, effectiveDir, placement, align, offset, padding, tick]);

  // Refine after every render: content (a verse, a definition) can finish loading without the anchor moving.
  // `scrollHeight` is the full content height even while maxHeight clips it. Zero means "no layout" (jsdom).
  useLayoutEffect(() => {
    if (!visible || !ref.current) return;
    const actual = ref.current.scrollHeight;
    if (actual > 0 && Math.abs(actual - height) > REFINE_THRESHOLD_PX) setMeasured({ key: anchorKey, height: actual });
  });

  useEscape(visible && closeOnEscape, onClose);
  useOutsidePress(visible && closeOnOutsidePress && !backdrop, [ref, ...(insideRefs ?? [])], onClose);
  useFocusScope(visible && autoFocus, ref);

  if (!visible || !position) return null;

  const popover = (
    <div
      ref={ref}
      id={id}
      role={role}
      aria-label={label}
      aria-labelledby={labelledBy}
      dir={dir}
      tabIndex={autoFocus ? -1 : undefined}
      className={className ? `kth-popover ${className}` : 'kth-popover'}
      data-placement={position.placement}
      style={{
        position: 'fixed',
        // computePopupPosition() returns a physical viewport rect (it already mirrors for RTL itself).
        // eslint-disable-next-line no-restricted-syntax -- rtl-physical: anchored to a measured rect
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: maxHeight === undefined ? position.maxHeight : Math.min(position.maxHeight, maxHeight),
        overflowY: 'auto',
        ['--kth-popover-arrow-offset' as string]: `${position.arrowOffset}px`,
        ...style,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );

  const content = (
    <>
      {backdrop && (
        <div
          className={backdropClassName ? `kth-popover-backdrop ${backdropClassName}` : 'kth-popover-backdrop'}
          onClick={closeOnOutsidePress ? onClose : undefined}
          aria-hidden="true"
        />
      )}
      {popover}
    </>
  );

  if (portal && typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}
