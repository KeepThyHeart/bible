import React, { useState, useEffect } from 'react';
import { useI18n } from '../contexts/useI18n';

interface TextInputDialogProps {
  isOpen: boolean;
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/**
 * Simple text input dialog component
 * Displays a modal with a text input field and OK/Cancel buttons
 */
const TextInputDialog: React.FC<TextInputDialogProps> = ({
  isOpen,
  title,
  label,
  placeholder = '',
  initialValue = '',
  onConfirm,
  onCancel
}) => {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);

  // Reset value when dialog opens
  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
    }
  }, [isOpen, initialValue]);

  const handleConfirm = () => {
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-background-overlay z-40"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-lg">
        <div
          className="bg-surface rounded-lg shadow-xl max-w-md w-full"
          role="dialog"
          aria-modal="true"
          aria-labelledby="text-input-dialog-title"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-xl py-lg border-b border-border">
            <h2 id="text-input-dialog-title" className="text-lg font-bold text-text-heading">{title}</h2>
            <button
              onClick={onCancel}
              className="p-1 hover:bg-background-active rounded transition-colors"
              title={t('textInputDialog.closeTitle')}
              aria-label={t('textInputDialog.closeTitle')}
            >
              <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="px-xl py-lg">
            <label className="block text-sm font-semibold text-text-heading mb-xs">
              {label}
            </label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-sm py-sm text-sm border border-border rounded focus:border-accent focus:ring-2 focus:ring-accent/30"
              placeholder={placeholder}
              autoFocus
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-sm px-xl py-lg border-t border-border bg-background-warm">
            <button
              onClick={onCancel}
              className="px-lg py-sm text-sm border border-border rounded hover:bg-background-hover transition-colors"
            >
              {t('textInputDialog.cancel')}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!value.trim()}
              className="px-lg py-sm text-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default TextInputDialog;
