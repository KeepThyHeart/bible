/**
 * Worker extension `import` (S1, design §3): one-shot copy of the IndexedDB `kth-user-data` store into the OPFS DB,
 * guarded by `setting(web, userData.importedFromIdb)`. Never deletes the IndexedDB store.
 * STUB (C3): signature only; S1 fills the body. No side effects at module load.
 */
import type { ExtCtx } from './handler';
import type { UserDbRequest } from './protocol';

export interface ImportResult { items: number; links: number; skipped?: boolean }

export async function importKthUserData(
  req: Extract<UserDbRequest, { op: 'import' }>,
  ctx: ExtCtx,
): Promise<ImportResult> {
  void req;
  void ctx;
  throw new Error('not implemented');
}
