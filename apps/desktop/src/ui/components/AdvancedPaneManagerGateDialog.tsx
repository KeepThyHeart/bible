/**
 * AdvancedPaneManagerGateDialog.tsx (KAN QA 4.5)
 *
 * Shown when the user tries to drag a pane while `advancedPaneManagerEnabled`
 * is off (see DockviewLayout.tsx's onWillDragPanel/onWillDragGroup/onWillDrop
 * handlers and services/AdvancedPaneManagerGate.ts for the interception
 * logic). Explains that layout drag-and-drop is an opt-in "advanced" feature,
 * reminds the user the Layout button can always restore the default
 * arrangement, and requires an explicit checkbox before turning the setting
 * on.
 *
 * Modeled on PreferencesDialog.tsx's own lightweight dialog shell
 * (role="dialog" + aria-modal + useDialogShell) rather than
 * ExtensionConsentDialog's heavier form - this dialog has a single checkbox,
 * not a permission list, so the lighter shell is enough.
 */

import React, { useRef, useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { useDialogShell } from './PreferencesDialog/useDialogShell';

interface AdvancedPaneManagerGateDialogProps {
  /** User declined - nothing changes, the drag stays cancelled. */
  onCancel: () => void;
  /**
   * User checked the box and confirmed. The caller is responsible for
   * persisting `advancedPaneManagerEnabled = true` before/when this fires.
   */
  onConfirm: () => void;
}

const AdvancedPaneManagerGateDialog: React.FC<AdvancedPaneManagerGateDialogProps> = ({
  onCancel,
  onConfirm,
}) => {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useDialogShell(dialogRef, onCancel);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'var(--theme-bg-overlay)' }}
      onClick={onCancel}
      data-testid="advanced-pane-manager-gate-overlay"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="advanced-pane-manager-gate-title"
        aria-describedby="advanced-pane-manager-gate-body"
        className="rounded-lg shadow-2xl w-full max-w-md"
        style={{
          backgroundColor: 'var(--theme-surface-elevated)',
          border: '1px solid var(--theme-border-primary)',
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="advanced-pane-manager-gate-dialog"
      >
        <div className="px-6 pt-5 pb-2">
          <h2
            id="advanced-pane-manager-gate-title"
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--theme-text-heading)' }}
          >
            {t('advancedPaneManagerGate.title')}
          </h2>
          <p
            id="advanced-pane-manager-gate-body"
            className="text-sm mb-4"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            {t('advancedPaneManagerGate.body')}
          </p>

          <label className="flex items-start gap-2 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="w-4 h-4 rounded mt-0.5"
              style={{ accentColor: 'var(--theme-accent-primary)' }}
              data-testid="advanced-pane-manager-gate-checkbox"
            />
            <span className="text-sm" style={{ color: 'var(--theme-text-primary)' }}>
              {t('advancedPaneManagerGate.checkboxLabel')}
            </span>
          </label>

          <p className="text-xs mb-1" style={{ color: 'var(--theme-text-muted)' }}>
            {t('advancedPaneManagerGate.retryHint')}
          </p>
          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            {t('advancedPaneManagerGate.preferencesHint')}
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
            data-testid="advanced-pane-manager-gate-cancel"
          >
            {t('advancedPaneManagerGate.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!checked}
            className="px-4 py-2 rounded text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--theme-accent-primary)',
              color: 'var(--theme-accent-text)',
              opacity: checked ? 1 : 0.5,
              cursor: checked ? 'pointer' : 'not-allowed',
            }}
            data-testid="advanced-pane-manager-gate-confirm"
          >
            {t('advancedPaneManagerGate.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdvancedPaneManagerGateDialog;
