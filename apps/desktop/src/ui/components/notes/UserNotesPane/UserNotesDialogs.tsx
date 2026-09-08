import React from 'react';
import { useI18n } from '../../../contexts/useI18n';
import { FileEntry } from '../../../services/fileNotesAPI';
import TextInputDialog from '../../TextInputDialog';
import NewNoteDialog from '../NewNoteDialog';
import MoveToFolderDialog from './MoveToFolderDialog';

interface UserNotesDialogsProps {
  // New note
  showNewNoteDialog: boolean;
  setShowNewNoteDialog: (open: boolean) => void;
  onCreateNote: (title: string, templateContent?: string) => void;

  // New folder
  showNewFolderDialog: boolean;
  setShowNewFolderDialog: (open: boolean) => void;
  onCreateFolder: (name: string) => void;

  // Rename
  renameEntry: FileEntry | null;
  setRenameEntry: (entry: FileEntry | null) => void;
  onRename: (entry: FileEntry, newName: string) => void;

  // Move - two ways in, one dialog. `showMoveDialog` is the editor sidebar's
  // "move the note I have open"; `moveEntry` is the browser context menu's
  // "move this one". They are mutually exclusive by construction: each entry
  // point sets its own state and clears it on close.
  showMoveDialog: boolean;
  setShowMoveDialog: (open: boolean) => void;
  moveEntry: FileEntry | null;
  setMoveEntry: (entry: FileEntry | null) => void;
  onMoveEntry: (entry: FileEntry, targetFolder: string) => void;
  moveFolders: string[];
  currentPath: string;
  onMoveCurrentNote: (targetFolder: string) => void;
}

/**
 * All modal dialogs owned by the UserNotesPane, grouped together so the
 * top-level component can stay a thin layout/composition.
 */
const UserNotesDialogs: React.FC<UserNotesDialogsProps> = ({
  showNewNoteDialog,
  setShowNewNoteDialog,
  onCreateNote,
  showNewFolderDialog,
  setShowNewFolderDialog,
  onCreateFolder,
  renameEntry,
  setRenameEntry,
  onRename,
  showMoveDialog,
  setShowMoveDialog,
  moveEntry,
  setMoveEntry,
  onMoveEntry,
  moveFolders,
  currentPath,
  onMoveCurrentNote,
}) => {
  const { t } = useI18n();

  const closeMoveDialog = (): void => {
    setShowMoveDialog(false);
    setMoveEntry(null);
  };

  return (
    <>
      <NewNoteDialog
        isOpen={showNewNoteDialog}
        onConfirm={(title, templateContent) => onCreateNote(title, templateContent)}
        onCancel={() => setShowNewNoteDialog(false)}
      />

      <TextInputDialog
        isOpen={showNewFolderDialog}
        title={t('userNotesPane.newFolderDialogTitle')}
        label={t('userNotesPane.folderNameLabel')}
        placeholder={t('userNotesPane.folderNamePlaceholder')}
        onConfirm={onCreateFolder}
        onCancel={() => setShowNewFolderDialog(false)}
      />

      <TextInputDialog
        isOpen={!!renameEntry}
        title={`Rename ${renameEntry?.isDirectory ? 'Folder' : 'Note'}`}
        label={t('userNotesPane.newNameLabel')}
        initialValue={renameEntry?.name ?? ''}
        onConfirm={(newName) => { if (renameEntry) onRename(renameEntry, newName); }}
        onCancel={() => setRenameEntry(null)}
      />

      <MoveToFolderDialog
        isOpen={showMoveDialog || moveEntry !== null}
        folders={moveFolders}
        currentPath={currentPath}
        subjectName={moveEntry?.name}
        onMove={folder => {
          // `onMoveCurrentNote` closes the dialog itself (it also has to move
          // the editor's idea of where the open note lives); the entry path
          // does not, so it is closed here.
          if (moveEntry) {
            onMoveEntry(moveEntry, folder);
            setMoveEntry(null);
            return;
          }
          onMoveCurrentNote(folder);
        }}
        onCancel={closeMoveDialog}
      />
    </>
  );
};

export default UserNotesDialogs;
