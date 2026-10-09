/** Maps a `UserRepoName` to the core repository over the worker's `ISql`. Browser-safe: no `@bible/core` root import. */
import { UserRepositories, type Sync } from '@bible/core/browser';
import type { UserRepoName } from './protocol';

export type RepoBag = Partial<Record<UserRepoName, object>>;

/** Tables each repo writes, for the `changed` event. */
export const REPO_TABLES: Partial<Record<UserRepoName, string[]>> = {
  notes: ['user_note', 'note_verse_link', 'verse_link'],
  commentaries: ['user_commentary'],
  markup: ['user_text_markup'],
  collections: ['collection', 'pinned_item'],
  crossRefs: ['user_cross_reference'],
  verseLinks: ['verse_link'],
  userData: ['user_data_item', 'verse_link'],
};

/** Repos not yet available (readingPlans, prayer, journal, memory) are absent; the handler reports `unknown_repo`. */
export function createRepos(sql: Sync.ISql): RepoBag {
  return {
    notes: new UserRepositories.UserNoteRepository(sql),
    commentaries: new UserRepositories.UserCommentaryRepository(sql),
    markup: new UserRepositories.UserTextMarkupRepository(sql),
    collections: new UserRepositories.CollectionRepository(sql),
    crossRefs: new UserRepositories.UserCrossReferenceRepository(sql),
    verseLinks: new UserRepositories.VerseLinkRepository(sql),
    userData: new UserRepositories.UserDataRepository(sql),
  };
}

/** Read-only method names do not raise `changed`. */
export function isReadMethod(method: string): boolean {
  return /^(get|find|list|search|count|has|is|query|read|load|exists)/.test(method);
}
