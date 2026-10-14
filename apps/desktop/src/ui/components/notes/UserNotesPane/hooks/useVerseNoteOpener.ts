import { useCallback, useEffect, type MutableRefObject } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { BnFile } from '../../../../services/fileNotesAPI';
import { useFileNotesStore } from '../../../../stores/useFileNotesStore';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { parseVerseId, getBookNameFromCache } from '../../../../utils/verseReference';
import { VERSE_NOTES_FOLDER } from '../utils';

interface UseVerseNoteOpenerArgs {
  currentVerseId: number | undefined;
  setCurrentNote: (note: BnFile) => void;
  setCurrentNotePath: (path: string) => void;
  setCurrentPath: (path: string) => void;
  setView: (view: 'browser' | 'editor') => void;
  setFileError: (msg: string | null) => void;
  /** False until the pane has finished its startup restore and notes-folder setup. Default: ready. */
  ready?: boolean;
  /** Remembers a request that arrived before the pane was ready. */
  pendingRef?: MutableRefObject<boolean>;
}

/**
 * Opens (creating if needed) the verse note for the currently-selected verse,
 * and listens for the `open-verse-note` window event from the Bible pane.
 */
export function useVerseNoteOpener(args: UseVerseNoteOpenerArgs): { handleOpenVerseNote: () => Promise<void> } {
  const { currentVerseId, setCurrentNote, setCurrentNotePath, setCurrentPath, setView, setFileError, ready = true, pendingRef } = args;

  const handleOpenVerseNote = useCallback(async () => {
    if (!currentVerseId) return;
    if (!ready && pendingRef) {
      // The pane is still starting (new pane, or the folder-setup dialog is
      // showing): run this once it is ready instead of racing the startup.
      pendingRef.current = true;
      return;
    }
    const { bookNumber, chapter, verse } = parseVerseId(currentVerseId);
    const bookName = getBookNameFromCache(bookNumber);
    try {
      const result = await fileNotesAPI.createVerseNote(bookName, chapter, verse, currentVerseId);
      setCurrentNote(result.note);
      setCurrentNotePath(result.relativePath);
      setCurrentPath(`${VERSE_NOTES_FOLDER}/${bookName}/${chapter}`);
      setView('editor');
      useNoteEditorStore.getState().resetContent(result.note.content || ''); // allow-getstate: async event-handler callback - imperative store reset outside render
      useFileNotesStore.getState().addRecentFile(result.relativePath, result.note.title); // allow-getstate: async event-handler callback - imperative store update outside render
    } catch (err: unknown) {
      setFileError(`Failed to open verse note: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [currentVerseId, ready, pendingRef, setCurrentNote, setCurrentNotePath, setCurrentPath, setView, setFileError]);

  useEffect(() => {
    if (ready && pendingRef?.current) {
      pendingRef.current = false;
      void handleOpenVerseNote();
    }
  }, [ready, pendingRef, handleOpenVerseNote]);

  useEffect(() => {
    const handler = () => { handleOpenVerseNote(); };
    window.addEventListener('open-verse-note', handler);
    return () => window.removeEventListener('open-verse-note', handler);
  }, [handleOpenVerseNote]);

  return { handleOpenVerseNote };
}
