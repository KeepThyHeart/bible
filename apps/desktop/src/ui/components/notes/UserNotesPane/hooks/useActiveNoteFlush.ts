import { useEffect } from 'react';
import { BnFile } from '../../../../services/fileNotesAPI';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import {
  registerActiveNoteFlush,
  clearActiveNoteFlush,
} from '../../../../services/activeNoteFlush';
import { saveWithBaseline, staleSaveKind, saveConflictCopy } from './noteSave';

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
      try {
        const savedUpdated = await saveWithBaseline(currentNotePath, updatedNote);
        setCurrentNote({ ...updatedNote, updated: savedUpdated });
        store.markSaved();
      } catch (err: unknown) {
        // Another window changed the note, or it was renamed/moved/trashed:
        // leave both versions alone rather than overwrite or re-create. Must
        // not throw - this runs while the window is closing.
        const kind = staleSaveKind(err);
        if (!kind) throw err;
        console.warn('Skipped saving the active note on close (changed elsewhere):', err);
        // Keep the text next to the other version instead of losing it.
        if (kind === 'conflict') await saveConflictCopy(currentNotePath, updatedNote).catch(() => undefined);
      }
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
