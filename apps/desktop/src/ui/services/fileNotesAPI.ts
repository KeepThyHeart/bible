/**
 * Renderer-side API for file-based Bible Notes (.bn files).
 *
 * Uses the `Result<T>` envelope convention. The handler side lives in
 * `electron/ipc/fileNotesHandlers.ts`. The `AllowedIpcChannel` union is
 * imported for compile-time channel typo detection.
 */

import type { AllowedIpcChannel } from '../../../electron/ipc/allowedChannels';
import { unwrap } from './ipcResult';
import { noteVerseNoteSaved, noteVerseNoteRemoved } from './verseNoteMarkerEvents';
import { announceLocalNoteSaved } from './noteSavedLocal';
import type { VerseNoteQuery, VerseNoteRecord } from '../../../electron/ipc/verseNoteBulk';
import { parseVerseId, getBookNameFromCache } from '../utils/verseReference';

export type { VerseNoteQuery, VerseNoteRecord };

export interface BnFile {
  bn: number;
  type: 'annotation' | 'document' | 'sermon' | 'study' | 'outline' | 'verse_note';
  title: string;
  tags: string[];
  passages: Array<{
    start: number;
    end: number;
    association: 'primary' | 'supporting' | 'reference';
  }>;
  created: string;
  updated: string;
  content: any; // TipTap JSON document
  metadata: Record<string, any>;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  modified: string;
  size?: number;
}

async function invoke<T>(channel: AllowedIpcChannel, ...args: any[]): Promise<T> {
  return unwrap<T>(window.electron.ipcRenderer.invoke(channel, ...args));
}

/** Get the configured notes directory path */
export async function getNotesDir(): Promise<string> {
  return invoke<string>('file-notes:get-notes-dir');
}

/** Check if the notes directory has been set up */
export async function isInitialized(): Promise<boolean> {
  return invoke<boolean>('file-notes:is-initialized');
}

/** Initialize the notes directory, optionally setting a custom path */
export async function initialize(notesDir?: string): Promise<string> {
  return invoke<string>('file-notes:initialize', notesDir);
}

/** List directory contents (folders and .bn files) */
export async function listDirectory(relativePath: string = ''): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('file-notes:list-directory', relativePath);
}

/** Read a .bn note by relative path */
export async function readNote(relativePath: string): Promise<BnFile | null> {
  return invoke<BnFile | null>('file-notes:read-note', relativePath);
}

/** Read a .bn note by absolute path */
export async function readNoteAbsolute(absolutePath: string): Promise<BnFile | null> {
  return invoke<BnFile | null>('file-notes:read-note-absolute', absolutePath);
}

/** Create a new .bn note */
export async function createNote(relativePath: string, title: string, type?: string): Promise<BnFile> {
  return invoke<BnFile>('file-notes:create-note', relativePath, title, type);
}

/**
 * Save a note to a relative path.
 *
 * @param expectedUpdated - The `updated` timestamp the note was loaded at. When
 *   provided and the on-disk file changed since (another window saved), the call
 *   rejects with an `IpcResultError` whose `code === 'conflict'`. Omit to force
 *   an unconditional overwrite.
 * @returns The `updated` timestamp actually written to disk. The main process
 *   regenerates this value, so callers MUST store this - not a client-side
 *   `new Date().toISOString()` guess - as the new baseline for the next save's
 *   `expectedUpdated`. Using a guess causes a false conflict on the very next
 *   save, since it will never match what's actually on disk.
 * @param origin - Who is saving; announced on the same-window bus
 *   (`noteSavedLocal`) so that listener can skip its own saves.
 */
export async function saveNote(
  relativePath: string,
  note: BnFile,
  expectedUpdated?: string,
  origin?: string
): Promise<string> {
  const updated = await invoke<string>('file-notes:save-note', relativePath, note, expectedUpdated);
  noteVerseNoteSaved(relativePath, note.content);
  announceLocalNoteSaved({ path: relativePath, updated, origin });
  return updated;
}

/**
 * Save a note to an absolute path. See {@link saveNote} for `expectedUpdated`
 * and the returned timestamp.
 */
export async function saveNoteAbsolute(
  absolutePath: string,
  note: BnFile,
  expectedUpdated?: string,
  origin?: string
): Promise<string> {
  const updated = await invoke<string>('file-notes:save-note-absolute', absolutePath, note, expectedUpdated);
  announceLocalNoteSaved({ path: absolutePath, updated, origin });
  return updated;
}

/** Pushed by the main process to every window except the one that saved a note. */
export interface NoteSavedEvent {
  absolutePath: string;
  updated: string;
  senderId: number;
}

/**
 * Subscribe to "a note was saved in another window". Returns an unsubscribe
 * function (a no-op when the bridge is unavailable, e.g. in tests or the web build).
 */
export function onNoteSaved(cb: (event: NoteSavedEvent) => void): () => void {
  return window.electron?.fileNotes?.onNoteSaved?.(cb) ?? (() => {});
}

/** Create a folder */
export async function createFolder(relativePath: string): Promise<void> {
  await invoke<void>('file-notes:create-folder', relativePath);
}

/** Rename a file or folder */
export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  await invoke<void>('file-notes:rename', oldPath, newPath);
  noteVerseNoteRemoved(oldPath);
}

/** Delete a file or folder (moves to recycling bin) */
export async function deleteEntry(relativePath: string): Promise<void> {
  await invoke<void>('file-notes:delete', relativePath);
  noteVerseNoteRemoved(relativePath);
}

/** Open the notes folder or a specific file in the OS file manager */
export async function openInFileManager(relativePath?: string): Promise<void> {
  await invoke<void>('file-notes:open-in-file-manager', relativePath);
}

/** Show native Open File dialog, returns absolute path or null */
export async function showOpenDialog(): Promise<string | null> {
  return invoke<string | null>('file-notes:show-open-dialog');
}

/** Show native Save As dialog, returns absolute path or null */
export async function showSaveDialog(defaultName?: string): Promise<string | null> {
  return invoke<string | null>('file-notes:show-save-dialog', defaultName);
}

/** Show native folder picker dialog, returns folder path or null */
export async function showFolderDialog(defaultPath?: string): Promise<string | null> {
  return invoke<string | null>('file-notes:show-folder-dialog', defaultPath);
}

// --- Verse Notes ---

/** Create or open a verse note, returns { note, relativePath } */
export async function createVerseNote(
  bookName: string, chapter: number, verse: number, verseId: number
): Promise<{ note: BnFile; relativePath: string }> {
  return invoke<{ note: BnFile; relativePath: string }>(
    'file-notes:create-verse-note', bookName, chapter, verse, verseId
  );
}

/** Read a verse note if it exists (never creates one), returns { note, relativePath } or null */
export async function readVerseNote(
  bookName: string, chapter: number, verse: number
): Promise<{ note: BnFile; relativePath: string } | null> {
  return invoke<{ note: BnFile; relativePath: string } | null>(
    'file-notes:read-verse-note', bookName, chapter, verse
  );
}

/**
 * Save the verse note for `verseId`: creates its file (type `verse_note`, title
 * "Book c:v", primary passage) when none exists, otherwise updates the content.
 * A verse note is a draft in the editor until this first writes it, so callers
 * must only call it for content worth keeping (`noteHasContent`) or for a note
 * that already has a file.
 *
 * @param expectedUpdated - The `updated` the note was loaded at; when given, a
 *   changed file rejects with `code === 'conflict'` and a vanished one with
 *   `'not_found'`. Omit for a draft (no file yet) or to force an overwrite.
 * @param bookName - The notes-folder name of the book; defaults to the book-name
 *   cache's. Pass the one a draft was opened with so the path cannot change.
 * @param origin - Who is saving; announced on the same-window bus.
 * @returns The note as written (`note.updated` is the new baseline) and its
 *   path relative to the notes folder.
 */
export async function saveVerseNote(
  verseId: number,
  html: string,
  expectedUpdated?: string,
  bookName?: string,
  origin?: string
): Promise<{ note: BnFile; relativePath: string }> {
  const name = bookName ?? getBookNameFromCache(parseVerseId(verseId).bookNumber);
  const result = await invoke<{ note: BnFile; relativePath: string }>(
    'file-notes:save-verse-note', verseId, html, expectedUpdated, name
  );
  noteVerseNoteSaved(result.relativePath, html);
  announceLocalNoteSaved({ path: result.relativePath, updated: result.note.updated, origin });
  return result;
}

/**
 * Read the verse notes WITH content for several chapters (or verse ranges of
 * them) in one call: query order, then verse number. A chapter with no notes
 * contributes nothing. At most `MAX_VERSE_NOTE_QUERIES` queries.
 */
export async function readVerseNotes(queries: VerseNoteQuery[]): Promise<VerseNoteRecord[]> {
  return invoke<VerseNoteRecord[]>('file-notes:read-verse-notes', queries);
}

/** Check if a verse has a note file */
export async function hasVerseNote(
  bookName: string, chapter: number, verse: number
): Promise<boolean> {
  return invoke<boolean>('file-notes:has-verse-note', bookName, chapter, verse);
}

/** List books that have verse notes */
export async function listVerseNoteBooks(): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('file-notes:list-verse-note-books');
}

/** List chapters for a book that have verse notes */
export async function listVerseNoteChapters(bookName: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('file-notes:list-verse-note-chapters', bookName);
}

/** List verse notes in a chapter */
export async function listVerseNotesInChapter(bookName: string, chapter: number): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('file-notes:list-verse-notes-in-chapter', bookName, chapter);
}

/** Ensure the Verse Notes folder exists */
export async function ensureVerseNotesFolder(): Promise<void> {
  await invoke<void>('file-notes:ensure-verse-notes-folder');
}

/**
 * Reply shape of the two note-rendering channels (`notes:print`,
 * `notes:export-pdf`). They are registered in `main.ts`, beside the hidden
 * BrowserWindow they share, rather than through `ipcHandler` - so they answer
 * with this plain shape rather than the `Result<T>` envelope `unwrap` expects.
 */
export interface NoteRenderResult {
  success: boolean;
  /** The user cancelled the save or print dialog: nothing happened, and it is not an error. */
  canceled?: boolean;
  error?: string;
}

/**
 * Render the note's standalone HTML document to a PDF the user picks a path
 * for. `html` is the same document `notes:print` is given, so a PDF and a
 * printout of one note are the same page. A cancelled save dialog comes back
 * as `{ success: false, canceled: true }`.
 */
export async function exportNotePdf(html: string, defaultName: string): Promise<NoteRenderResult> {
  return window.electron.ipcRenderer.invoke<NoteRenderResult>('notes:export-pdf', html, defaultName);
}

/** Send the note's standalone HTML document to the OS print dialog. */
export async function printNote(html: string): Promise<NoteRenderResult> {
  return window.electron.ipcRenderer.invoke<NoteRenderResult>('notes:print', html);
}

/**
 * Save any standalone HTML document (the Bible pane's printed passage) as a PDF, through a save dialog
 * that suggests `defaultName` (no extension). A cancelled dialog comes back as `{ success: false, canceled: true }`.
 */
export async function exportDocumentPdf(html: string, defaultName: string): Promise<NoteRenderResult> {
  return window.electron.ipcRenderer.invoke<NoteRenderResult>('document:export-pdf', html, defaultName);
}

/**
 * Export `html` as a Word document through a native Save dialog. Resolves with
 * the saved path, or null/undefined when the user cancelled.
 */
export async function exportNoteDocx(
  defaultName: string,
  html: string,
  title: string
): Promise<string | null | undefined> {
  return unwrap<string | null | undefined>(
    window.electron.ipcRenderer.invoke('file-notes:export-docx', defaultName, html, title)
  );
}

/** Send any standalone HTML document (the Bible pane's printed passage) to the OS print dialog. */
export async function printDocument(html: string): Promise<NoteRenderResult> {
  return window.electron.ipcRenderer.invoke<NoteRenderResult>('document:print', html);
}
