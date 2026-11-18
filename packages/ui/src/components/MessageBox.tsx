import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Dialog } from './Dialog';

export interface MessageBoxProps {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel: string;
  /** Without it the box has a single button. */
  cancelLabel?: string;
  /** danger: the confirm button is `kth-btn--danger` and takes no initial focus (cancel does). */
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  /** Also Escape and a backdrop press. */
  onCancel: () => void;
  /** Disables the buttons. */
  busy?: boolean;
  id?: string;
}

/** A confirm / message box: a small `alertdialog` built on `Dialog`. */
export function MessageBox(props: MessageBoxProps) {
  const { open, title, message, confirmLabel, cancelLabel, tone = 'default', onConfirm, onCancel, busy, id } = props;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Dialog (the child) has already moved focus by the time this runs; refine it.
  useLayoutEffect(() => {
    if (!open) return;
    const target = tone === 'danger' && cancelRef.current ? cancelRef.current : confirmRef.current;
    target?.focus({ preventScroll: true });
  }, [open, tone]);

  const confirmClass = tone === 'danger' ? 'kth-btn kth-btn--danger' : 'kth-btn kth-btn--primary';
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      role="alertdialog"
      showClose={false}
      id={id}
      footer={(
        <>
          {cancelLabel ? (
            <button ref={cancelRef} type="button" className="kth-btn" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          ) : null}
          <button ref={confirmRef} type="button" className={confirmClass} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </>
      )}
    >
      {message ? <div className="kth-dialog__message">{message}</div> : null}
    </Dialog>
  );
}
