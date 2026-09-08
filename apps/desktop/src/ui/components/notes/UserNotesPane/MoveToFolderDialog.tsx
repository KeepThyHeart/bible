import React from 'react';
import { useI18n } from '../../../contexts/useI18n';
import { useFocusTrap } from '../../../hooks/useFocusTrap';

interface MoveToFolderDialogProps {
  isOpen: boolean;
  folders: string[];
  currentPath: string;
  onMove: (folder: string) => void;
  onCancel: () => void;
  /**
   * What is being moved, when it is not the note the editor has open - the
   * browser's context menu passes the entry's name so the dialog says which
   * file the destination is for.
   */
  subjectName?: string;
}

/** Indent per nesting level, so the tree shape is visible at a glance. */
const INDENT_PX = 12;

/**
 * Folders arrive as relative paths (`Sermons/2026`). Display them with forward
 * slashes whatever the platform wrote, and indent by depth: the full path is
 * what disambiguates two folders called "2026", and the indent is what makes a
 * long list scannable.
 */
function folderDepth(folder: string): number {
  return folder ? folder.split(/[/\\]/).length - 1 : 0;
}

const MoveToFolderDialog: React.FC<MoveToFolderDialogProps> = ({
  isOpen,
  folders,
  currentPath,
  onMove,
  onCancel,
  subjectName,
}) => {
  const { t } = useI18n();
  // Contains Tab within the dialog while it is open, and restores focus after.
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-background-overlay flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-to-folder-dialog-title"
        className="bg-surface rounded-lg shadow-xl w-80 max-h-96 flex flex-col"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div id="move-to-folder-dialog-title" className="px-4 py-3 border-b border-border font-medium">
          {t('userNotesPane.moveToFolder')}
          {subjectName && (
            <div className="text-xs font-normal text-text-secondary truncate" title={subjectName}>
              {subjectName}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {folders.map(folder => (
            <button
              key={folder}
              type="button"
              onClick={() => onMove(folder)}
              aria-current={folder === currentPath ? 'true' : undefined}
              style={{ paddingInlineStart: 12 + folderDepth(folder) * INDENT_PX }}
              title={folder.replace(/\\/g, '/')}
              className={`w-full text-start px-3 py-2 text-sm rounded hover:bg-accent-light transition-colors flex items-center gap-2 ${
                folder === currentPath ? 'bg-accent-soft text-accent-strong' : ''
              }`}
            >
              <svg
                className="w-4 h-4 text-text-muted flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <span className="truncate">
                {folder ? folder.replace(/\\/g, '/') : t('userNotesPane.rootFolder')}
              </span>
            </button>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-border flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded border border-border-secondary hover:bg-background-hover"
          >
            {t('userNotesPane.cancelButton')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MoveToFolderDialog;
