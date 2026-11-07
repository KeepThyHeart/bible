import { useEffect, useRef } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import type { BnFile, NoteSavedEvent } from '../../../../services/fileNotesAPI';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { isAbsolutePath } from '../utils';
import { CONFLICT_MESSAGE, MISSING_MESSAGE, markNoteConflict, clearNoteConflict, isSaveInFlight } from './noteSave';

/** Compare-friendly form of a path: forward slashes, no trailing slash, lower-cased for Windows drive paths. */
export function normalizeNotePath(p: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(slashed) ? slashed.toLowerCase() : slashed;
}

interface Args {
  view: string;
  currentNote: BnFile | null;
  currentNotePath: string;
  setCurrentNote: (note: BnFile) => void;
  setFileError: (msg: string | null) => void;
}

/**
 * Keeps the open note in step with saves made in OTHER windows (main window or
 * pop-out). The main process pushes `file-notes:note-saved` to every window except
 * the saver, so this never sees its own save.
 *
 * - editor clean: the saved copy is read and loaded into the editor (caret and
 *   scroll kept by `reloadExternal`);
 * - editor dirty, or a save of ours in flight: the "changed in another window"
 *   banner is shown at once and nothing is overwritten.
 */
export function useNoteSavedListener(args: Args): void {
  const { view, currentNote, currentNotePath, setCurrentNote, setFileError } = args;
  const ref = useRef({ view, currentNote, currentNotePath, setCurrentNote, setFileError });
  ref.current = { view, currentNote, currentNotePath, setCurrentNote, setFileError };
  const latestUpdated = useRef('');
  const notesDirRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    const absoluteOf = async (path: string): Promise<string> => {
      if (isAbsolutePath(path)) return path;
      notesDirRef.current ??= fileNotesAPI.getNotesDir();
      const dir = await notesDirRef.current;
      return `${dir.replace(/[\\/]+$/, '')}/${path}`;
    };

    const conflict = (path: string): void => {
      markNoteConflict(path);
      ref.current.setFileError(CONFLICT_MESSAGE);
    };
    const isDirty = (): boolean => useNoteEditorStore.getState().isDirty; // allow-getstate: event handler, not render

    const onSaved = async (event: NoteSavedEvent): Promise<void> => {
      const start = ref.current;
      const path = start.currentNotePath;
      if (start.view !== 'editor' || !start.currentNote || !path) return;
      try {
        if (normalizeNotePath(await absoluteOf(path)) !== normalizeNotePath(event.absolutePath)) return;
      } catch {
        return;
      }
      if (ref.current.currentNotePath !== path || !ref.current.currentNote) return;
      if (event.updated === ref.current.currentNote.updated) return; // already have it
      if (event.updated > latestUpdated.current) latestUpdated.current = event.updated;

      if (isDirty() || isSaveInFlight(path)) {
        conflict(path);
        return;
      }

      try {
        const note = isAbsolutePath(path) ? await fileNotesAPI.readNoteAbsolute(path) : await fileNotesAPI.readNote(path);
        const now = ref.current;
        if (now.currentNotePath !== path || !now.currentNote) return; // another note was opened meanwhile
        if (!note) {
          now.setFileError(MISSING_MESSAGE);
          return;
        }
        if (isDirty() || isSaveInFlight(path)) {
          conflict(path);
          return;
        }
        // Stale read: a newer copy is already applied or is on its way.
        if (note.updated <= now.currentNote.updated || note.updated < latestUpdated.current) return;
        useNoteEditorStore.getState().reloadExternal(note.content || ''); // allow-getstate: event handler, not render
        ref.current.currentNote = note;
        now.setCurrentNote(note);
        clearNoteConflict(path);
        now.setFileError(null);
      } catch (err: unknown) {
        ref.current.setFileError(`Could not refresh this note: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    return fileNotesAPI.onNoteSaved((e) => { void onSaved(e); });
  }, []);
}
