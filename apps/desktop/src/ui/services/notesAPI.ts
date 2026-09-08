/**
 * Frontend API wrapper for notes operations.
 *
 * Uses the `Result<T>` envelope convention: the main-process handlers in
 * `electron/ipc/notesHandlers.ts` return
 * `{ ok, value } | { ok: false, error }`. Each call here uses `unwrap` to
 * convert that envelope into a plain value (or a thrown `IpcResultError`).
 */

import { NoteType, VerseId } from '@bible/core';
import { unwrap } from './ipcResult';

// Re-export types for convenience
export type { NoteType, VerseId };

export interface SerializedNote {
  noteId?: number;
  userCommentaryId?: number;
  parentNoteId?: number;
  verseIdStart?: VerseId;
  verseIdEnd?: VerseId;
  title?: string;
  content: string;
  contentFormat: string;
  noteType: NoteType;
  documentType?: string;
  visibility: string;
  createdDate?: string;
  modifiedDate?: string;
  tags: string[];
  seriesName?: string;
  entryDate?: string;
  metadata?: any;
  linkedVerses?: any[];
  children?: SerializedNote[];
}

export interface NoteSummary {
  noteId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  title?: string;
  modifiedDate: string;
}

// Access Electron IPC from window object
const ipcRenderer = (window as any).electron?.ipcRenderer;

if (!ipcRenderer) {
  console.warn('Electron IPC not available - notes API will not work');
}

/**
 * Get a note by ID
 */
export async function getNoteById(noteId: number): Promise<SerializedNote | null> {
  return unwrap<SerializedNote | null>(ipcRenderer.invoke('notes:get-by-id', noteId));
}

/**
 * Get all notes
 */
export async function getAllNotes(options?: any): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:get-all', options));
}

/**
 * Get notes by type
 */
export async function getNotesByType(noteType: NoteType): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:get-by-type', noteType));
}

/**
 * Get verse notes
 */
export async function getVerseNotes(): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:get-verse-notes'));
}

/**
 * Get document notes
 */
export async function getDocuments(): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:get-documents'));
}

/**
 * Get journal entries
 */
export async function getJournals(): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:get-journals'));
}

/**
 * Get prayer notes
 */
export async function getPrayers(): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:get-prayers'));
}

/**
 * Get notes for a specific verse
 */
export async function getNotesForVerse(verseId: VerseId): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:get-for-verse', verseId));
}

/**
 * Get notes for a verse range
 */
export async function getNotesForVerseRange(startVerseId: VerseId, endVerseId: VerseId): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:get-for-verse-range', startVerseId, endVerseId));
}

/**
 * Get verse IDs that have notes within a range (for displaying indicators)
 */
export async function getVersesWithNotes(startVerseId: VerseId, endVerseId: VerseId): Promise<Set<VerseId>> {
  const data = await unwrap<VerseId[]>(ipcRenderer.invoke('notes:get-verses-with-notes', startVerseId, endVerseId));
  return new Set(data);
}

/**
 * Search notes
 */
export async function searchNotes(query: string): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:search', query));
}

/**
 * Get notes by tag
 */
export async function getNotesByTag(tag: string): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:get-by-tag', tag));
}

/**
 * Get all tags
 */
export async function getAllTags(): Promise<string[]> {
  return unwrap<string[]>(ipcRenderer.invoke('notes:get-all-tags'));
}

/**
 * Create a note
 */
export async function createNote(noteData: Partial<SerializedNote>): Promise<SerializedNote> {
  try {
    return await unwrap<SerializedNote>(ipcRenderer.invoke('notes:create', noteData));
  } catch (error) {
    console.error('Failed to create note:', error);
    throw error;
  }
}

/**
 * Create a verse note
 */
export async function createVerseNote(
  verseIdStart: VerseId,
  content: string,
  options?: any
): Promise<SerializedNote> {
  return unwrap<SerializedNote>(
    ipcRenderer.invoke('notes:create-verse-note', verseIdStart, content, options)
  );
}

/**
 * Create a document
 */
export async function createDocument(
  title: string,
  content: string,
  documentType?: string,
  tags?: string[]
): Promise<SerializedNote> {
  return unwrap<SerializedNote>(
    ipcRenderer.invoke('notes:create-document', title, content, documentType, tags)
  );
}

/**
 * Update a note
 */
export async function updateNote(note: SerializedNote): Promise<SerializedNote> {
  return unwrap<SerializedNote>(ipcRenderer.invoke('notes:update', note));
}

/**
 * Update note content
 */
export async function updateNoteContent(noteId: number, content: string): Promise<SerializedNote | null> {
  return unwrap<SerializedNote | null>(ipcRenderer.invoke('notes:update-content', noteId, content));
}

/**
 * Update note title
 */
export async function updateNoteTitle(noteId: number, title: string): Promise<SerializedNote | null> {
  return unwrap<SerializedNote | null>(ipcRenderer.invoke('notes:update-title', noteId, title));
}

/**
 * Add tag to note
 */
export async function addTagToNote(noteId: number, tag: string): Promise<SerializedNote | null> {
  return unwrap<SerializedNote | null>(ipcRenderer.invoke('notes:add-tag', noteId, tag));
}

/**
 * Remove tag from note
 */
export async function removeTagFromNote(noteId: number, tag: string): Promise<SerializedNote | null> {
  return unwrap<SerializedNote | null>(ipcRenderer.invoke('notes:remove-tag', noteId, tag));
}

/**
 * Count all descendants (children, grandchildren, ...) of a note. Deleting a note
 * cascades to its whole subtree, so callers use this to confirm first (A6).
 */
export async function countDescendants(noteId: number): Promise<number> {
  return unwrap<number>(ipcRenderer.invoke('notes:count-descendants', noteId));
}

/**
 * Delete a note - returns true on success, false if the delete failed.
 * Unexpected errors still throw.
 */
export async function deleteNote(noteId: number): Promise<boolean> {
  return unwrap<boolean>(ipcRenderer.invoke('notes:delete', noteId));
}

/**
 * Get recent notes
 */
export async function getRecentNotes(limit?: number): Promise<SerializedNote[]> {
  return unwrap<SerializedNote[]>(ipcRenderer.invoke('notes:get-recent', limit));
}

/**
 * Get note statistics
 */
export async function getNoteStatistics(): Promise<any> {
  return unwrap<any>(ipcRenderer.invoke('notes:get-statistics'));
}

/**
 * Get the next verse ID that has a note
 */
export async function getNextVerseWithContent(currentVerseId: VerseId): Promise<VerseId | null> {
  return unwrap<VerseId | null>(ipcRenderer.invoke('notes:getNextVerseWithContent', currentVerseId));
}

/**
 * Get the previous verse ID that has a note
 */
export async function getPreviousVerseWithContent(currentVerseId: VerseId): Promise<VerseId | null> {
  return unwrap<VerseId | null>(ipcRenderer.invoke('notes:getPreviousVerseWithContent', currentVerseId));
}

/**
 * Get all note summaries for tree view/navigation
 */
export async function getAllNoteSummaries(): Promise<NoteSummary[]> {
  return unwrap<NoteSummary[]>(ipcRenderer.invoke('notes:getAllNoteSummaries'));
}
