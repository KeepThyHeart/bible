import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape, useFocusScope } from './popupUtils';

export interface FullscreenPanelLabels {
  close: string;
}

export const DEFAULT_FULLSCREEN_PANEL_LABELS: FullscreenPanelLabels = { close: 'Close' };

export interface FullscreenPanelProps {
  open: boolean;
  onClose: () => void;
  /** Visible title (also names the dialog). Without one, pass `label`. */
  title?: ReactNode;
  /** Accessible name when there is no visible `title`. */
  label?: string;
  labels?: Partial<FullscreenPanelLabels>;
  /** Escape closes. Default true. */
  closeOnEscape?: boolean;
  /** Render into `document.body` (default true). */
  portal?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}

let nextPanelId = 0;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal panel filling the viewport. Focus moves into it and returns on close; Tab is kept inside;
 * Escape (optional) and the close button close it. Content scrolls; the header stays put.
 */
export function FullscreenPanel(props: FullscreenPanelProps) {
  const { open, onClose, title, label, labels, closeOnEscape = true, portal = true, id, className, children } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const generatedId = useRef<string | null>(null);
  if (generatedId.current === null) generatedId.current = `kth_fullscreen_${++nextPanelId}`;
  const baseId = id ?? generatedId.current;
  const titleId = `${baseId}-title`;
  const l = { ...DEFAULT_FULLSCREEN_PANEL_LABELS, ...labels };

  useEscape(open && closeOnEscape, onClose);
  useFocusScope(open, panelRef);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  const content = (
    <div className="kth-fullscreen-root">
      <div
        ref={panelRef}
        id={baseId}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : label}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={className ? `kth-fullscreen ${className}` : 'kth-fullscreen'}
        onKeyDown={onKeyDown}
      >
        <div className="kth-fullscreen__header">
          {title ? <div id={titleId} className="kth-fullscreen__title">{title}</div> : <span className="kth-fullscreen__title" />}
          <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" aria-label={l.close} onClick={onClose}>
            {'×'}
          </button>
        </div>
        <div className="kth-fullscreen__body">{children}</div>
      </div>
    </div>
  );

  if (portal && typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}
