import { useCallback, useRef } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { FileEntry, BnFile } from '../../../../services/fileNotesAPI';
import { useFileNotesStore } from '../../../../stores/useFileNotesStore';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { saveWithBaseline } from './noteSave';

interface UseNoteCrudArgs {
  currentPath: string;
  currentNotePath: string;
  /** The open note (its `updated` is the save baseline). */
  currentNote?: BnFile | null;
  loadDirectory: (path: string) => void;
  setCurrentNote: (note: BnFile) => void;
  setCurrentNotePath: (path: string) => void;
  setCurrentPath: (path: string) => void;
  setView: (view: 'browser' | 'editor') => void;
  setShowNewNoteDialog: (open: boolean) => void;
  setShowNewFolderDialog: (open: boolean) => void;
  setShowMoveDialog: (open: boolean) => void;
  setRenameEntry: (entry: FileEntry | null) => void;
  setFileError: (msg: string | null) => void;
}

export interface NoteCrudActions {
  handleCreateNote: (title: string, templateContent?: string) => Promise<void>;
  handleCreateFolder: (name: string) => Promise<void>;
  handleRename: (entry: FileEntry, newName: string) => Promise<void>;
  handleMoveCurrentNote: (targetFolder: string) => Promise<void>;
  handleMoveEntry: (entry: FileEntry, targetFolder: string) => Promise<void>;
  handleDelete: (entry: FileEntry) => Promise<void>;
}

/**
 * Notes-folder CRUD operations: create note/folder, rename, move (single & DnD),
 * and delete. All operations refresh the current directory listing on success.
 */
export function useNoteCrud(args: UseNoteCrudArgs): NoteCrudActions {
  const {
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
  } = args;

  const handleCreateNote = useCallback(
    async (title: string, templateContent?: string) => {
      try {
        const fileName = title.replace(/[<>:"/\\|?*]/g, '_');
        const relativePath = currentPath ? `${currentPath}/${fileName}` : fileName;
        const note = await fileNotesAPI.createNote(relativePath, title);
        if (templateContent) {
          note.content = templateContent;
          const notePath = relativePath.endsWith('.bn') ? relativePath : relativePath + '.bn';
          // Use the main process's returned timestamp as the new baseline -
          // `note.updated` from the initial createNote() is now stale since
          // this second save regenerates it again on disk.
          note.updated = await fileNotesAPI.saveNote(notePath, note);
        }
        setCurrentNote(note);
        setCurrentNotePath(relativePath.endsWith('.bn') ? relativePath : relativePath + '.bn');
        setView('editor');
        useNoteEditorStore.getState().resetContent(templateContent || ''); // allow-getstate: create-note async callback - imperative store reset outside render
        useFileNotesStore.getState().addRecentFile(relativePath.endsWith('.bn') ? relativePath : relativePath + '.bn', title); // allow-getstate: create-note async callback - imperative store update outside render
        setShowNewNoteDialog(false);
      } catch (err: unknown) {
        setFileError(`Failed to create note: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [currentPath, setCurrentNote, setCurrentNotePath, setView, setShowNewNoteDialog, setFileError]
  );

  // The handlers below are memoised on directory state only; they must see the
  // open note as it is NOW (autosave moves its baseline without changing its path).
  const openRef = useRef({ currentNotePath, currentNote });
  openRef.current = { currentNotePath, currentNote };

  const norm = (p: string) => p.replace(/\\/g, '/');
  /** Is the open note this path, or inside this folder? */
  const affectsOpenNote = (path: string) => {
    const { currentNotePath: openPath } = openRef.current;
    if (!openPath) return false;
    const open = norm(openPath);
    const p = norm(path);
    return open === p || open.startsWith(p + '/');
  };

  /**
   * Save the open note's unsaved edits at its CURRENT path before that path
   * changes or disappears, so neither the pending autosave nor the unmount
   * flush later writes to (and re-creates) the old file.
   */
  const flushOpenNoteFirst = async (): Promise<BnFile | null> => {
    const { currentNotePath: openPath, currentNote: openNote } = openRef.current;
    const store = useNoteEditorStore.getState(); // allow-getstate: async CRUD callback - imperative read of the latest editor state
    if (!openNote || !openPath) return openNote ?? null;
    if (!store.isDirty) return openNote;
    const updated = await saveWithBaseline(openPath, { ...openNote, content: store.content });
    const saved = { ...openNote, content: store.content, updated };
    setCurrentNote(saved);
    store.markSaved();
    return saved;
  };

  /** After a rename/move succeeded on disk: follow it with the open note and Recent. */
  const followRename = async (oldPath: string, newPath: string, isDirectory: boolean, openNote: BnFile | null) => {
    const base = (p: string) => norm(p).split('/').pop() || '';
    const retitle = !isDirectory && base(oldPath) !== base(newPath) ? base(newPath).replace(/\.bn$/, '') : undefined;
    useFileNotesStore.getState().remapRecentPaths(oldPath, newPath, retitle); // allow-getstate: async CRUD callback - imperative store update
    if (!affectsOpenNote(oldPath)) return;
    const open = norm(openRef.current.currentNotePath);
    const nextOpen = norm(newPath) + open.slice(norm(oldPath).length);
    setCurrentNotePath(nextOpen);
    if (retitle !== undefined && open === norm(oldPath) && openNote) {
      // The main process re-titled the file and kept `updated`.
      setCurrentNote({ ...openNote, title: retitle });
    }
  };

  const handleCreateFolder = useCallback(
    async (name: string) => {
      try {
        const folderName = name.replace(/[<>:"/\\|?*]/g, '_');
        const relativePath = currentPath ? `${currentPath}/${folderName}` : folderName;
        await fileNotesAPI.createFolder(relativePath);
        loadDirectory(currentPath);
        setShowNewFolderDialog(false);
      } catch (err: unknown) {
        setFileError(`Failed to create folder: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [currentPath, loadDirectory, setShowNewFolderDialog, setFileError]
  );

  const handleRename = useCallback(
    async (entry: FileEntry, newName: string) => {
      try {
        const cleanName = newName.replace(/[<>:"/\\|?*]/g, '_');
        const parts = entry.path.split(/[/\\]/);
        parts.pop();
        const parentPath = parts.join('/');
        const newExt = entry.isDirectory ? '' : '.bn';
        const newRelPath = parentPath
          ? `${parentPath}/${cleanName}${newExt}`
          : `${cleanName}${newExt}`;
        const openNote = affectsOpenNote(entry.path) ? await flushOpenNoteFirst() : null;
        await fileNotesAPI.renameEntry(entry.path, newRelPath);
        await followRename(entry.path, newRelPath, entry.isDirectory, openNote);
        loadDirectory(currentPath);
        setRenameEntry(null);
      } catch (err: unknown) {
        setFileError(`Failed to rename: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [currentPath, loadDirectory, setRenameEntry, setFileError]
  );

  const handleMoveCurrentNote = useCallback(
    async (targetFolder: string) => {
      const openPath = openRef.current.currentNotePath;
      if (!openPath) return;
      try {
        const fileName = openPath.split(/[/\\]/).pop() || '';
        const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
        const openNote = await flushOpenNoteFirst();
        await fileNotesAPI.renameEntry(openPath, newPath);
        await followRename(openPath, newPath, false, openNote);
        setCurrentPath(targetFolder);
        setShowMoveDialog(false);
      } catch (err: unknown) {
        setFileError(`Failed to move: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [setCurrentNotePath, setCurrentPath, setShowMoveDialog, setFileError]
  );

  const handleMoveEntry = useCallback(
    async (entry: FileEntry, targetFolder: string) => {
      try {
        const fileName = entry.path.split(/[/\\]/).pop() || entry.name;
        const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
        const openNote = affectsOpenNote(entry.path) ? await flushOpenNoteFirst() : null;
        await fileNotesAPI.renameEntry(entry.path, newPath);
        await followRename(entry.path, newPath, entry.isDirectory, openNote);
        loadDirectory(currentPath);
      } catch (err: unknown) {
        setFileError(`Failed to move: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [currentPath, loadDirectory, setFileError]
  );

  const handleDelete = useCallback(
    async (entry: FileEntry) => {
      try {
        await fileNotesAPI.deleteEntry(entry.path);
        useFileNotesStore.getState().removeRecentUnder(entry.path); // allow-getstate: async CRUD callback - imperative store update
        loadDirectory(currentPath);
      } catch (err: unknown) {
        setFileError(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [currentPath, loadDirectory, setFileError]
  );

  return {
    handleCreateNote,
    handleCreateFolder,
    handleRename,
    handleMoveCurrentNote,
    handleMoveEntry,
    handleDelete,
  };
}
