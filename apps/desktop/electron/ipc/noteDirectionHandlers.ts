/**
 * IPC for per-note default text direction (task 0076): `user_data_item` rows
 * (owner `app:note-direction`, collection `notes`, key = note path relative to
 * the notes root) in the shared user database. Notes stay plain `.bn` HTML.
 *
 * Replies use the `Result<T>` envelope; the renderer side is
 * `src/ui/services/noteDirectionAPI.ts`.
 */
import { UserDataRepository, UserDataNoteDirectionStore, isNoteDirection } from '@bible/core';
import type { NoteDirection } from '@bible/core';
import log from 'electron-log';
import { getSharedUserDb } from '../services/sharedUserDb';
import { initializeUserSchema } from '../schema/userSchema';
import { ipcHandler, IpcKnownError } from './handler-helper';

let storeInit: Promise<UserDataNoteDirectionStore> | null = null;

async function getStore(): Promise<UserDataNoteDirectionStore> {
  if (!storeInit) {
    storeInit = (async () => {
      const db = await getSharedUserDb();
      initializeUserSchema(db);
      return new UserDataNoteDirectionStore(new UserDataRepository(db));
    })().catch((err: unknown) => {
      storeInit = null;
      throw err;
    });
  }
  return storeInit;
}

/** Forget the cached store (called when the user database is closed). */
export function resetNoteDirectionStore(): void {
  storeInit = null;
}

/** Best effort: carry a note's (or folder's) direction choice along a rename/move. */
export async function moveNoteDirectionKeys(oldPath: string, newPath: string): Promise<void> {
  try {
    (await getStore()).move(oldPath, newPath);
  } catch (err) {
    log.warn('note-direction: could not follow rename', err);
  }
}

function requirePath(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0) throw new IpcKnownError('invalid_input', 'A note path is required.');
  return p;
}

export function registerNoteDirectionHandlers(): void {
  ipcHandler<[string], NoteDirection | null>('note-direction:get', async (notePath) => {
    return (await getStore()).get(requirePath(notePath));
  });

  ipcHandler<[string, unknown], void>('note-direction:set', async (notePath, direction) => {
    const p = requirePath(notePath);
    if (direction !== null && !isNoteDirection(direction)) {
      throw new IpcKnownError('invalid_input', 'Direction must be "ltr", "rtl" or null.');
    }
    (await getStore()).set(p, direction);
  });
}
