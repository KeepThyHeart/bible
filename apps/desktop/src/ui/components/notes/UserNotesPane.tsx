import React, { useState, useEffect, useRef } from 'react';
import { useNotesStore } from '../../stores/useNotesStore';
import { useNotesPanel } from '../../stores/hooks/useNotesPanel';
import NotesFolderBrowser from './NotesFolderBrowser';
import NotesSetupDialog from './NotesSetupDialog';
import NotesErrorBanner from './NotesErrorBanner';
import * as fileNotesAPI from '../../services/fileNotesAPI';
import { FileEntry, BnFile } from '../../services/fileNotesAPI';
import { useNoteEditorStore } from '../../stores/useNoteEditorStore';
import { useFileNotesStore, type NotesSideTab } from '../../stores/useFileNotesStore';
import { DEFAULT_PANEL_ID } from '../../stores/helpers/panelStateHelpers';

import { VERSE_NOTES_FOLDER, isInVerseNotesFolderPath, isAbsolutePath } from './UserNotesPane/utils';
import { useNotesAutoSave } from './UserNotesPane/hooks/useNotesAutoSave';
import { useActiveNoteFlush } from './UserNotesPane/hooks/useActiveNoteFlush';
import { useVerseNavigationListeners } from './UserNotesPane/hooks/useVerseNavigationListeners';
import { useNoteFileActions } from './UserNotesPane/hooks/useNoteFileActions';
import { useNoteCrud } from './UserNotesPane/hooks/useNoteCrud';
import { useEditorShortcuts } from './UserNotesPane/hooks/useEditorShortcuts';
import { useNotesInit } from './UserNotesPane/hooks/useNotesInit';
import { useVerseNoteOpener } from './UserNotesPane/hooks/useVerseNoteOpener';
import { usePopOutListener } from './UserNotesPane/hooks/usePopOutListener';
import { useNotesNavigation } from './UserNotesPane/hooks/useNotesNavigation';
import { useMoveDialogFolders } from './UserNotesPane/hooks/useMoveDialogFolders';
import UserNotesSidebar from './UserNotesPane/UserNotesSidebar';
import UserNotesEditorView from './UserNotesPane/UserNotesEditorView';
import UserNotesDialogs from './UserNotesPane/UserNotesDialogs';
import ConfirmDialog from '../shared/ConfirmDialog';
import { useI18n } from '../../contexts/useI18n';

type NotesView = 'browser' | 'editor';

interface UserNotesPaneProps {
  panelId?: string;
  isDetached?: boolean;
  windowId?: string;
  initialView?: 'browser' | 'editor';
  initialSideTab?: NotesSideTab;
  initialCurrentPath?: string;
  initialCurrentNotePath?: string;
}

const UserNotesPane: React.FC<UserNotesPaneProps> = ({
  panelId = DEFAULT_PANEL_ID,
  isDetached = false,
  initialView,
  initialSideTab,
  initialCurrentPath,
  initialCurrentNotePath,
}) => {
  const { t } = useI18n();
  const { currentVerseId } = useNotesPanel(panelId);
  // Entry awaiting delete confirmation (goes to the system trash).
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);

  // Panel lifecycle
  const initPanel = useNotesStore(s => s.initPanel);
  const destroyPanel = useNotesStore(s => s.destroyPanel);
  useEffect(() => {
    initPanel(panelId);
    return () => { destroyPanel(panelId); };
  }, [panelId, initPanel, destroyPanel]);

  // Set when an 'open-verse-note' request arrives before the pane is ready.
  const pendingVerseOpenRef = useRef(false);

  // File-based notes state
  const [view, setView] = useState<NotesView>('browser');
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentNote, setCurrentNote] = useState<BnFile | null>(null);
  const [currentNotePath, setCurrentNotePath] = useState<string>('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showNewNoteDialog, setShowNewNoteDialog] = useState(false);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [renameEntry, setRenameEntry] = useState<FileEntry | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sideTab, setSideTab] = useState<NotesSideTab>('browse');
  const [showEditorSidebar, setShowEditorSidebar] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  // The browser's "Move to..." moves an entry the user right-clicked, which is
  // not necessarily (and usually is not) the note the editor has open - so it
  // is its own state rather than a second meaning for `showMoveDialog`.
  const [moveEntry, setMoveEntry] = useState<FileEntry | null>(null);

  // Recent files from persistent store
  const recentFiles = useFileNotesStore(s => s.recentFiles);
  const removeRecentFile = useFileNotesStore(s => s.removeRecentFile);

  // Editor state for file-based notes
  const editorContent = useNoteEditorStore(s => s.content);
  const setEditorContent = useNoteEditorStore(s => s.setContent);
  const editorIsDirty = useNoteEditorStore(s => s.isDirty);
  const lastSaved = useNoteEditorStore(s => s.lastSaved);

  // File actions (save, save-as, print, export, open, reveal-in-explorer)
  const {
    handleSaveNote,
    handleSaveAs,
    handlePrint,
    handleExportPdf,
    handleExportMarkdown,
    handleExportDocx,
    handleOpenFile,
    handleOpenInExplorer,
  } = useNoteFileActions({
    currentNote,
    currentNotePath,
    editorContent,
    setCurrentNote,
    setCurrentNotePath,
    setView,
    setIsSaving,
    setFileError,
  });

  // Folder/note navigation, breadcrumbs, rename-current, pop-out
  const {
    loadDirectory,
    handleOpenNote,
    handleBreadcrumbNavigate,
    buildBreadcrumbs,
    buildEditorBreadcrumbs,
    requestRenameCurrentNote,
    handlePopOut,
  } = useNotesNavigation({
    panelId,
    view,
    currentPath,
    currentNote,
    currentNotePath,
    editorIsDirty,
    setEntries,
    setCurrentPath,
    setView,
    setCurrentNote,
    setCurrentNotePath,
    setFileError,
    setRenameEntry,
    handleSaveNote,
  });

  // Mount-time init (including restoring the note this panel was left on) +
  // dynamic subtitle + nav-state registration.
  const { restoreDone } = useNotesInit({
    pendingVerseOpenRef,
    panelId,
    isDetached,
    initialView,
    initialSideTab,
    initialCurrentPath,
    initialCurrentNotePath,
    view,
    sideTab,
    currentPath,
    currentNotePath,
    currentNote,
    loadDirectory,
    setShowSetup,
    setCurrentNote,
    setCurrentNotePath,
    setView,
    setSideTab,
  });

  // Opening or creating another note replaces the one in this pane. Remember the
  // note just left so the editor header can offer a way back to it (its unsaved
  // edits are saved first - see useNotesAutoSave).
  const [previousNote, setPreviousNote] = useState<{ path: string; title: string } | null>(null);
  const lastOpenedRef = useRef<{ path: string; title: string } | null>(null);
  const lastNoteObjRef = useRef<unknown>(null);
  useEffect(() => {
    const prev = lastOpenedRef.current;
    // A move/rename changes only the path (same note object): not "another note".
    if (prev && prev.path !== currentNotePath && currentNotePath && lastNoteObjRef.current !== currentNote
      && !isAbsolutePath(prev.path)) {
      setPreviousNote(prev);
    } else if (!prev && currentNotePath && currentNote) {
      // Arrived from the browser (no note was open): any earlier "back" target is stale.
      setPreviousNote(null);
    }
    lastNoteObjRef.current = currentNote;
    lastOpenedRef.current = currentNotePath && currentNote
      ? { path: currentNotePath, title: currentNote.title }
      : null;
  }, [currentNotePath, currentNote]);

  // Hide the way back when its note was moved, renamed or deleted meanwhile, and
  // keep the label equal to the target's real title.
  const previousPath = previousNote?.path;
  useEffect(() => {
    if (!previousPath) return;
    let cancelled = false;
    fileNotesAPI.readNote(previousPath).then(
      note => {
        if (cancelled) return;
        if (!note) setPreviousNote(null);
        else setPreviousNote(p => (p && p.path === previousPath && p.title !== note.title ? { ...p, title: note.title } : p));
      },
      () => { if (!cancelled) setPreviousNote(null); }
    );
    return () => { cancelled = true; };
  }, [previousPath, currentNotePath]);

  // Auto-save
  useNotesAutoSave({ view, currentNote, currentNotePath, setCurrentNote, setIsSaving, setFileError });

  // Flush the active note to disk on window close / unload (the renderer is
  // destroyed before auto-save's unmount cleanup can run during a real quit).
  useActiveNoteFlush({ view, currentNote, currentNotePath, setCurrentNote });

  // Verse-note open (event from Bible pane)
  useVerseNoteOpener({
    ready: restoreDone && !showSetup,
    pendingRef: pendingVerseOpenRef,
    currentVerseId,
    setCurrentNote,
    setCurrentNotePath,
    setCurrentPath,
    setView,
    setFileError,
  });

  // Verse navigation listeners (Alt+Click / Ctrl+Click in notes)
  useVerseNavigationListeners();

  // Pop-out listener (closes editor in original pane to prevent dual-editing)
  usePopOutListener({
    panelId,
    isDetached,
    view,
    editorIsDirty,
    currentPath,
    handleSaveNote,
    loadDirectory,
  });

  // Notes-folder CRUD: create note/folder, rename, move, delete
  const {
    handleCreateNote,
    handleCreateFolder,
    handleRename,
    handleMoveCurrentNote,
    handleMoveEntry,
    handleDelete,
  } = useNoteCrud({
    currentPath,
    currentNotePath,
    currentNote,
    loadDirectory,
    setCurrentNote,
    setCurrentNotePath,
    setCurrentPath,
    setView,
    setShowNewNoteDialog,
    setShowNewFolderDialog,
    setShowMoveDialog,
    setRenameEntry,
    setFileError,
  });

  // Folder list for the Move-to-folder dialog - loaded for either way in.
  const moveFolders = useMoveDialogFolders(showMoveDialog || moveEntry !== null);

  // Editor keyboard shortcuts (Ctrl/Cmd+S / Shift+S / P)
  useEditorShortcuts({
    view,
    onSave: handleSaveNote,
    onSaveAs: handleSaveAs,
    onPrint: handlePrint,
  });

  // Verse Notes folder check + permissions
  const isInVerseNotesFolder = isInVerseNotesFolderPath(currentPath);
  const canCreateNewNote = !isInVerseNotesFolder;
  const canCreateNewFolder = !isInVerseNotesFolder;

  // Setup dialog
  if (showSetup) {
    return (
      <div data-testid="notes-pane" className="h-full flex flex-col min-w-0" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
        <NotesSetupDialog
          onComplete={(dir) => {
            useFileNotesStore.getState().setNotesDirectory(dir); // allow-getstate: setup-dialog completion callback - imperative store access outside render
            fileNotesAPI.ensureVerseNotesFolder().then(() => {
              // If Add Note started this setup, carry on into its editor
              // instead of dropping to the folder list.
              if (!pendingVerseOpenRef.current) loadDirectory('');
              setShowSetup(false);
            });
          }}
          onCancel={() => { pendingVerseOpenRef.current = false; setShowSetup(false); }}
        />
      </div>
    );
  }

  return (
    <div data-testid="notes-pane" className="h-full flex flex-col min-w-0" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 flex flex-col">
          {fileError && (
            <NotesErrorBanner
              message={fileError}
              onRetry={() => {
                setFileError(null);
                if (view === 'editor') handleSaveNote();
                else loadDirectory(currentPath);
              }}
              onSaveAs={view === 'editor' ? handleSaveAs : undefined}
              onDismiss={() => setFileError(null)}
            />
          )}

          <div className="flex-1 overflow-hidden flex">
            {(view === 'browser' || showEditorSidebar) && (
              <UserNotesSidebar
                view={view}
                sideTab={sideTab}
                setSideTab={setSideTab}
                isInVerseNotesFolder={isInVerseNotesFolder}
                canCreateNewNote={canCreateNewNote}
                canCreateNewFolder={canCreateNewFolder}
                currentNote={currentNote}
                currentNotePath={currentNotePath}
                currentPath={currentPath}
                editorIsDirty={editorIsDirty}
                onLoadDirectory={loadDirectory}
                onSaveNote={handleSaveNote}
                onShowNewNoteDialog={() => setShowNewNoteDialog(true)}
                onShowNewFolderDialog={() => setShowNewFolderDialog(true)}
                onOpenFile={handleOpenFile}
                onShowMoveDialog={() => setShowMoveDialog(true)}
                onRequestRename={requestRenameCurrentNote}
                onExportMarkdown={handleExportMarkdown}
                onExportDocx={handleExportDocx}
                onExportPdf={handleExportPdf}
                onSaveAs={handleSaveAs}
                onPrint={handlePrint}
                onOpenInExplorer={handleOpenInExplorer}
              />
            )}

            <div className="flex-1 overflow-hidden flex flex-col min-w-0">
              {view === 'browser' && (
                <NotesFolderBrowser
                  breadcrumbs={buildBreadcrumbs()}
                  onBreadcrumbNavigate={handleBreadcrumbNavigate}
                  entries={entries}
                  currentPath={currentPath}
                  onOpenFolder={(path) => loadDirectory(path)}
                  onOpenNote={handleOpenNote}
                  onRename={(entry) => {
                    if (!isInVerseNotesFolder && entry.path !== VERSE_NOTES_FOLDER) {
                      setRenameEntry(entry);
                    }
                  }}
                  onDelete={(entry) => {
                    if (entry.path !== VERSE_NOTES_FOLDER) {
                      setDeleteTarget(entry);
                    }
                  }}
                  onMove={handleMoveEntry}
                  onMoveTo={setMoveEntry}
                  onOpenInExplorer={handleOpenInExplorer}
                  isVerseNotesFolder={isInVerseNotesFolder}
                  verseNotesFolderPath={VERSE_NOTES_FOLDER}
                  recentFiles={recentFiles}
                  onRemoveRecentFile={removeRecentFile}
                  sideTab={sideTab}
                  // Only offered where creating a note is actually allowed -
                  // the Verse Notes folder is populated from the Bible pane.
                  onCreateNote={canCreateNewNote ? () => setShowNewNoteDialog(true) : undefined}
                />
              )}

              {view === 'editor' && currentNote && (
                <UserNotesEditorView
                  editorContent={editorContent}
                  setEditorContent={setEditorContent}
                  editorIsDirty={editorIsDirty}
                  isSaving={isSaving}
                  lastSaved={
                    // Session save time if saved here, else the note's own saved time on disk;
                    // hidden for a note that has never been saved since creation.
                    lastSaved ?? (currentNote.updated && currentNote.updated !== currentNote.created ? currentNote.updated : undefined)
                  }
                  showEditorSidebar={showEditorSidebar}
                  setShowEditorSidebar={setShowEditorSidebar}
                  breadcrumbs={buildEditorBreadcrumbs()}
                  onBreadcrumbNavigate={handleBreadcrumbNavigate}
                  onRequestRenameTitle={requestRenameCurrentNote}
                  // Verse notes derive their title from the linked verse
                  // reference (e.g. "John 3:16") and aren't user-renameable;
                  // documents/journal/prayer notes keep the free-text title.
                  titleEditable={currentNote.type !== 'verse_note'}
                  onPopOut={handlePopOut}
                  notePath={currentNotePath}
                  previousNote={previousNote && previousNote.path !== currentNotePath ? previousNote : null}
                  onBackToPrevious={() => { if (previousNote) void handleOpenNote(previousNote.path); }}
                  // The same four actions the sidebar offers, also in the
                  // editor toolbar - the sidebar is collapsed by default in
                  // the editor, so until now "print this note" was behind a
                  // toggle nobody had a reason to press.
                  exportActions={{
                    onPrint: handlePrint,
                    onExportPdf: () => { void handleExportPdf(); },
                    onExportDocx: () => { void handleExportDocx(); },
                    onExportMarkdown: () => { void handleExportMarkdown(); },
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('userNotesPane.deleteConfirm.title')}
        message={deleteTarget?.isDirectory
          ? t('userNotesPane.deleteConfirm.folderMessage', { name: deleteTarget.name })
          : t('userNotesPane.deleteConfirm.message', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('userNotesPane.deleteConfirm.confirm')}
        destructive
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void handleDelete(target);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <UserNotesDialogs
        showNewNoteDialog={showNewNoteDialog}
        setShowNewNoteDialog={setShowNewNoteDialog}
        onCreateNote={handleCreateNote}
        showNewFolderDialog={showNewFolderDialog}
        setShowNewFolderDialog={setShowNewFolderDialog}
        onCreateFolder={handleCreateFolder}
        renameEntry={renameEntry}
        setRenameEntry={setRenameEntry}
        onRename={handleRename}
        showMoveDialog={showMoveDialog}
        setShowMoveDialog={setShowMoveDialog}
        moveEntry={moveEntry}
        setMoveEntry={setMoveEntry}
        onMoveEntry={handleMoveEntry}
        moveFolders={moveFolders}
        currentPath={currentPath}
        onMoveCurrentNote={handleMoveCurrentNote}
      />
    </div>
  );
};

export default UserNotesPane;
