/** Keyword sets as `user_data_item` rows (owner `app:keyword-marks`). Browser-safe: desktop passes SQLite, web the in-memory store. */
import { UserDataItem, appOwner } from '../Data/Models/User/UserDataItem';
import type { IUserDataRepository } from '../Data/Repositories/IUserDataRepository';
import type { IKeywordSetStore } from './service';
import { isValidationErrors, validateKeywordSet } from './validate';
import type { KeywordSet } from './types';

export const KEYWORD_OWNER = appOwner('keyword-marks');
export const KEYWORD_COLLECTION = 'sets';

export class UserDataKeywordSetStore implements IKeywordSetStore {
  constructor(private readonly repo: IUserDataRepository) {}

  async list(): Promise<KeywordSet[]> {
    const out: KeywordSet[] = [];
    for (const item of this.repo.list(KEYWORD_OWNER, KEYWORD_COLLECTION)) {
      try {
        const v = validateKeywordSet(JSON.parse(item.value ?? 'null'));
        if (!isValidationErrors(v)) out.push(v);
      } catch { /* skip a corrupt row rather than fail the list */ }
    }
    return out;
  }

  async put(set: KeywordSet): Promise<void> {
    this.repo.put(new UserDataItem({
      ownerUuid: KEYWORD_OWNER, collection: KEYWORD_COLLECTION, itemKey: set.id,
      value: JSON.stringify(set), valueType: 'json',
    }));
  }

  async remove(id: string): Promise<void> {
    this.repo.remove(KEYWORD_OWNER, KEYWORD_COLLECTION, id);
  }
}
