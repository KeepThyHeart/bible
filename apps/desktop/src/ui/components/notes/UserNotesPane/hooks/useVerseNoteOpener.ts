import { useCallback, useEffect } from 'react';
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
}

/**
 * Opens (creating if needed) the verse note for the currently-selected verse,
 * and listens for the `open-verse-note` window event from the Bible pane.
 */
export function useVerseNoteOpener(args: UseVerseNoteOpenerArgs): { handleOpenVerseNote: () => Promise<void> } {
  const { currentVerseId, setCurrentNote, setCurrentNotePath, setCurrentPath, setView, setFileError } = args;

  const handleOpenVerseNote = useCallback(async () => {
    if (!currentVerseId) return;
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
  }, [currentVerseId, setCurrentNote, setCurrentNotePath, setCurrentPath, setView, setFileError]);

  useEffect(() => {
    const handler = () => { handleOpenVerseNote(); };
    window.addEventListener('open-verse-note', handler);
    return () => window.removeEventListener('open-verse-note', handler);
  }, [handleOpenVerseNote]);

  return { handleOpenVerseNote };
}
