import { useCallback, useRef } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { BnFile } from '../../../../services/fileNotesAPI';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { useFileNotesStore } from '../../../../stores/useFileNotesStore';
import { htmlToMarkdown } from '../../../../utils/exportNote';
import { sanitizeHtml } from '../../../../utils/sanitize';
import { IpcResultError, unwrap } from '../../../../services/ipcResult';
import { escapeHtmlText, isAbsolutePath } from '../utils';

interface UseNoteFileActionsArgs {
  currentNote: BnFile | null;
  currentNotePath: string;
  editorContent: string;
  setCurrentNote: (note: BnFile) => void;
  setCurrentNotePath: (path: string) => void;
  setView: (view: 'browser' | 'editor') => void;
  setIsSaving: (saving: boolean) => void;
  setFileError: (msg: string | null) => void;
}

export interface NoteFileActions {
  handleSaveNote: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handlePrint: () => void;
  handleExportPdf: () => Promise<void>;
  handleExportMarkdown: () => Promise<void>;
  handleExportDocx: () => Promise<void>;
  handleOpenFile: () => Promise<void>;
  handleOpenInExplorer: (relativePath?: string) => Promise<void>;
}

/**
 * The note as a standalone HTML document: sanitized body, print stylesheet,
 * restrictive CSP.
 *
 * Printing and PDF export are the same page through two different exits, so
 * they build it once here. (The main process injects the CSP again on its own
 * side - this copy is not load-bearing, it just means the document is already
 * correct if anything else ever renders it.)
 */
function buildNoteDocumentHtml(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtmlText(title);
  const safeBody = sanitizeHtml(bodyHtml);
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'">`;
  return `<!DOCTYPE html><html><head>${csp}<title>${safeTitle}</title><style>
      body { font-family: Georgia, serif; font-size: 16px; line-height: 1.7; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #111; }
      h1 { font-size: 24px; margin-bottom: 8px; }
      h2 { font-size: 20px; } h3 { font-size: 18px; }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      td, th { border: 1px solid #ccc; padding: 6px 10px; }
      blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 16px; color: #555; }
      ul { list-style: disc; padding-left: 2em; } ol { list-style: decimal; padding-left: 2em; }
    </style></head><body><h1>${safeTitle}</h1>${safeBody}</body></html>`;
}

/** File-name-safe version of a note title, for the export dialogs' default. */
function exportFileName(title: string): string {
  return (title || 'note').replace(/[<>:"/\\|?*]/g, '_');
}

export function useNoteFileActions(args: UseNoteFileActionsArgs): NoteFileActions {
  const {
    currentNote,
    currentNotePath,
    editorContent,
    setCurrentNote,
    setCurrentNotePath,
    setView,
    setIsSaving,
    setFileError,
  } = args;

  // Guards against overlapping saves from rapid repeated Ctrl+S presses. Both
  // keydown events fire before the first IPC round-trip resolves, so without
  // this a second save could be dispatched with the same (still-correct, at
  // the time) `expectedUpdated` baseline as the first - but by the time the
  // main process processes it, the first save has already moved the on-disk
  // timestamp forward, so the second save would spuriously throw
  // NoteConflictError against its own in-flight sibling. A plain ref (not
  // `isSaving` state) is required here: state updates aren't visible until
  // the next render, but a second keydown can fire synchronously before that
  // render happens.
  const saveInFlightRef = useRef(false);

  const handleSaveNote = useCallback(async () => {
    if (!currentNote || !currentNotePath) return;
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setIsSaving(true);
    try {
      const updatedNote: BnFile = {
        ...currentNote,
        content: editorContent,
      };
      // Pass the timestamp the note was loaded at so the main process refuses a
      // blind overwrite if another window saved this file since (A3). `updated`
      // on currentNote is the last loaded/saved value - our new base.
      const expectedUpdated = currentNote.updated;
      // The main process regenerates `updated` itself and returns the real
      // written value - that (not a client-side guess) becomes the new
      // baseline. Using a local `new Date().toISOString()` guess here was the
      // root cause of a false conflict on every save after the first: the
      // guess would never exactly match what the main process actually wrote,
      // so the *next* save's expectedUpdated would always mismatch the disk.
      const savedUpdated = isAbsolutePath(currentNotePath)
        ? await fileNotesAPI.saveNoteAbsolute(currentNotePath, updatedNote, expectedUpdated)
        : await fileNotesAPI.saveNote(currentNotePath, updatedNote, expectedUpdated);
      setCurrentNote({ ...updatedNote, updated: savedUpdated });
      useNoteEditorStore.getState().markSaved(); // allow-getstate: save-note async callback - imperative store update outside render
      setFileError(null);
    } catch (err: unknown) {
      if (err instanceof IpcResultError && err.code === 'conflict') {
        // Another window changed this note since we opened it. Don't clobber it
        // silently: warn, and re-sync our base timestamp to what's on disk so a
        // second, deliberate Save overwrites (or the user can Save As to branch).
        // The editor stays dirty (no markSaved) so no edits are dropped.
        try {
          const onDisk = isAbsolutePath(currentNotePath)
            ? await fileNotesAPI.readNoteAbsolute(currentNotePath)
            : await fileNotesAPI.readNote(currentNotePath);
          if (onDisk) {
            setCurrentNote({ ...currentNote, updated: onDisk.updated });
          }
        } catch {
          // Best-effort re-sync; the warning below still stands.
        }
        setFileError(
          'This note was changed in another window since you opened it. ' +
            'Save again to overwrite those changes, or use "Save As" to keep both copies.'
        );
        return;
      }
      setFileError(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
      saveInFlightRef.current = false;
    }
  }, [currentNote, currentNotePath, editorContent, setCurrentNote, setIsSaving, setFileError]);

  const handleSaveAs = useCallback(async () => {
    if (!currentNote) return;
    try {
      const filePath = await fileNotesAPI.showSaveDialog(currentNote.title);
      if (filePath) {
        // "Save As" writes a copy to a new path; the original stays open and
        // its `currentNote`/`currentNotePath` baseline is untouched (that's
        // what lets the conflict banner's "Save As to keep both copies"
        // option actually keep both). No `expectedUpdated` is passed - this
        // is always a fresh, unconditional write to (from the app's
        // perspective) a brand-new file. `updated` doesn't need a
        // client-side guess: the main process stamps its own authoritative
        // value, which is irrelevant here since we don't persist a baseline
        // for this path.
        const updatedNote: BnFile = {
          ...currentNote,
          content: editorContent,
        };
        await fileNotesAPI.saveNoteAbsolute(filePath, updatedNote);
        useNoteEditorStore.getState().markSaved(); // allow-getstate: save-as async callback - imperative store update outside render
      }
    } catch (err: unknown) {
      setFileError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [currentNote, editorContent, setFileError]);

  const handlePrint = useCallback(() => {
    if (!currentNote) return;
    void fileNotesAPI.printNote(buildNoteDocumentHtml(currentNote.title, editorContent));
  }, [currentNote, editorContent]);

  const handleExportPdf = useCallback(async () => {
    if (!currentNote) return;
    const result = await fileNotesAPI.exportNotePdf(
      buildNoteDocumentHtml(currentNote.title, editorContent),
      exportFileName(currentNote.title)
    );
    // This channel answers with `{ success, error }` rather than throwing, so
    // there is nothing to catch - a failed render or a failed write arrives as
    // a message to show.
    if (!result.success) {
      setFileError(`Export failed: ${result.error ?? 'unknown error'}`);
    }
  }, [currentNote, editorContent, setFileError]);

  const handleExportMarkdown = useCallback(async () => {
    if (!currentNote) return;
    try {
      const md = htmlToMarkdown(editorContent);
      // `unwrap`, not a `result.success` check: these two channels go through
      // `ipcHandler`, so a failure arrives as an `{ ok: false }` envelope. The
      // old check read a `success` field the envelope does not have, which
      // made every export failure silent.
      await unwrap(
        window.electron.ipcRenderer.invoke('file-notes:export-markdown', exportFileName(currentNote.title), md)
      );
    } catch (err: unknown) {
      setFileError(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [currentNote, editorContent, setFileError]);

  const handleExportDocx = useCallback(async () => {
    if (!currentNote) return;
    try {
      await unwrap(
        window.electron.ipcRenderer.invoke(
          'file-notes:export-docx',
          exportFileName(currentNote.title),
          editorContent,
          currentNote.title
        )
      );
    } catch (err: unknown) {
      setFileError(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [currentNote, editorContent, setFileError]);

  const handleOpenFile = useCallback(async () => {
    try {
      const filePath = await fileNotesAPI.showOpenDialog();
      if (filePath) {
        const note = await fileNotesAPI.readNoteAbsolute(filePath);
        if (note) {
          setCurrentNote(note);
          setCurrentNotePath(filePath);
          setView('editor');
          useNoteEditorStore.getState().resetContent(note.content || ''); // allow-getstate: open-file async callback - imperative store reset outside render
          useFileNotesStore.getState().addRecentFile(filePath, note.title); // allow-getstate: open-file async callback - imperative store update outside render
        }
      }
    } catch (err: unknown) {
      setFileError(`Failed to open file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [setCurrentNote, setCurrentNotePath, setView, setFileError]);

  const handleOpenInExplorer = useCallback(async (relativePath?: string) => {
    try {
      await fileNotesAPI.openInFileManager(relativePath);
    } catch (err: unknown) {
      console.error('Failed to open in file manager:', err);
    }
  }, []);

  return {
    handleSaveNote,
    handleSaveAs,
    handlePrint,
    handleExportPdf,
    handleExportMarkdown,
    handleExportDocx,
    handleOpenFile,
    handleOpenInExplorer,
  };
}
