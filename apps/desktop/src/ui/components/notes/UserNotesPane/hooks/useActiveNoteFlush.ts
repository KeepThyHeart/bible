import { useEffect } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { BnFile } from '../../../../services/fileNotesAPI';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import {
  registerActiveNoteFlush,
  clearActiveNoteFlush,
} from '../../../../services/activeNoteFlush';
import { isAbsolutePath } from '../utils';

interface UseActiveNoteFlushArgs {
  view: 'browser' | 'editor';
  currentNote: BnFile | null;
  currentNotePath: string;
  setCurrentNote: (note: BnFile) => void;
}

/**
 * Guarantee an in-progress note edit reaches disk when the window closes.
 *
 * The main-process close handler destroys the renderer immediately after the
 * `session:save-requested` IPC replies, so `useNotesAutoSave`'s save-on-unmount
 * cleanup never runs during a real quit. This hook registers a flush callback
 * (consumed by `registerSaveBeforeCloseHandler`, awaited before that IPC replies)
 * and also fires it on `beforeunload`, mirroring `useSessionAutoSave`.
 */
export function useActiveNoteFlush({
  view,
  currentNote,
  currentNotePath,
  setCurrentNote,
}: UseActiveNoteFlushArgs): void {
  useEffect(() => {
    const flush = async (): Promise<void> => {
      if (view !== 'editor' || !currentNote || !currentNotePath) return;
      // allow-getstate: shutdown flush - imperative read of latest editor state
      const store = useNoteEditorStore.getState();
      if (!store.isDirty) return;

      const updatedNote: BnFile = {
        ...currentNote,
        content: store.content,
      };
      // See useNotesAutoSave for why the baseline must come from the main
      // process's returned value rather than a client-side timestamp guess.
      const savedUpdated = isAbsolutePath(currentNotePath)
        ? await fileNotesAPI.saveNoteAbsolute(currentNotePath, updatedNote)
        : await fileNotesAPI.saveNote(currentNotePath, updatedNote);
      setCurrentNote({ ...updatedNote, updated: savedUpdated });
      store.markSaved();
    };

    registerActiveNoteFlush(flush);

    // Best-effort flush when the window unloads, mirroring useSessionAutoSave.
    const onBeforeUnload = (): void => {
      void flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearActiveNoteFlush(flush);
    };
  }, [view, currentNote, currentNotePath, setCurrentNote]);
}
