/**
 * Saved word groups, kept in the core user-data store (`user_data_item`,
 * owner `app:word-study`, collection `groups`) so they take part in backup
 * and, later, sync like other user data.
 */

import { IUserDataRepository } from '../Data/Repositories/IUserDataRepository';
import { UserDataItem, appOwner } from '../Data/Models/User/UserDataItem';
import { WordGroup, normalizeWordGroup } from '../WordStudy/wordGroup';

export const WORD_GROUP_OWNER = appOwner('word-study');
export const WORD_GROUP_COLLECTION = 'groups';

export class WordGroupStore {
  constructor(private readonly repo: IUserDataRepository) {}

  list(): WordGroup[] {
    const out: WordGroup[] = [];
    for (const item of this.repo.list(WORD_GROUP_OWNER, WORD_GROUP_COLLECTION)) {
      const v = item.parsedValue() as Partial<WordGroup> | undefined;
      if (v && Array.isArray(v.terms)) out.push(normalizeWordGroup({ ...v, id: v.id ?? item.itemKey, terms: v.terms }));
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  get(id: string): WordGroup | undefined {
    return this.list().find(g => g.id === id);
  }

  /** Insert or replace; returns the normalised group as stored. */
  save(group: Partial<WordGroup> & { terms: string[] }): WordGroup {
    const g = normalizeWordGroup(group);
    if (g.terms.length === 0) throw new Error('A word group needs at least one term');
    this.repo.put(UserDataItem.json(WORD_GROUP_OWNER, WORD_GROUP_COLLECTION, g.id, g));
    return g;
  }

  remove(id: string): boolean {
    return this.repo.remove(WORD_GROUP_OWNER, WORD_GROUP_COLLECTION, id);
  }
}
