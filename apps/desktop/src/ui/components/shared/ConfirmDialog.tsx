/**
 * ConfirmDialog.tsx
 *
 * Reusable modal confirmation dialog (Cancel/Confirm) for anywhere the app
 * needs to ask "are you sure?" instead of using the native
 * `window.confirm()`. Modeled on AdvancedPaneManagerGateDialog.tsx's dialog
 * shell (overlay + role="dialog" + aria-modal + useDialogShell) but
 * generalized: caller supplies title/message and a `destructive` flag that
 * swaps the confirm button to the theme's danger color.
 *
 * This component only renders the dialog UI - it does not own any
 * confirm/cancel call sites. Adoption at existing `window.confirm()` sites
 * is handled elsewhere.
 *
 * Split into an outer/inner pair on purpose: `useDialogShell`'s focus-trap
 * effect only (re)activates on mount (its dependency is the ref object,
 * whose identity never changes), so it must mount fresh each time the
 * dialog opens. Rendering the inner component only while `open` is true
 * gives it that fresh mount/unmount instead of toggling visibility on an
 * always-mounted instance, which would leave the trap inert after the
 * first close.
 */

import React, { useRef } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useDialogShell } from '../PreferencesDialog/useDialogShell';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button with the theme's danger color instead of accent. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

type ConfirmDialogInnerProps = Omit<ConfirmDialogProps, 'open'>;

const ConfirmDialogInner: React.FC<ConfirmDialogInnerProps> = ({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);

  useDialogShell(dialogRef, onCancel);

  const resolvedConfirmLabel = confirmLabel ?? t('common.confirm');
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel');

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'var(--theme-bg-overlay)' }}
      onClick={onCancel}
      data-testid="confirm-dialog-overlay"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="rounded-lg shadow-2xl w-full max-w-md"
        style={{
          backgroundColor: 'var(--theme-surface-elevated)',
          border: '1px solid var(--theme-border-primary)',
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="confirm-dialog"
      >
        <div className="px-6 pt-5 pb-2">
          <h2
            id="confirm-dialog-title"
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--theme-text-heading)' }}
          >
            {title}
          </h2>
          <p
            id="confirm-dialog-message"
            className="text-sm mb-4"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            {message}
          </p>
        </div>

        <div
          className="px-6 py-4 flex justify-end gap-2"
          style={{ borderTop: '1px solid var(--theme-border-primary)' }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--theme-bg-tertiary)',
              color: 'var(--theme-text-primary)',
              border: '1px solid var(--theme-border-primary)',
            }}
            data-testid="confirm-dialog-cancel"
          >
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="px-4 py-2 rounded text-sm font-medium transition-colors"
            style={{
              backgroundColor: destructive ? 'var(--theme-danger)' : 'var(--theme-accent-primary)',
              color: 'var(--theme-accent-text)',
            }}
            data-testid="confirm-dialog-confirm"
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ open, ...rest }) => {
  if (!open) return null;
  return <ConfirmDialogInner {...rest} />;
};

export default ConfirmDialog;
