import { useCallback } from 'react';
import { useI18n } from '../../../../contexts/useI18n';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { FileEntry, BnFile } from '../../../../services/fileNotesAPI';
import { useFileNotesStore, type NotesPanelView } from '../../../../stores/useFileNotesStore';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { BreadcrumbSegment } from '../../NotesBreadcrumb';
import { isDraftNote } from '../draftNote';
import type { ChapterModeNavState } from '../../../../stores/notesChapterNavState';
import { chapterTitle } from '../../chapter/chapterTitle';

interface UseNotesNavigationArgs {
  panelId: string;
  view: NotesPanelView;
  /** Chapter mode position, sent with a pop-out from the chapter view. */
  chapter?: ChapterModeNavState | null;
  /** Saves the chapter view's open editor; awaited before a pop-out. */
  flushChapter?: () => Promise<void>;
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
  handleSaveNote: () => void | Promise<void>;
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

/** The folder part of a notes-relative path ('' for the notes root). */
export function folderOfNotePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const i = normalized.lastIndexOf('/');
  return i < 0 ? '' : normalized.slice(0, i);
}

/**
 * Folder/note navigation, breadcrumb building, and the small
 * editor-only helpers (rename-current-note, pop-out) that sit alongside.
 */
export function useNotesNavigation(args: UseNotesNavigationArgs): NotesNavigationApi {
  const { t } = useI18n();
  const {
    panelId,
    view,
    chapter,
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
    // Re-opening the note already open with unsaved edits: keep the editor as it
    // is. Reading the disk copy would replace the edits with stale text.
    if (view === 'editor' && editorIsDirty && relativePath === currentNotePath) return;
    try {
      const note = await fileNotesAPI.readNote(relativePath);
      if (note) {
        setFileError(null); // B-144: a banner about the previous note does not follow us here
        setCurrentNote(note);
        setCurrentNotePath(relativePath);
        // The breadcrumb shows the folder the note lives in, wherever the request came from
        // (a compiled note lands at the notes root while the pane may sit in Verse Notes/...).
        setCurrentPath(folderOfNotePath(relativePath));
        setView('editor');
        useNoteEditorStore.getState().resetContent(note.content || ''); // allow-getstate: open-note async callback - imperative store reset outside render
        useFileNotesStore.getState().addRecentFile(relativePath, note.title); // allow-getstate: open-note async callback - imperative store update outside render
      } else {
        // The file exists but is not a readable .bn (truncated JSON, plain text): say so instead of doing nothing
        // (B-084). The file is left untouched; its .bak, if any, sits beside it.
        setFileError(`This note could not be read (the file is not valid .bn data): ${relativePath}. The file was not changed; a .bak copy next to it may hold an earlier version.`);
      }
    } catch (err: unknown) {
      setFileError(`Failed to open note: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [view, editorIsDirty, currentNotePath, setCurrentNote, setCurrentNotePath, setCurrentPath, setView, setFileError]);

  const handleBreadcrumbNavigate = useCallback((navPath: string) => {
    if (view === 'editor' && editorIsDirty) {
      handleSaveNote();
    }
    loadDirectory(navPath);
  }, [view, editorIsDirty, handleSaveNote, loadDirectory]);

  const buildBreadcrumbs = useCallback((): BreadcrumbSegment[] => {
    const segments: BreadcrumbSegment[] = [{ label: t('userNotesPane.breadcrumbHome'), path: '' }];
    if (!currentPath) return segments;
    const normalizedPath = currentPath.replace(/\\/g, '/');
    const parts = normalizedPath.split('/').filter(Boolean);
    let accumulated = '';
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      segments.push({ label: part, path: accumulated });
    }
    return segments;
  }, [currentPath, t]);

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
    const inChapter = view === 'chapter' && !!chapter;
    if (!inChapter && !currentNote) return;
    try {
      if (inChapter) await flushChapter?.();
      // A draft with text gets its file first, so the new window opens the saved
      // note; an empty draft is passed on as a path and reopens as a draft there.
      if (!inChapter && currentNote && isDraftNote(currentNote) && editorIsDirty) await handleSaveNote();
      // Same detach path as DockviewTabRenderer's "Pop Out to Window" context
      // menu item: 'verse-notes' is the registered PaneType (electron/config/
      // paneConfig.ts) whose component is UserNotesPane; the initial-state
      // shape must match what UserNotesPane/useNotesInit reads back
      // (initialView / initialCurrentPath / initialCurrentNotePath).
      const result = await window.electron.window.detachPane('verse-notes', {
        initialView: view,
        initialCurrentPath: currentPath,
        initialCurrentNotePath: currentNotePath,
        // Chapter view: the window opens on the same chapter and is titled with it.
        ...(inChapter && chapter ? { initialChapter: chapter, noteName: chapterTitle(chapter) } : {}),
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
  }, [currentNote, view, chapter, flushChapter, currentPath, currentNotePath, panelId, editorIsDirty, handleSaveNote, setFileError]);

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
