import React from 'react';
import { useI18n } from '../../../contexts/useI18n';
import NoteEditor from '../editor/NoteEditor';
import type { NoteExportActions } from '../editor/EditorToolbar';
import { BreadcrumbSegment } from '../NotesBreadcrumb';
interface UserNotesEditorViewProps {
  editorContent: string;
  setEditorContent: (content: string) => void;
  editorIsDirty: boolean;
  isSaving: boolean;
  lastSaved: string | undefined;
  showEditorSidebar: boolean;
  setShowEditorSidebar: (next: boolean | ((prev: boolean) => boolean)) => void;
  breadcrumbs: BreadcrumbSegment[];
  onBreadcrumbNavigate: (path: string) => void;
  onRequestRenameTitle: () => void;
  /** False for verse notes: their title is derived from the verse reference. */
  titleEditable: boolean;
  onPopOut: () => void;
  /** Print / PDF / Word / Markdown, surfaced in the editor toolbar. */
  exportActions: NoteExportActions;
}

/**
 * The editor surface: sidebar toggle + breadcrumb + Tiptap editor + status bar.
 */
const UserNotesEditorView: React.FC<UserNotesEditorViewProps> = ({
  editorContent,
  setEditorContent,
  editorIsDirty,
  isSaving,
  lastSaved,
  showEditorSidebar,
  setShowEditorSidebar,
  breadcrumbs,
  onBreadcrumbNavigate,
  onRequestRenameTitle,
  titleEditable,
  onPopOut,
  exportActions,
}) => {
  const { t } = useI18n();

  const sidebarToggleLabel = showEditorSidebar
    ? t('userNotesPane.hideSidebar')
    : t('userNotesPane.showSidebar');

  return (
    <>
      {/* Breadcrumb + action bar */}
      <div className="border-b border-border px-4 py-2 bg-background-warm flex items-center gap-2">
        {/* Sidebar toggle */}
        <button
          type="button"
          onClick={() => setShowEditorSidebar(prev => !prev)}
          className={`px-2 py-1 text-sm rounded border transition-colors flex-shrink-0 flex items-center gap-1 ${
            showEditorSidebar
              ? 'border-accent bg-accent-light text-accent-strong hover:bg-accent-soft'
              : 'border-border-secondary hover:bg-background-hover'
          }`}
          title={sidebarToggleLabel}
          aria-label={sidebarToggleLabel}
          aria-pressed={showEditorSidebar}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} />
            <line x1="9" y1="3" x2="9" y2="21" strokeWidth={2} />
            {showEditorSidebar && <rect x="3" y="3" width="6" height="18" rx="2" fill="currentColor" opacity="0.2" />}
          </svg>
        </button>

        {/* Inline breadcrumbs with editable title */}
        <nav
          className="flex items-center gap-1 text-sm min-w-0 flex-1 overflow-x-auto whitespace-nowrap"
          aria-label={t('userNotesPane.breadcrumbLabel')}
        >
          {breadcrumbs.map((seg, i, arr) => (
            <React.Fragment key={seg.path}>
              {i > 0 && (
                <svg className="w-3 h-3 text-text-secondary flex-shrink-0 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
              {i < arr.length - 1 ? (
                <button
                  type="button"
                  onClick={() => onBreadcrumbNavigate(seg.path)}
                  className="text-accent-strong hover:text-accent-strong hover:underline transition-colors"
                >
                  {seg.label}
                </button>
              ) : (
                <span className="font-medium text-text-heading truncate flex items-center gap-1" aria-current="true">
                  {seg.label}
                  {/* Edit title icon - verse notes derive their title from the
                      verse reference, so no rename affordance is shown at all
                      (not just disabled) to make the read-only-ness visible. */}
                  {titleEditable && (
                    <button
                      type="button"
                      onClick={onRequestRenameTitle}
                      className="inline-flex items-center p-0.5 rounded hover:bg-background-active transition-colors opacity-40 hover:opacity-100"
                      title={t('userNotesPane.renameNoteTitle')}
                      aria-label={t('userNotesPane.renameNoteTitle')}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  )}
                </span>
              )}
            </React.Fragment>
          ))}
        </nav>

        {/* Auto-save status indicator */}
        {(isSaving || !editorIsDirty) && (
          <span
            className={`text-xs flex-shrink-0 ${isSaving ? 'text-text-muted' : 'text-success'}`}
            role="status"
            aria-live="polite"
          >
            {isSaving
              ? t('userNotesPane.savingStatus')
              : t('userNotesPane.savedStatus')}
          </span>
        )}

        {/* Pop-out - a window-level action, not a title action. It must not sit
            immediately beside the breadcrumb's Edit Title pencil, where the two
            3.5px icons would be a millimetre apart and easily misclicked for
            each other. It is pushed to the far end of the header (`ms-auto`
            against the flex-1 breadcrumb nav) and given the same bordered
            chrome as the sidebar toggle so it reads as a pane control. */}
        <button
          type="button"
          onClick={onPopOut}
          className="ms-auto flex-shrink-0 px-2 py-1 rounded border border-border-secondary hover:bg-background-hover transition-colors"
          title={t('userNotesPane.popOutTitle')}
          aria-label={t('userNotesPane.popOutTitle')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
      </div>

      {/* TipTap Editor */}
      <div className="flex-1 overflow-hidden">
        <NoteEditor
          value={editorContent}
          onChange={setEditorContent}
          placeholder={t('userNotesPane.startWritingPlaceholder')}
          exportActions={exportActions}
        />
      </div>

      {/* Status bar */}
      <div className="border-t border-border px-4 py-1.5 text-xs text-text-secondary bg-surface-secondary flex items-center gap-3">
        <span>
          {lastSaved
            ? t('userNotesPane.lastSavedAt', { time: new Date(lastSaved).toLocaleTimeString(), })
            : ''}
        </span>
      </div>
    </>
  );
};

export default UserNotesEditorView;
