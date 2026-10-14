import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { BnFile } from '../../../../services/fileNotesAPI';
import { useFileNotesStore } from '../../../../stores/useFileNotesStore';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { parseVerseId, getBookNameFromCache } from '../../../../utils/verseReference';
import { VERSE_NOTES_FOLDER } from '../utils';
import { consumeVerseNoteRequest, claimRecentVerseNoteRequest } from '../verseNoteRequest';

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
export function useVerseNoteOpener(args: UseVerseNoteOpenerArgs): { handleOpenVerseNote: (verseId?: number) => Promise<void> } {
  const { currentVerseId, setCurrentNote, setCurrentNotePath, setCurrentPath, setView, setFileError, ready = true, pendingRef } = args;

  // The verse the event asked for. The pane's own currentVerseId may still be
  // the previous verse when the event fires (the sync re-renders after it).
  const pendingVerseRef = useRef<number | undefined>(undefined);

  const handleOpenVerseNote = useCallback(async (requestedVerseId?: number) => {
    consumeVerseNoteRequest();
    const verseIdToOpen = requestedVerseId ?? currentVerseId;
    if (!verseIdToOpen) return;
    if (!ready && pendingRef) {
      pendingVerseRef.current = verseIdToOpen;
      // The pane is still starting (new pane, or the folder-setup dialog is
      // showing): run this once it is ready instead of racing the startup.
      pendingRef.current = true;
      return;
    }
    const { bookNumber, chapter, verse } = parseVerseId(verseIdToOpen);
    const bookName = getBookNameFromCache(bookNumber);
    try {
      const result = await fileNotesAPI.createVerseNote(bookName, chapter, verse, verseIdToOpen);
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
      void handleOpenVerseNote(pendingVerseRef.current);
    }
  }, [ready, pendingRef, handleOpenVerseNote]);

  useEffect(() => {
    // A request made by the gesture that created this pane, before this listener existed.
    const early = claimRecentVerseNoteRequest();
    if (early !== undefined) {
      pendingVerseRef.current = early;
      if (pendingRef) pendingRef.current = true;
      if (ready || !pendingRef) void handleOpenVerseNote(early);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ verseId?: number } | undefined>).detail;
      void handleOpenVerseNote(detail?.verseId);
    };
    window.addEventListener('open-verse-note', handler);
    return () => window.removeEventListener('open-verse-note', handler);
  }, [handleOpenVerseNote]);

  return { handleOpenVerseNote };
}
