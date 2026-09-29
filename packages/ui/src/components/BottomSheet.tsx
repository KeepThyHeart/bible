import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape, useFocusScope } from './popupUtils';

export interface BottomSheetLabels {
  close: string;
}

export const DEFAULT_BOTTOM_SHEET_LABELS: BottomSheetLabels = { close: 'Close' };

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Visible title (also names the dialog). Without one, pass `label`. */
  title?: ReactNode;
  /** Accessible name when there is no visible `title`. */
  label?: string;
  labels?: Partial<BottomSheetLabels>;
  /** Max height as a CSS length. Default `50dvh`. */
  maxHeight?: string;
  /** A backdrop press closes. Default true. */
  closeOnBackdropPress?: boolean;
  /** Render into `document.body` (default true). */
  portal?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}

let nextSheetId = 0;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet pinned to the bottom edge (phones). Focus moves into it and returns on close; Tab is
 * kept inside; Escape and a backdrop press close it. Content scrolls; the header stays put.
 * Logical properties throughout, so it is direction-neutral.
 */
export function BottomSheet(props: BottomSheetProps) {
  const { open, onClose, title, label, labels, maxHeight, closeOnBackdropPress = true, portal = true, id, className, children } = props;
  const sheetRef = useRef<HTMLDivElement>(null);
  const generatedId = useRef<string | null>(null);
  if (generatedId.current === null) generatedId.current = `kth_sheet_${++nextSheetId}`;
  const baseId = id ?? generatedId.current;
  const titleId = `${baseId}-title`;
  const l = { ...DEFAULT_BOTTOM_SHEET_LABELS, ...labels };

  useEscape(open, onClose);
  useFocusScope(open, sheetRef);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !sheetRef.current) return;
    const items = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === sheetRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  const content = (
    <div className="kth-sheet-root">
      <div className="kth-sheet-backdrop" onClick={closeOnBackdropPress ? onClose : undefined} aria-hidden="true" />
      <div
        ref={sheetRef}
        id={baseId}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : label}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={className ? `kth-sheet ${className}` : 'kth-sheet'}
        style={maxHeight ? { maxBlockSize: maxHeight } : undefined}
        onKeyDown={onKeyDown}
      >
        <div className="kth-sheet__header">
          <span className="kth-sheet__grip" aria-hidden="true" />
          {title ? <div id={titleId} className="kth-sheet__title">{title}</div> : <span className="kth-sheet__title" />}
          <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" aria-label={l.close} onClick={onClose}>
            {'×'}
          </button>
        </div>
        <div className="kth-sheet__body">{children}</div>
      </div>
    </div>
  );

  if (portal && typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}
