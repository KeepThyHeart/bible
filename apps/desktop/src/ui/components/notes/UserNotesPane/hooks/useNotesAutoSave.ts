import { useEffect, useRef } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { BnFile } from '../../../../services/fileNotesAPI';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { useToastStore } from '../../../../stores/useToastStore';
import { isAbsolutePath } from '../utils';

interface UseNotesAutoSaveArgs {
  view: 'browser' | 'editor';
  currentNote: BnFile | null;
  currentNotePath: string;
  setCurrentNote: (note: BnFile) => void;
  setIsSaving: (saving: boolean) => void;
}

/**
 * Auto-save the active note every 5 seconds while the editor view is open,
 * and flush any dirty content immediately when the editor unmounts (navigate
 * away, tab switch, etc.). Mirrors the original inline effect 1:1.
 */
export function useNotesAutoSave({
  view,
  currentNote,
  currentNotePath,
  setCurrentNote,
  setIsSaving,
}: UseNotesAutoSaveArgs): void {
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (view === 'editor' && currentNote && currentNotePath) {
      autoSaveTimerRef.current = setInterval(async () => {
        // allow-getstate: setInterval tick - must read latest store state imperatively
        const store = useNoteEditorStore.getState();
        if (store.isDirty) {
          setIsSaving(true);
          try {
            const updatedNote: BnFile = {
              ...currentNote,
              content: store.content,
            };
            // The main process regenerates `updated` and returns the real
            // written value - use that as the new baseline, not a client-side
            // guess. Autosave has no `expectedUpdated` (it force-overwrites),
            // but the baseline it leaves behind still matters: a stale guess
            // here would make the *next* manual Ctrl+S mismatch the disk and
            // falsely report a conflict.
            const savedUpdated = isAbsolutePath(currentNotePath)
              ? await fileNotesAPI.saveNoteAbsolute(currentNotePath, updatedNote)
              : await fileNotesAPI.saveNote(currentNotePath, updatedNote);
            setCurrentNote({ ...updatedNote, updated: savedUpdated });
            store.markSaved();
          } catch (err: unknown) {
            console.error('Auto-save failed:', err);
            useToastStore
              .getState() // allow-getstate: setInterval tick error path - imperative toast dispatch outside render
              .addToast('Failed to save note. Your changes may be lost.', 'error');
          } finally {
            setIsSaving(false);
          }
        }
      }, 5000);

      return () => {
        if (autoSaveTimerRef.current) {
          clearInterval(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        // Save any dirty content immediately on cleanup
        // allow-getstate: effect cleanup - imperative flush of latest store state on unmount
        const store = useNoteEditorStore.getState();
        if (store.isDirty && currentNote && currentNotePath) {
          const updatedNote: BnFile = {
            ...currentNote,
            content: store.content,
          };
          const savePath = currentNotePath;
          // Fire-and-forget (this cleanup can't be async), but still route the
          // main process's authoritative `updated` back into currentNote so a
          // note reopened in this window afterward has a correct baseline -
          // see the interval branch above for why a client-side guess is
          // wrong here.
          const savePromise = isAbsolutePath(savePath)
            ? fileNotesAPI.saveNoteAbsolute(savePath, updatedNote)
            : fileNotesAPI.saveNote(savePath, updatedNote);
          savePromise
            .then(savedUpdated => {
              setCurrentNote({ ...updatedNote, updated: savedUpdated });
            })
            .catch(err => {
              console.error('Final save on navigate-away failed:', err);
            });
          store.markSaved();
        }
      };
    }
    return undefined;
  }, [view, currentNotePath]); // eslint-disable-line react-hooks/exhaustive-deps
}
