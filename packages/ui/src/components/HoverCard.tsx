import { useCallback, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { PopupAlign, PopupAnchor, PopupDir, PopupPlacement, PopupRect } from '@bible/core/browser';
import { BottomSheet } from './BottomSheet';
import type { BottomSheetLabels } from './BottomSheet';
import { Popover } from './Popover';
import { getViewportSize } from './popupUtils';
import { useHoverIntent } from './useHoverIntent';

export interface HoverCardProps {
  /** What the card shows. Rendered only while it is open, so it can start loading on demand. */
  content: ReactNode;
  /** The trigger content (a link, a word, a badge). Wrapped in an inline `<span>`. */
  children: ReactNode;
  /** Delay before a hover or focus opens the card. Default 300ms. */
  showDelay?: number;
  /** Delay before leaving the trigger and the card closes it. Default 200ms. */
  hideDelay?: number;
  /** Never open (the trigger renders as plain content). */
  disabled?: boolean;
  /** Fires whenever the card opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Card width in px. Default 380. */
  width?: number;
  estimatedHeight?: number;
  placement?: PopupPlacement;
  align?: PopupAlign;
  dir?: PopupDir;
  /** Accessible name of the pinned card, and of the bottom sheet when it has no `sheetTitle`. */
  label?: string;
  /** Visible title of the bottom sheet. */
  sheetTitle?: ReactNode;
  sheetLabels?: Partial<BottomSheetLabels>;
  /** A touch tap on a viewport narrower than this opens a bottom sheet instead of a popover. Default 480; 0 disables the sheet. */
  sheetBreakpoint?: number;
  /**
   * The first touch tap opens the card and suppresses the trigger's own click (a link inside does not
   * navigate); a second tap goes through. Default true.
   */
  touchFirstTapOpens?: boolean;
  /** Extra class on the popover surface. */
  className?: string;
  /** Extra class on the trigger span. */
  triggerClassName?: string;
  id?: string;
}

let nextId = 0;

/** The client rectangle nearest the pointer: a link that wraps across lines anchors where the user is. */
function anchorRect(el: HTMLElement, pointer?: { x: number; y: number }): PopupRect {
  const rects = Array.from(el.getClientRects());
  if (rects.length === 0) {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }
  let best = rects[0];
  if (pointer) {
    let bestDist = Infinity;
    for (const r of rects) {
      const dy = pointer.y < r.top ? r.top - pointer.y : pointer.y > r.bottom ? pointer.y - r.bottom : 0;
      const dx = pointer.x < r.left ? r.left - pointer.x : pointer.x > r.right ? pointer.x - r.right : 0;
      const d = dy * 1000 + dx;
      if (d < bestDist) { bestDist = d; best = r; }
    }
  }
  return { left: best.left, right: best.right, top: best.top, bottom: best.bottom };
}

/**
 * A trigger plus a card that opens on hover or focus, meeting WCAG 1.4.13: it is dismissible (Escape,
 * outside press), hoverable (the pointer can move onto it) and persistent (it stays until the pointer
 * leaves both, or it is dismissed). Click or Enter pins it open. On touch, the first tap opens it (and
 * suppresses the trigger's own click), as a popover, or a bottom sheet on narrow viewports.
 */
export function HoverCard(props: HoverCardProps) {
  const {
    content, children, showDelay, hideDelay, disabled = false, onOpenChange, width, estimatedHeight, placement, align, dir,
    label, sheetTitle, sheetLabels, sheetBreakpoint = 480, touchFirstTapOpens = true, className, triggerClassName, id,
  } = props;

  const triggerRef = useRef<HTMLSpanElement>(null);
  const popupIdRef = useRef<string>(id ?? `kth_hovercard_${++nextId}`);
  const popupId = popupIdRef.current;
  const [anchor, setAnchor] = useState<PopupAnchor | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [sheet, setSheet] = useState(false);
  const lastPointerType = useRef<string>('mouse');
  const focusCard = useRef(false);
  const pointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const open = !disabled && (hovered || pinned);

  const setOpenState = useCallback((nextHovered: boolean, nextPinned: boolean, nextSheet: boolean) => {
    setHovered(nextHovered);
    setPinned(nextPinned);
    setSheet(nextSheet);
    onOpenChange?.(nextHovered || nextPinned);
  }, [onOpenChange]);

  const intent = useHoverIntent<null>({
    showDelay,
    hideDelay,
    onShow: () => {
      if (!triggerRef.current || disabled) return;
      setAnchor(anchorRect(triggerRef.current, pointer.current));
      if (!hovered) { setHovered(true); if (!pinned) onOpenChange?.(true); }
    },
    onHide: () => {
      if (pinned) return;
      if (hovered) { setHovered(false); onOpenChange?.(false); }
    },
  });

  const close = useCallback(() => {
    intent.dispose();
    if (hovered || pinned || sheet) setOpenState(false, false, false);
  }, [intent, hovered, pinned, sheet, setOpenState]);

  const onPointerEnter = (e: ReactPointerEvent<HTMLSpanElement>) => {
    lastPointerType.current = e.pointerType || 'mouse';
    if (e.pointerType === 'touch' || disabled) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    intent.scheduleShow(null);
  };
  const onPointerLeave = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.pointerType === 'touch') return;
    intent.scheduleHide();
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    lastPointerType.current = e.pointerType || 'mouse';
  };
  const onFocus = () => {
    if (disabled) return;
    pointer.current = undefined;
    intent.cancelHide();
    if (triggerRef.current && !hovered) {
      setAnchor(anchorRect(triggerRef.current));
      setHovered(true);
      if (!pinned) onOpenChange?.(true);
    }
  };
  const onBlur = (e: FocusEvent<HTMLSpanElement>) => {
    const next = e.relatedTarget as Node | null;
    const card = typeof document === 'undefined' ? null : document.getElementById(popupId);
    if (next && card?.contains(next)) return;
    intent.scheduleHide();
  };
  const onClick = (e: ReactMouseEvent<HTMLSpanElement>) => {
    if (disabled || !triggerRef.current) return;
    const touch = lastPointerType.current === 'touch';
    // detail 0: keyboard activation (Enter/Space), which should move focus into the pinned card.
    focusCard.current = touch || e.detail === 0;
    if (touch) {
      if (open) return; // second tap: let the trigger's own action run
      if (touchFirstTapOpens) e.preventDefault();
      setAnchor(anchorRect(triggerRef.current));
      const narrow = sheetBreakpoint > 0 && getViewportSize().width < sheetBreakpoint;
      setOpenState(false, true, narrow);
      return;
    }
    // Mouse or keyboard activation pins the card so it survives the pointer leaving.
    if (pinned) { setOpenState(hovered, false, false); return; }
    intent.cancelHide();
    if (!anchor) setAnchor(anchorRect(triggerRef.current, pointer.current));
    setOpenState(true, true, false);
  };

  const enterCard = () => intent.cancelHide();
  const leaveCard = () => intent.scheduleHide();

  return (
    <>
      <span
        ref={triggerRef}
        className={triggerClassName ? `kth-hovercard-trigger ${triggerClassName}` : 'kth-hovercard-trigger'}
        aria-describedby={open && !sheet ? popupId : undefined}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onClick}
      >
        {children}
      </span>
      {open && sheet ? (
        <BottomSheet open onClose={close} title={sheetTitle} label={label} labels={sheetLabels} id={popupId}>
          {content}
        </BottomSheet>
      ) : (
        <Popover
          open={open}
          anchor={anchor}
          onClose={close}
          insideRefs={[triggerRef]}
          id={popupId}
          role={pinned ? 'dialog' : 'tooltip'}
          label={label}
          width={width}
          estimatedHeight={estimatedHeight}
          placement={placement}
          align={align}
          dir={dir}
          className={className}
          autoFocus={pinned && focusCard.current}
          onMouseEnter={enterCard}
          onMouseLeave={leaveCard}
        >
          {content}
        </Popover>
      )}
    </>
  );
}
