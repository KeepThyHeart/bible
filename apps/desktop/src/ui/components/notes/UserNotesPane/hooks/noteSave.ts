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
export function saveWithBaseline(path: string, note: BnFile): Promise<string> {
  return isAbsolutePath(path)
    ? fileNotesAPI.saveNoteAbsolute(path, note, note.updated)
    : fileNotesAPI.saveNote(path, note, note.updated);
}

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
