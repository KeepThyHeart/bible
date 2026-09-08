import React, { useState, useEffect } from 'react';
import * as fileNotesAPI from '../../services/fileNotesAPI';
import { useI18n } from '../../contexts/useI18n';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface NotesSetupDialogProps {
  onComplete: (notesDir: string) => void;
  onCancel: () => void;
}

const NotesSetupDialog: React.FC<NotesSetupDialogProps> = ({ onComplete, onCancel }) => {
  const { t } = useI18n();
  const [notesDir, setNotesDir] = useState('');
  // The dialog is only ever rendered while open, so the trap is always active.
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    // Load the default path
    fileNotesAPI.getNotesDir().then(setNotesDir).catch(console.error);
  }, []);

  const handleBrowse = async () => {
    const selected = await fileNotesAPI.showFolderDialog(notesDir);
    if (selected) {
      setNotesDir(selected);
    }
  };

  const handleConfirm = async () => {
    try {
      const dir = await fileNotesAPI.initialize(notesDir);
      onComplete(dir);
    } catch (err: unknown) {
      console.error('Failed to initialize notes directory:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notes-setup-dialog-title"
        className="bg-surface rounded-lg shadow-xl w-[480px] max-w-[90vw]"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <h2 id="notes-setup-dialog-title" className="text-lg font-semibold text-text-heading">{t('notesSetupDialog.title')}</h2>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-sm text-text-secondary mb-4">
            {t('notesSetupDialog.intro')}
          </p>

          <label htmlFor="notes-setup-location" className="block text-sm font-medium text-text-heading mb-2">{t('notesSetupDialog.locationLabel')}</label>
          <div className="flex gap-2">
            <input
              id="notes-setup-location"
              type="text"
              value={notesDir}
              onChange={(e) => setNotesDir(e.target.value)}
              aria-describedby="notes-setup-tip"
              className="flex-1 px-3 py-2 text-sm border border-border rounded bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={handleBrowse}
              className="px-4 py-2 text-sm border border-border rounded hover:bg-background-hover transition-colors"
            >
              {t('notesSetupDialog.browseButton')}
            </button>
          </div>

          <p id="notes-setup-tip" className="text-xs text-text-secondary mt-3">
            {t('notesSetupDialog.backupTip')}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-border rounded hover:bg-background-hover transition-colors"
          >
            {t('notesSetupDialog.cancelButton')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-2 text-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover transition-colors"
          >
            {t('notesSetupDialog.confirmButton')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotesSetupDialog;
