/**
 * Renderer-side API for file-based Bible Notes (.bn files).
 *
 * Uses the `Result<T>` envelope convention. The handler side lives in
 * `electron/ipc/fileNotesHandlers.ts`. The `AllowedIpcChannel` union is
 * imported for compile-time channel typo detection.
 */

import type { AllowedIpcChannel } from '../../../electron/ipc/allowedChannels';
import { unwrap } from './ipcResult';

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
 */
export async function saveNote(
  relativePath: string,
  note: BnFile,
  expectedUpdated?: string
): Promise<string> {
  return invoke<string>('file-notes:save-note', relativePath, note, expectedUpdated);
}

/**
 * Save a note to an absolute path. See {@link saveNote} for `expectedUpdated`
 * and the returned timestamp.
 */
export async function saveNoteAbsolute(
  absolutePath: string,
  note: BnFile,
  expectedUpdated?: string
): Promise<string> {
  return invoke<string>('file-notes:save-note-absolute', absolutePath, note, expectedUpdated);
}

/** Create a folder */
export async function createFolder(relativePath: string): Promise<void> {
  await invoke<void>('file-notes:create-folder', relativePath);
}

/** Rename a file or folder */
export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  await invoke<void>('file-notes:rename', oldPath, newPath);
}

/** Delete a file or folder (moves to recycling bin) */
export async function deleteEntry(relativePath: string): Promise<void> {
  await invoke<void>('file-notes:delete', relativePath);
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

/** Read a verse note if it exists, returns { note, relativePath } or null */
export async function readVerseNote(
  bookName: string, chapter: number, verse: number
): Promise<{ note: BnFile; relativePath: string } | null> {
  return invoke<{ note: BnFile; relativePath: string } | null>(
    'file-notes:read-verse-note', bookName, chapter, verse
  );
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
  error?: string;
}

/**
 * Render the note's standalone HTML document to a PDF the user picks a path
 * for. `html` is the same document `notes:print` is given, so a PDF and a
 * printout of one note are the same page. A cancelled save dialog comes back
 * as `{ success: true }` - nothing was asked for and nothing happened.
 */
export async function exportNotePdf(html: string, defaultName: string): Promise<NoteRenderResult> {
  return window.electron.ipcRenderer.invoke<NoteRenderResult>('notes:export-pdf', html, defaultName);
}

/** Send the note's standalone HTML document to the OS print dialog. */
export async function printNote(html: string): Promise<NoteRenderResult> {
  return window.electron.ipcRenderer.invoke<NoteRenderResult>('notes:print', html);
}
