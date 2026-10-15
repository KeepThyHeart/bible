import { useEffect, useRef } from 'react';
import { BnFile } from '../../../../services/fileNotesAPI';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { useToastStore } from '../../../../stores/useToastStore';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { isAbsolutePath } from '../utils';
import { saveWithBaseline, staleSaveKind, saveConflictCopy, CONFLICT_MESSAGE, MISSING_MESSAGE } from './noteSave';

interface UseNotesAutoSaveArgs {
  view: 'browser' | 'editor';
  currentNote: BnFile | null;
  currentNotePath: string;
  setCurrentNote: (note: BnFile) => void;
  setIsSaving: (saving: boolean) => void;
  /** Shows the pane's error banner (stale-save refusals). */
  setFileError?: (msg: string | null) => void;
}

/**
 * Auto-save the active note every 2 seconds while the editor view is open,
 * and flush any dirty content immediately when the editor unmounts (navigate
 * away, tab switch, etc.). Mirrors the original inline effect 1:1.
 */
/** Failure while saving a note on the way out: keep both versions on a conflict, say so otherwise. */
function reportLeavingFailure(err: unknown, path: string, toSave: BnFile): void {
  const kind = staleSaveKind(err);
  const toast = (msg: string) => useToastStore.getState().addToast(msg, 'error'); // allow-getstate: async error path - imperative toast dispatch outside render
  if (kind === 'conflict') {
    saveConflictCopy(path, toSave).then(
      () => toast(`"${toSave.title}" was changed in another window. Your last edits were saved as a separate note "(unsaved changes)".`),
      () => toast('Failed to save note. Your changes may be lost.')
    );
    return;
  }
  console.error('Saving the previous note failed:', err);
  toast(kind === 'missing'
    ? `"${toSave.title}" was renamed, moved or deleted, so your last edits were not saved.`
    : 'Failed to save note. Your changes may be lost.');
}

const AUTOSAVE_MS = 2000;

export function useNotesAutoSave({
  view,
  currentNote,
  currentNotePath,
  setCurrentNote,
  setIsSaving,
  setFileError,
}: UseNotesAutoSaveArgs): void {
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSavePausedRef = useRef(false);
  const inFlightRef = useRef(false);

  // Opening or creating another note resets the shared editor store; save the
  // note being left first so its unsaved edits are not dropped.
  const leavingRef = useRef({ view, currentNote, currentNotePath });
  leavingRef.current = { view, currentNote, currentNotePath };
  useEffect(() => {
    const saver = (unsaved: string) => {
      const { view: v, currentNote: note, currentNotePath: path } = leavingRef.current;
      if (v !== 'editor' || !note || !path) return;
      const toSave: BnFile = { ...note, content: unsaved };
      saveWithBaseline(path, toSave).catch((err: unknown) => {
        reportLeavingFailure(err, path, toSave);
      });
    };
    useNoteEditorStore.getState().setBeforeReplace(saver); // allow-getstate: effect setup - register imperative saver
    return () => {
      // Clear only our own saver: a newer pane's registration must survive.
      // allow-getstate: effect cleanup
      if (useNoteEditorStore.getState()._beforeReplace === saver) useNoteEditorStore.getState().setBeforeReplace(undefined);
    };
  }, []);

  useEffect(() => {
    autoSavePausedRef.current = false;
    if (view === 'editor' && currentNote && currentNotePath) {
      const saveTick = async () => {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        try {
        // allow-getstate: setInterval tick - must read latest store state imperatively
        const store = useNoteEditorStore.getState();
        // The effect's `currentNote` goes stale after the first save; the
        // baseline (`updated`) must be the latest one.
        const latest = leavingRef.current.currentNote ?? currentNote;
        // Paused after a stale-save refusal until the user's own Save (or Save
        // As) leaves the editor clean, so the banner is not re-raised every
        // tick and nothing overwrites the other window's version meanwhile.
        if (autoSavePausedRef.current) {
          if (store.isDirty) return;
          autoSavePausedRef.current = false;
        }
        if (store.isDirty) {
          setIsSaving(true);
          try {
            const updatedNote: BnFile = {
              ...latest,
              content: store.content,
            };
            // Passes the baseline like a manual save: another window's edits
            // are never silently overwritten and a renamed or trashed note is
            // never re-created. The main process returns the real written
            // `updated`, which becomes the next baseline.
            const savedUpdated = await saveWithBaseline(currentNotePath, updatedNote);
            // The note may have been switched away while the save was in flight:
            // its result is no longer this pane's state.
            if (leavingRef.current.currentNotePath !== currentNotePath) return;
            setCurrentNote({ ...updatedNote, updated: savedUpdated });
            // Text typed during the save is still unsaved: only what was sent is clean.
            store.markSaved(updatedNote.content);
          } catch (err: unknown) {
            const kind = staleSaveKind(err);
            if (kind) {
              autoSavePausedRef.current = true;
              if (kind === 'conflict') {
                // Re-sync the baseline to what is on disk (as a manual Save does),
                // so the single "Save again" the banner asks for really overwrites.
                try {
                  const onDisk = isAbsolutePath(currentNotePath)
                    ? await fileNotesAPI.readNoteAbsolute(currentNotePath)
                    : await fileNotesAPI.readNote(currentNotePath);
                  if (onDisk) setCurrentNote({ ...latest, updated: onDisk.updated });
                } catch {
                  /* the banner still stands */
                }
              }
              setFileError?.(kind === 'conflict' ? CONFLICT_MESSAGE : MISSING_MESSAGE);
              return;
            }
            console.error('Auto-save failed:', err);
            useToastStore
              .getState() // allow-getstate: setInterval tick error path - imperative toast dispatch outside render
              .addToast('Failed to save note. Your changes may be lost.', 'error');
          } finally {
            setIsSaving(false);
          }
        }
        } finally {
          inFlightRef.current = false;
        }
      };
      autoSaveTimerRef.current = setInterval(saveTick, AUTOSAVE_MS);
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
            ...(leavingRef.current.currentNote ?? currentNote),
            content: store.content,
          };
          const savePath = currentNotePath;
          // Fire-and-forget (this cleanup can't be async), but still route the
          // main process's authoritative `updated` back into currentNote so a
          // note reopened in this window afterward has a correct baseline -
          // see the interval branch above for why a client-side guess is
          // wrong here.
          saveWithBaseline(savePath, updatedNote)
            .then(savedUpdated => {
              setCurrentNote({ ...updatedNote, updated: savedUpdated });
            })
            .catch(err => {
              reportLeavingFailure(err, savePath, updatedNote);
            });
          store.markSaved();
        }
      };
    }
    return undefined;
  }, [view, currentNotePath]); // eslint-disable-line react-hooks/exhaustive-deps
}
