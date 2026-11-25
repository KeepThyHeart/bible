/**
 * Saving one chapter-mode verse note, with the usual rules:
 * - a note with a file: saved against its baseline (`updated`), so another window's edit is a
 *   conflict, a vanished file `not_found`; clearing it to empty is saved (the file stays);
 * - no file yet: written only when there is real content, else nothing is written.
 */
import type { BnFile } from '../../../services/fileNotesAPI';
import * as fileNotesAPI from '../../../services/fileNotesAPI';
import { noteHasContent } from '../../../../../electron/utils/noteHasContent';
import { saveWithBaseline } from '../UserNotesPane/hooks/noteSave';

export interface ChapterSaveTarget {
  verseId: number;
  /** The notes-folder name of the book. */
  folderName: string;
  /** The loaded file, or null when the verse has no file (a draft). */
  note: BnFile | null;
  /** Path of the loaded file (relative, forward slashes); ignored for a draft. */
  relativePath: string | null;
  origin?: string;
}

export interface ChapterSaveDeps {
  saveWithBaseline: (path: string, note: BnFile, origin?: string) => Promise<string>;
  saveVerseNote: (
    verseId: number, html: string, expectedUpdated?: string, bookName?: string, origin?: string
  ) => Promise<{ note: BnFile; relativePath: string }>;
}

const defaultDeps: ChapterSaveDeps = {
  saveWithBaseline,
  saveVerseNote: (...a) => fileNotesAPI.saveVerseNote(...a),
};

/** The saved note and its path, or null when nothing was written (an empty draft). Throws the save's refusal. */
export async function saveChapterNote(
  target: ChapterSaveTarget,
  html: string,
  deps: ChapterSaveDeps = defaultDeps
): Promise<{ note: BnFile; relativePath: string } | null> {
  if (target.note && target.relativePath) {
    const next: BnFile = { ...target.note, content: html };
    const updated = await deps.saveWithBaseline(target.relativePath, next, target.origin);
    return { note: { ...next, updated }, relativePath: target.relativePath };
  }
  if (!noteHasContent(html)) return null;
  return deps.saveVerseNote(target.verseId, html, undefined, target.folderName, target.origin);
}
