/**
 * Worker repo `userDataMirror` (S1, design §3): what the main-thread `MemoryUserDb` mirror (`OpfsUserData`) needs.
 * STUB (C3): signatures only; S1 fills the bodies. No side effects at module load.
 */
import type { Sync, UserData } from '@bible/core/browser';

export interface UserDataMirrorRepo {
  readSnapshot(): { items: UserData.UserDataItemRow[]; links: UserData.VerseLinkRow[] };
  /** Reserve `count` ids (`end` exclusive) by bumping `sqlite_sequence`; never overlaps a later insert. */
  reserveIds(kind: 'item' | 'link', count: number): { start: number; end: number };
  /** One transaction; upserts (`ON CONFLICT … DO UPDATE`), never `INSERT OR REPLACE`. */
  applyChanges(changes: UserData.UserDataChange[]): { applied: number };
}

export function createUserDataMirrorRepo(sql: Sync.ISql): UserDataMirrorRepo {
  void sql;
  throw new Error('not implemented');
}
