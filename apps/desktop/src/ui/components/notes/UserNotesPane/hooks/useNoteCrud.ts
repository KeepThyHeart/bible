import { useCallback } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { FileEntry, BnFile } from '../../../../services/fileNotesAPI';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';

interface UseNoteCrudArgs {
  currentPath: string;
  currentNotePath: string;
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
        setShowNewNoteDialog(false);
      } catch (err: unknown) {
        setFileError(`Failed to create note: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [currentPath, setCurrentNote, setCurrentNotePath, setView, setShowNewNoteDialog, setFileError]
  );

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
        await fileNotesAPI.renameEntry(entry.path, newRelPath);
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
      if (!currentNotePath) return;
      try {
        const fileName = currentNotePath.split(/[/\\]/).pop() || '';
        const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
        await fileNotesAPI.renameEntry(currentNotePath, newPath);
        setCurrentNotePath(newPath);
        setCurrentPath(targetFolder);
        setShowMoveDialog(false);
      } catch (err: unknown) {
        setFileError(`Failed to move: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [currentNotePath, setCurrentNotePath, setCurrentPath, setShowMoveDialog, setFileError]
  );

  const handleMoveEntry = useCallback(
    async (entry: FileEntry, targetFolder: string) => {
      try {
        const fileName = entry.path.split(/[/\\]/).pop() || entry.name;
        const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
        await fileNotesAPI.renameEntry(entry.path, newPath);
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
