import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import type { BnFile } from '../../../../services/fileNotesAPI';
import { IpcResultError } from '../../../../services/ipcResult';
import { isAbsolutePath } from '../utils';

/**
 * Save a note with the baseline (`updated`) it was loaded or last saved at, so
 * the main process refuses a save that would overwrite another window's edits
 * (`conflict`) or re-create a note that was renamed, moved or trashed since
 * (`not_found`). Returns the `updated` the main process wrote.
 */
export async function saveWithBaseline(path: string, note: BnFile): Promise<string> {
  beginSave(path);
  try {
    return isAbsolutePath(path)
      ? await fileNotesAPI.saveNoteAbsolute(path, note, note.updated)
      : await fileNotesAPI.saveNote(path, note, note.updated);
  } finally {
    endSave(path);
  }
}

/**
 * Saves of this window that have been sent but not answered yet, per path. A
 * "note saved elsewhere" push that arrives meanwhile is a real conflict, never
 * something to reload over.
 */
const savesInFlight = new Map<string, number>();
export function beginSave(path: string): void {
  savesInFlight.set(path, (savesInFlight.get(path) ?? 0) + 1);
}
export function endSave(path: string): void {
  const n = (savesInFlight.get(path) ?? 0) - 1;
  if (n > 0) savesInFlight.set(path, n);
  else savesInFlight.delete(path);
}
export const isSaveInFlight = (path: string): boolean => (savesInFlight.get(path) ?? 0) > 0;

/** Which kind of stale-baseline refusal this is, or null for any other error. */
export function staleSaveKind(err: unknown): 'conflict' | 'missing' | null {
  if (!(err instanceof IpcResultError)) return null;
  if (err.code === 'conflict') return 'conflict';
  if (err.code === 'not_found') return 'missing';
  return null;
}

export const CONFLICT_MESSAGE =
  'This note was changed in another window since you opened it, so it was not saved automatically. ' +
  'Save again to overwrite those changes, or use "Save As" to keep both copies.';
export const MISSING_MESSAGE =
  'This note was renamed, moved or deleted since you opened it, so it was not saved. ' +
  'Use "Save As" to keep your text.';

/**
 * A copy of unsaved text next to the note, used when the note could not be
 * saved on the way out because another window changed it: both versions are
 * kept instead of one silently winning.
 */
export async function saveConflictCopy(path: string, note: BnFile): Promise<void> {
  if (isAbsolutePath(path)) return;
  const copyPath = path.replace(/\.bn$/, '') + ' (unsaved changes).bn';
  await fileNotesAPI.saveNote(copyPath, { ...note, title: `${note.title} (unsaved changes)` });
}

/**
 * Notes whose last save was refused with a conflict and not yet resolved by the
 * user. While a path is here the baseline is left alone, so only a deliberate
 * second manual Save (which re-syncs it) can overwrite the other version.
 */
const conflictPaths = new Set<string>();
export const markNoteConflict = (path: string): void => { conflictPaths.add(path); };
export const hasNoteConflict = (path: string): boolean => conflictPaths.has(path);
export const clearNoteConflict = (path: string): void => { conflictPaths.delete(path); };
