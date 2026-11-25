import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { isDraftNote } from './UserNotesPane/draftNote';
import { isEnabled } from '../../settings/featureFlags';
import { useChapterMode } from './UserNotesPane/hooks/useChapterMode';
import { compileRequestForFolder, isCompilableVerseFolder } from './UserNotesPane/chapterPaneHelpers';
import { useNoteOpenRequest } from './UserNotesPane/noteOpenRequest';
import { requestCompilePassageNotes } from '../../services/compile/compileRequest';
import ChapterNotesView from './chapter/ChapterNotesView';
import { useDetachedVerseFollow } from './chapter/useDetachedVerseFollow';
import type { ChapterModeNavState } from '../../stores/notesChapterNavState';
import { useVerseNoteOpener } from './UserNotesPane/hooks/useVerseNoteOpener';
import { usePopOutListener } from './UserNotesPane/hooks/usePopOutListener';
import { useNoteSavedListener } from './UserNotesPane/hooks/useNoteSavedListener';
import { useNotesNavigation } from './UserNotesPane/hooks/useNotesNavigation';
import { useMoveDialogFolders } from './UserNotesPane/hooks/useMoveDialogFolders';
import UserNotesSidebar from './UserNotesPane/UserNotesSidebar';
import UserNotesEditorView from './UserNotesPane/UserNotesEditorView';
import UserNotesDialogs from './UserNotesPane/UserNotesDialogs';
import ConfirmDialog from '../shared/ConfirmDialog';
import { useI18n } from '../../contexts/useI18n';
import { entryDisplayName } from './verseNoteName';

type NotesView = 'browser' | 'editor' | 'chapter';

interface UserNotesPaneProps {
  panelId?: string;
  isDetached?: boolean;
  windowId?: string;
  initialView?: NotesView;
  /** Chapter mode position handed over by a pop-out. */
  initialChapter?: ChapterModeNavState;
  initialSideTab?: NotesSideTab;
  initialCurrentPath?: string;
  initialCurrentNotePath?: string;
}

const UserNotesPane: React.FC<UserNotesPaneProps> = ({
  panelId = DEFAULT_PANEL_ID,
  isDetached = false,
  initialView: initialViewProp,
  initialChapter: initialChapterProp,
  initialSideTab,
  initialCurrentPath,
  initialCurrentNotePath,
}) => {
  const { t, localizer } = useI18n();
  // Chapter mode is behind the default-off `chapterNotes` flag: while off, nothing of it is reachable
  // and any saved or popped-out 'chapter' state falls back to the browser view.
  const chapterOn = isEnabled('chapterNotes');
  const initialView = chapterOn || initialViewProp !== 'chapter' ? initialViewProp : undefined;
  const initialChapter = chapterOn ? initialChapterProp : undefined;
  useDetachedVerseFollow(isDetached && chapterOn, panelId);
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

  // Chapter mode (third view). The navigation hook and the verse-note opener are created
  // after it, so it reaches them through refs.
  const loadDirectoryRef = useRef<((path: string) => void | Promise<void>) | null>(null);
  const openVerseRef = useRef<((verseId?: number) => Promise<void>) | null>(null);
  const {
    chapterState,
    setChapterState,
    handleRef: chapterHandleRef,
    onStateChange: onChapterStateChange,
    flushChapter,
    deactivateChapter,
    setChapterView,
    routeToChapter,
    enterChapter,
    exitToSingle,
  } = useChapterMode({
    isDetached,
    initialChapter,
    view,
    currentPath,
    currentNotePath,
    editorIsDirty,
    handleSaveNote,
    setView,
    loadDirectoryRef,
    openVerseRef,
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
    chapter: chapterState,
    flushChapter,
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

  loadDirectoryRef.current = loadDirectory;

  // Mount-time init (including restoring the note this panel was left on) +
  // dynamic subtitle + nav-state registration.
  const { restoreDone } = useNotesInit({
    pendingVerseOpenRef,
    panelId,
    isDetached,
    initialView,
    initialChapter,
    initialSideTab,
    initialCurrentPath,
    initialCurrentNotePath,
    view,
    chapter: chapterState,
    sideTab,
    currentPath,
    currentNotePath,
    currentNote,
    loadDirectory,
    setShowSetup,
    setCurrentNote,
    setCurrentNotePath,
    setView,
    setChapterView: chapterOn ? setChapterView : undefined,
    setChapterState,
    setCurrentPath,
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
  const { handleOpenVerseNote } = useVerseNoteOpener({
    ready: restoreDone && !showSetup,
    pendingRef: pendingVerseOpenRef,
    currentVerseId,
    setCurrentNote,
    setCurrentNotePath,
    setCurrentPath,
    setView,
    setFileError,
    routeToChapter,
  });
  openVerseRef.current = handleOpenVerseNote;

  // A note created elsewhere (the compile dialog) asks this pane to open it.
  useNoteOpenRequest(handleOpenNote);

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
    deactivateChapter,
  });

  // Live sync: a save of this note in another window reloads it here (or flags a conflict if we have unsaved edits)
  useNoteSavedListener({ view, currentNote, currentNotePath, setCurrentNote, setFileError });

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
    view: view === 'chapter' ? 'browser' : view,
    onSave: handleSaveNote,
    onSaveAs: handleSaveAs,
    onPrint: handlePrint,
  });

  // Notes added, renamed or synced by another program (Dropbox, a file manager) while the app was in the
  // background show up in the list when the user comes back to it (B-083).
  useEffect(() => {
    if (view !== 'browser' || showSetup) return;
    const refresh = () => loadDirectory(currentPath);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [view, showSetup, currentPath, loadDirectory]);

  // Verse Notes folder check + permissions
  const isInVerseNotesFolder = isInVerseNotesFolderPath(currentPath);

  /** Editor "Delete": ask first, through the same confirm dialog as the browser's menu. */
  const requestDeleteCurrentNote = () => {
    if (!currentNote || !currentNotePath) return;
    const name = currentNotePath.replace(/\\/g, '/').split('/').pop() ?? currentNotePath;
    setDeleteTarget({
      name: name.replace(/\.bn$/, ''),
      path: currentNotePath,
      isDirectory: false,
      modified: currentNote.updated,
    });
  };
  /** Folder browser "Compile passage notes...": prefill the dialog from a Verse Notes book/chapter folder. */
  const handleCompileFolder = useCallback((entry: FileEntry) => {
    if (!entry.isDirectory || !isCompilableVerseFolder(entry.path)) return;
    compileRequestForFolder(entry.path).then(
      req => { if (req) requestCompilePassageNotes(req); },
      (err: unknown) => setFileError(`Failed to compile passage notes: ${err instanceof Error ? err.message : String(err)}`)
    );
  }, []);

  // A verse note with no file yet: nothing to move, delete or reveal until it is saved.
  const isDraft = isDraftNote(currentNote);
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
            {(view === 'browser' || (view === 'editor' && showEditorSidebar)) && (
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
                onRequestDelete={isDraft ? undefined : requestDeleteCurrentNote}
                isDraft={isDraft}
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
                  onOpenChapter={chapterOn && isInVerseNotesFolder && currentPath !== VERSE_NOTES_FOLDER ? () => { void enterChapter(); } : undefined}
                  onCompileFolder={handleCompileFolder}
                  verseNotesFolderPath={VERSE_NOTES_FOLDER}
                  recentFiles={recentFiles}
                  onRemoveRecentFile={removeRecentFile}
                  sideTab={sideTab}
                  // Only offered where creating a note is actually allowed -
                  // the Verse Notes folder is populated from the Bible pane.
                  onCreateNote={canCreateNewNote ? () => setShowNewNoteDialog(true) : undefined}
                />
              )}

              {view === 'chapter' && chapterState && (
                <ChapterNotesView
                  panelId={panelId}
                  isDetached={isDetached}
                  state={chapterState}
                  onStateChange={onChapterStateChange}
                  onExitToSingle={(verseId) => { void exitToSingle(verseId); }}
                  handleRef={chapterHandleRef}
                  onPopOut={() => { void handlePopOut(); }}
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
                  onRequestDelete={currentNote.type === 'verse_note' && !isDraft ? requestDeleteCurrentNote : undefined}
                  // Verse notes derive their title from the linked verse
                  // reference (e.g. "John 3:16") and aren't user-renameable;
                  // documents/journal/prayer notes keep the free-text title.
                  titleEditable={currentNote.type !== 'verse_note'}
                  onPopOut={handlePopOut}
                  onOpenChapter={chapterOn && currentNote.type === 'verse_note' ? () => { void enterChapter(); } : undefined}
                  isDetached={isDetached}
                  isDraft={isDraft}
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
          : t('userNotesPane.deleteConfirm.message', {
              // "Genesis 24:3", not the bare file name "3", for a verse note.
              name: deleteTarget ? entryDisplayName(deleteTarget, VERSE_NOTES_FOLDER, localizer) : '',
            })}
        confirmLabel={t('userNotesPane.deleteConfirm.confirm')}
        destructive
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          if (view === 'editor' && target.path === currentNotePath) {
            // Deleting the open note: drop its unsaved edits (nothing to flush
            // to a file that is going away) and land in its folder.
            useNoteEditorStore.getState().markSaved(); // allow-getstate: confirm callback - imperative store write
            const parent = target.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
            void handleDelete(target, parent);
          } else {
            void handleDelete(target);
          }
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
