import React from 'react';
import { useI18n } from '../../../contexts/useI18n';
import { BnFile } from '../../../services/fileNotesAPI';

interface UserNotesSidebarProps {
  view: 'browser' | 'editor';
  sideTab: 'browse' | 'recent';
  setSideTab: (tab: 'browse' | 'recent') => void;
  isInVerseNotesFolder: boolean;
  canCreateNewNote: boolean;
  canCreateNewFolder: boolean;
  currentNote: BnFile | null;
  currentNotePath: string;
  currentPath: string;
  editorIsDirty: boolean;
  onLoadDirectory: (path: string) => void;
  onSaveNote: () => void;
  onShowNewNoteDialog: () => void;
  onShowNewFolderDialog: () => void;
  onOpenFile: () => void;
  onShowMoveDialog: () => void;
  onRequestRename: () => void;
  onExportMarkdown: () => void;
  onExportDocx: () => void;
  onExportPdf: () => void;
  onSaveAs: () => void;
  onPrint: () => void;
  onOpenInExplorer: (path?: string) => void;
}

/**
 * The persistent left-rail used by the notes browser view and (when toggled)
 * the editor view. Hosts navigation tabs (Browse/Recent) and context-sensitive
 * action buttons (Create / Document operations / Reveal in Explorer).
 */
const UserNotesSidebar: React.FC<UserNotesSidebarProps> = ({
  view,
  sideTab,
  setSideTab,
  isInVerseNotesFolder,
  canCreateNewNote,
  canCreateNewFolder,
  currentNote,
  currentNotePath,
  currentPath,
  editorIsDirty,
  onLoadDirectory,
  onSaveNote,
  onShowNewNoteDialog,
  onShowNewFolderDialog,
  onOpenFile,
  onShowMoveDialog,
  onRequestRename,
  onExportMarkdown,
  onExportDocx,
  onExportPdf,
  onSaveAs,
  onPrint,
  onOpenInExplorer,
}) => {
  const { t } = useI18n();

  // Verse notes derive their title from the linked verse reference and
  // aren't user-renameable (see UserNotesEditorView's breadcrumb title icon).
  const titleEditable = currentNote?.type !== 'verse_note';

  const navigateToBrowser = (tab: 'browse' | 'recent') => {
    setSideTab(tab);
    if (view === 'editor') {
      if (editorIsDirty) onSaveNote();
      onLoadDirectory(currentPath);
    }
  };

  return (
    <div className="w-48 flex-shrink-0 border-e border-border bg-surface-secondary flex flex-col py-2 px-2 gap-1 overflow-y-auto">
      {/* Navigation section */}
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide px-2 py-1">
        {t('userNotesPane.navigateSection')}
      </div>
      <button
        type="button"
        onClick={() => navigateToBrowser('browse')}
        aria-current={sideTab === 'browse' && view === 'browser' ? 'true' : undefined}
        className={`text-start text-sm px-2 py-1.5 rounded transition-colors flex items-center gap-2 ${
          sideTab === 'browse' && view === 'browser'
            ? 'bg-accent-light text-accent-strong'
            : 'hover:bg-background-active'
        }`}
      >
        <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        {t('userNotesPane.browseTab')}
      </button>
      <button
        type="button"
        onClick={() => navigateToBrowser('recent')}
        aria-current={sideTab === 'recent' && view === 'browser' ? 'true' : undefined}
        className={`text-start text-sm px-2 py-1.5 rounded transition-colors flex items-center gap-2 ${
          sideTab === 'recent' && view === 'browser'
            ? 'bg-accent-light text-accent-strong'
            : 'hover:bg-background-active'
        }`}
      >
        <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {t('userNotesPane.recentTab')}
      </button>

      {/* Context-sensitive actions */}
      {view === 'browser' && !isInVerseNotesFolder && (
        <>
          <div className="border-t border-border my-1" />
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide px-2 py-1">
            {t('userNotesPane.createSection')}
          </div>
          <button
            type="button"
            onClick={canCreateNewNote ? onShowNewNoteDialog : undefined}
            aria-disabled={!canCreateNewNote}
            className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
            title={t('userNotesPane.newNoteTitle')}
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('userNotesPane.newNoteTitle')}
          </button>
          <button
            type="button"
            onClick={canCreateNewFolder ? onShowNewFolderDialog : undefined}
            aria-disabled={!canCreateNewFolder}
            className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
            title={t('userNotesPane.newFolderTitle')}
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('userNotesPane.newFolderTitle')}
          </button>
          <button
            type="button"
            onClick={onOpenFile}
            className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
            title={t('userNotesPane.openFileTitle')}
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
            {t('userNotesPane.openFileLabel')}
          </button>
        </>
      )}

      {view === 'editor' && currentNote && (
        <>
          <div className="border-t border-border my-1" />
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide px-2 py-1">
            {t('userNotesPane.documentSection')}
          </div>
          {titleEditable && (
            <button
              type="button"
              onClick={onRequestRename}
              className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {t('userNotesPane.renameLabel')}
            </button>
          )}
          <button
            type="button"
            onClick={onShowMoveDialog}
            aria-haspopup="dialog"
            className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {t('userNotesPane.moveToLabel')}
          </button>
          <div className="border-t border-border my-1" />
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide px-2 py-1">
            {t('userNotesPane.exportSection')}
          </div>
          <button
            type="button"
            onClick={onExportMarkdown}
            className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {t('userNotesPane.exportMarkdownLabel')}
          </button>
          <button
            type="button"
            onClick={onExportDocx}
            className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {t('userNotesPane.exportDocxLabel')}
          </button>
          {/* PDF sits with the other exports here, and in the editor
              toolbar's export menu - one action, two places, because the
              sidebar is collapsed by default in the editor view. */}
          <button
            type="button"
            onClick={onExportPdf}
            className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {t('userNotesPane.exportPdfLabel')}
          </button>
          <button
            type="button"
            onClick={onSaveAs}
            className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            {t('userNotesPane.saveAsLabel')}
          </button>
          <button
            type="button"
            onClick={onPrint}
            className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4H7v4a2 2 0 002 2zm0-12V3a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
            {t('userNotesPane.printLabel')}
          </button>
        </>
      )}

      <div className="flex-1" />

      <div className="border-t border-border my-1" />
      <button
        type="button"
        onClick={() =>
          onOpenInExplorer(view === 'editor' ? currentNotePath : currentPath || undefined)
        }
        className="text-start text-sm px-2 py-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-2"
        title={t('userNotesPane.openInExplorerTitle')}
      >
        <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        {t('userNotesPane.revealInExplorerLabel')}
      </button>
    </div>
  );
};

export default UserNotesSidebar;
