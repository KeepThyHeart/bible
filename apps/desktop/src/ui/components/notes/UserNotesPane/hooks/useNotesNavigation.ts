import { useCallback } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { FileEntry, BnFile } from '../../../../services/fileNotesAPI';
import { useFileNotesStore } from '../../../../stores/useFileNotesStore';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { BreadcrumbSegment } from '../../NotesBreadcrumb';

interface UseNotesNavigationArgs {
  panelId: string;
  view: 'browser' | 'editor';
  currentPath: string;
  currentNote: BnFile | null;
  currentNotePath: string;
  editorIsDirty: boolean;
  setEntries: (entries: FileEntry[]) => void;
  setCurrentPath: (path: string) => void;
  setView: (view: 'browser' | 'editor') => void;
  setCurrentNote: (note: BnFile) => void;
  setCurrentNotePath: (path: string) => void;
  setFileError: (msg: string | null) => void;
  setRenameEntry: (entry: FileEntry | null) => void;
  handleSaveNote: () => void;
}

interface NotesNavigationApi {
  loadDirectory: (path: string) => Promise<void>;
  handleOpenNote: (relativePath: string) => Promise<void>;
  handleBreadcrumbNavigate: (path: string) => void;
  buildBreadcrumbs: () => BreadcrumbSegment[];
  buildEditorBreadcrumbs: () => BreadcrumbSegment[];
  requestRenameCurrentNote: () => void;
  handlePopOut: () => void;
}

/**
 * Folder/note navigation, breadcrumb building, and the small
 * editor-only helpers (rename-current-note, pop-out) that sit alongside.
 */
export function useNotesNavigation(args: UseNotesNavigationArgs): NotesNavigationApi {
  const {
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
  } = args;

  const loadDirectory = useCallback(async (relativePath: string) => {
    try {
      const items = await fileNotesAPI.listDirectory(relativePath);
      setEntries(items);
      setCurrentPath(relativePath);
      setView('browser');
    } catch (err: unknown) {
      setFileError(`Failed to load directory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [setEntries, setCurrentPath, setView, setFileError]);

  const handleOpenNote = useCallback(async (relativePath: string) => {
    try {
      const note = await fileNotesAPI.readNote(relativePath);
      if (note) {
        setCurrentNote(note);
        setCurrentNotePath(relativePath);
        setView('editor');
        useNoteEditorStore.getState().resetContent(note.content || ''); // allow-getstate: open-note async callback - imperative store reset outside render
        useFileNotesStore.getState().addRecentFile(relativePath, note.title); // allow-getstate: open-note async callback - imperative store update outside render
      }
    } catch (err: unknown) {
      setFileError(`Failed to open note: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [setCurrentNote, setCurrentNotePath, setView, setFileError]);

  const handleBreadcrumbNavigate = useCallback((navPath: string) => {
    if (view === 'editor' && editorIsDirty) {
      handleSaveNote();
    }
    loadDirectory(navPath);
  }, [view, editorIsDirty, handleSaveNote, loadDirectory]);

  const buildBreadcrumbs = useCallback((): BreadcrumbSegment[] => {
    const segments: BreadcrumbSegment[] = [{ label: 'Home', path: '' }];
    if (!currentPath) return segments;
    const normalizedPath = currentPath.replace(/\\/g, '/');
    const parts = normalizedPath.split('/').filter(Boolean);
    let accumulated = '';
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      segments.push({ label: part, path: accumulated });
    }
    return segments;
  }, [currentPath]);

  const buildEditorBreadcrumbs = useCallback((): BreadcrumbSegment[] => {
    const base = buildBreadcrumbs();
    if (currentNote) {
      base.push({ label: currentNote.title, path: currentNotePath });
    }
    return base;
  }, [buildBreadcrumbs, currentNote, currentNotePath]);

  const requestRenameCurrentNote = useCallback(() => {
    // Verse notes derive their title from the linked verse reference (see
    // BibleNotesFileService.createVerseNote) - renaming is blocked here as
    // defense-in-depth even though the UI also hides the affordance.
    if (currentNote && currentNote.type !== 'verse_note') {
      setRenameEntry({
        name: currentNote.title,
        path: currentNotePath,
        isDirectory: false,
        modified: currentNote.updated || '',
      });
    }
  }, [currentNote, currentNotePath, setRenameEntry]);

  const handlePopOut = useCallback(async () => {
    if (!currentNote) return;
    try {
      // Same detach path as DockviewTabRenderer's "Pop Out to Window" context
      // menu item: 'verse-notes' is the registered PaneType (electron/config/
      // paneConfig.ts) whose component is UserNotesPane; the initial-state
      // shape must match what UserNotesPane/useNotesInit reads back
      // (initialView / initialCurrentPath / initialCurrentNotePath).
      const result = await window.electron.window.detachPane('verse-notes', {
        initialView: view,
        initialCurrentPath: currentPath,
        initialCurrentNotePath: currentNotePath,
      });
      if (!result.success) {
        setFileError(`Failed to pop out note: ${result.error || 'Unknown error'}`);
        return;
      }
      // Signal this in-place pane to exit editor mode so the note isn't being
      // edited in two windows at once (see usePopOutListener).
      window.dispatchEvent(new CustomEvent('notes-pane-popped-out', { detail: { panelId } }));
    } catch (err: unknown) {
      setFileError(`Failed to pop out note: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [currentNote, view, currentPath, currentNotePath, panelId, setFileError]);

  return {
    loadDirectory,
    handleOpenNote,
    handleBreadcrumbNavigate,
    buildBreadcrumbs,
    buildEditorBreadcrumbs,
    requestRenameCurrentNote,
    handlePopOut,
  };
}
