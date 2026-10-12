/**
 * Maps a `UserRepoName` to the repository over the worker's `ISql`. Browser-safe: no `@bible/core` root import.
 * Repos are built lazily, each on first use (a getter on the bag), so a repo that fails to construct only fails the
 * calls made to it; a failed construction is retried on the next access.
 */
import { MEMORY_TABLES, UserRepositories, type Sync } from '@bible/core/browser';
import { createAnnotationsRepo } from './annotationsRepo';
import type { RepoCtx } from './handler';
import { createMemoryRepo } from './memoryRepo';
import type { UserRepoName } from './protocol';
import { createUserDataMirrorRepo } from './userDataMirrorRepo';

export type RepoBag = Partial<Record<UserRepoName, object>>;

/**
 * Optional teardown a repo may expose under this symbol (not callable over the wire: `call` takes string names).
 * The handler runs it on wipe, before the database closes (memory disposes its service here).
 */
export const REPO_DISPOSE: unique symbol = Symbol.for('kth.userdb.repoDispose') as never;

/** Tables each repo writes, for the `changed` event and `onLocalWrite`. */
export const REPO_TABLES: Partial<Record<UserRepoName, string[]>> = {
  notes: ['user_note', 'note_verse_link', 'verse_link'],
  commentaries: ['user_commentary'],
  markup: ['user_text_markup'],
  collections: ['collection', 'pinned_item'],
  crossRefs: ['user_cross_reference'],
  verseLinks: ['verse_link'],
  userData: ['user_data_item', 'verse_link'],
  userDataMirror: ['user_data_item', 'verse_link'],
  annotations: ['user_text_markup', 'user_note', 'note_verse_link', 'collection', 'pinned_item'],
  memory: [...MEMORY_TABLES],
};

type RepoFactories = Partial<Record<UserRepoName, () => object>>;

/** Repos not yet available (readingPlans, prayer, journal) are absent; the handler reports `unknown_repo`. */
export function createRepos(sql: Sync.ISql, ctx: RepoCtx): RepoBag {
  const factories: RepoFactories = {
    notes: () => new UserRepositories.UserNoteRepository(sql),
    commentaries: () => new UserRepositories.UserCommentaryRepository(sql),
    markup: () => new UserRepositories.UserTextMarkupRepository(sql),
    collections: () => new UserRepositories.CollectionRepository(sql),
    crossRefs: () => new UserRepositories.UserCrossReferenceRepository(sql),
    verseLinks: () => new UserRepositories.VerseLinkRepository(sql),
    userData: () => new UserRepositories.UserDataRepository(sql),
    userDataMirror: () => createUserDataMirrorRepo(sql),
    annotations: () => createAnnotationsRepo(sql),
    memory: () => createMemoryRepo(sql, ctx),
  };
  const built = new Map<UserRepoName, object>();
  const bag: RepoBag = {};
  for (const [name, make] of Object.entries(factories) as Array<[UserRepoName, () => object]>) {
    Object.defineProperty(bag, name, {
      enumerable: true,
      get() {
        let repo = built.get(name);
        if (!repo) {
          repo = make();
          built.set(name, repo);
        }
        return repo;
      },
    });
  }
  Object.defineProperty(bag, REPO_DISPOSE, {
    value: () => {
      for (const repo of built.values()) {
        const dispose = (repo as { [REPO_DISPOSE]?: () => void })[REPO_DISPOSE];
        try {
          dispose?.call(repo);
        } catch (e) {
          console.warn('[userdb] repo dispose failed', e);
        }
      }
      built.clear();
    },
  });
  return bag;
}

/** Run every built repo's `[REPO_DISPOSE]` (wipe). */
export function disposeRepos(bag: RepoBag): void {
  (bag as { [REPO_DISPOSE]?: () => void })[REPO_DISPOSE]?.();
}

/** Read-only method names do not raise `changed`. */
export function isReadMethod(method: string): boolean {
  return /^(get|find|list|search|count|has|is|query|read|load|exists)/.test(method);
}

/** Calls that change no user rows: reads, and the mirror's id reservation (it only bumps `sqlite_sequence`). */
export function isChangeFreeCall(repo: UserRepoName, method: string): boolean {
  return isReadMethod(method) || (repo === 'userDataMirror' && method === 'reserveIds');
}
