import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface DialogLabels {
  close: string;
}

export const DEFAULT_DIALOG_LABELS: DialogLabels = { close: 'Close' };

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Secondary line under the title. */
  subtitle?: ReactNode;
  children?: ReactNode;
  /** Action row (buttons); rendered in a footer aligned to the inline end. */
  footer?: ReactNode;
  /** Max inline size about 24rem / 34rem / 48rem. Default 'md'. */
  size?: 'sm' | 'md' | 'lg';
  labels?: Partial<DialogLabels>;
  /** A backdrop press closes. Default true. */
  closeOnBackdropPress?: boolean;
  /** Header close button. Default true. */
  showClose?: boolean;
  /** Render into `document.body` (default true). */
  portal?: boolean;
  role?: 'dialog' | 'alertdialog';
  id?: string;
  className?: string;
  dir?: 'ltr' | 'rtl';
}

const SIZE_CLASS = {
  sm: 'kth-dialog kth-dialog--sm',
  md: 'kth-dialog kth-dialog--md',
  lg: 'kth-dialog kth-dialog--lg',
} as const;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let nextDialogId = 0;
/** Open dialogs, oldest first: only the last one reacts to Escape. */
const openStack: number[] = [];
let lastHandled: Event | null = null;

/**
 * A centred modal dialog: `role="dialog"` (or `alertdialog`), `aria-modal`, named by its title. Focus moves in on
 * open and returns on close, Tab is kept inside, Escape closes only the top-most open dialog, the body scrolls
 * while the header and footer stay put. Logical properties throughout, so it is direction-neutral.
 */
export function Dialog(props: DialogProps) {
  const {
    open, onClose, title, subtitle, children, footer, size = 'md', labels, closeOnBackdropPress = true,
    showClose = true, portal = true, role = 'dialog', id, className, dir,
  } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = ++nextDialogId;
  const baseId = id ?? `kth_dialog_${idRef.current}`;
  const titleId = `${baseId}-title`;
  const subtitleId = `${baseId}-subtitle`;
  const l = { ...DEFAULT_DIALOG_LABELS, ...labels };

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return undefined;
    const token = idRef.current;
    openStack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const first = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialogRef.current)?.focus({ preventScroll: true });
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || lastHandled === e) return;
      if (openStack[openStack.length - 1] !== token) return;
      lastHandled = e;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      const i = openStack.lastIndexOf(token);
      if (i >= 0) openStack.splice(i, 1);
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  const base = SIZE_CLASS[size] ?? SIZE_CLASS.md;
  const content = (
    <div className="kth-dialog-root" dir={dir}>
      <div className="kth-dialog-backdrop" onClick={closeOnBackdropPress ? onClose : undefined} aria-hidden="true" />
      <div
        ref={dialogRef}
        id={baseId}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className={className ? `${base} ${className}` : base}
        onKeyDown={onKeyDown}
      >
        <div className="kth-dialog__header">
          <div className="kth-dialog__heading">
            <div id={titleId} className="kth-dialog__title">{title}</div>
            {subtitle ? <div id={subtitleId} className="kth-dialog__subtitle">{subtitle}</div> : null}
          </div>
          {showClose ? (
            <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" aria-label={l.close} onClick={onClose}>
              {'×'}
            </button>
          ) : null}
        </div>
        <div ref={bodyRef} className="kth-dialog__body">{children}</div>
        {footer ? <div className="kth-dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );

  if (portal && typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}
