/**
 * Per-note default text direction as `user_data_item` rows (owner
 * `app:note-direction`, collection `notes`, key = the note's path relative to
 * the notes root, value `'ltr'` | `'rtl'`). "Default" (follow the UI language)
 * is the absence of a row. Notes stay plain HTML `.bn` files with no metadata.
 */
import { UserDataItem, appOwner } from '../Data/Models/User/UserDataItem';
import type { IUserDataRepository } from '../Data/Repositories/IUserDataRepository';

export const NOTE_DIRECTION_OWNER = appOwner('note-direction');
export const NOTE_DIRECTION_COLLECTION = 'notes';

export type NoteDirection = 'ltr' | 'rtl';

export function isNoteDirection(v: unknown): v is NoteDirection {
  return v === 'ltr' || v === 'rtl';
}

export class UserDataNoteDirectionStore {
  constructor(private readonly repo: IUserDataRepository) {}

  get(notePath: string): NoteDirection | null {
    const v = this.repo.get(NOTE_DIRECTION_OWNER, NOTE_DIRECTION_COLLECTION, notePath)?.value;
    return isNoteDirection(v) ? v : null;
  }

  /** `null` clears the choice (back to the UI direction). */
  set(notePath: string, direction: NoteDirection | null): void {
    if (direction === null) {
      this.repo.remove(NOTE_DIRECTION_OWNER, NOTE_DIRECTION_COLLECTION, notePath);
      return;
    }
    this.repo.put(new UserDataItem({
      ownerUuid: NOTE_DIRECTION_OWNER, collection: NOTE_DIRECTION_COLLECTION, itemKey: notePath,
      value: direction, valueType: 'string',
    }));
  }

  /** Follow a rename/move of a note (exact key) or of a folder (key prefix). */
  move(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    const prefix = oldPath.endsWith('/') ? oldPath : `${oldPath}/`;
    for (const item of this.repo.list(NOTE_DIRECTION_OWNER, NOTE_DIRECTION_COLLECTION)) {
      let target: string | null = null;
      if (item.itemKey === oldPath) target = newPath;
      else if (item.itemKey.startsWith(prefix)) target = `${newPath}/${item.itemKey.slice(prefix.length)}`;
      if (target === null) continue;
      this.repo.remove(NOTE_DIRECTION_OWNER, NOTE_DIRECTION_COLLECTION, item.itemKey);
      this.repo.put(new UserDataItem({
        ownerUuid: NOTE_DIRECTION_OWNER, collection: NOTE_DIRECTION_COLLECTION, itemKey: target,
        value: item.value, valueType: 'string',
      }));
    }
  }
}
