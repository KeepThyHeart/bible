/**
 * Worker extension `import` (S1, design §3): one-shot copy of the IndexedDB `kth-user-data` store (the 0084
 * `WebUserData` store) into the OPFS database, guarded by the marker `setting(web, userData.importedFromIdb)`.
 *
 * - Ids and links are preserved (rows are copied with their `item_id` / `link_id`; the AUTOINCREMENT sequences are
 *   raised past them).
 * - The IndexedDB store is opened read-only and never deleted or modified here (flag off again = that store, frozen
 *   at import time). The wipe path deletes it (`wipeStores.ts`); the marker lives in the OPFS DB, which a wipe also
 *   deletes, so a wiped store cannot be resurrected from IndexedDB.
 * - Absent store: the marker is set and nothing is copied (the open is aborted so no empty database is created).
 * No side effects at module load.
 */
import type { UserData } from '@bible/core/browser';
import type { ExtCtx } from './handler';
import type { UserDbRequest } from './protocol';
import { bumpSequence, createUserDataMirrorRepo } from './userDataMirrorRepo';

export interface ImportResult { items: number; links: number; skipped?: boolean }

export const IDB_NAME = 'kth-user-data';
export const IMPORT_MARKER = { category: 'web', key: 'userData.importedFromIdb' } as const;

interface Rows { items: UserData.UserDataItemRow[]; links: UserData.VerseLinkRow[] }

/** Read both stores, or null when the database (or its stores) does not exist. Never creates anything. */
function readIdb(factory: IDBFactory): Promise<Rows | null> {
  return new Promise((resolve, reject) => {
    let absent = false;
    const open = factory.open(IDB_NAME);
    open.onupgradeneeded = () => {
      // Version 0 -> 1 means the database did not exist: abort so it is not created.
      absent = true;
      open.transaction?.abort();
    };
    open.onerror = () => {
      if (absent) resolve(null);
      else reject(open.error ?? new Error('IndexedDB open failed'));
    };
    open.onblocked = () => reject(new Error('IndexedDB open blocked'));
    open.onsuccess = () => {
      const idb = open.result;
      const names = idb.objectStoreNames;
      if (!names.contains('user_data_item') || !names.contains('verse_link')) {
        idb.close();
        resolve(null);
        return;
      }
      try {
        const tx = idb.transaction(['user_data_item', 'verse_link'], 'readonly');
        const items = tx.objectStore('user_data_item').getAll() as IDBRequest<UserData.UserDataItemRow[]>;
        const links = tx.objectStore('verse_link').getAll() as IDBRequest<UserData.VerseLinkRow[]>;
        tx.oncomplete = () => {
          idb.close();
          resolve({ items: items.result, links: links.result });
        };
        tx.onerror = tx.onabort = () => {
          idb.close();
          reject(tx.error ?? new Error('IndexedDB read failed'));
        };
      } catch (e) {
        idb.close();
        reject(e);
      }
    };
  });
}

/** Marks the one-shot import as done without importing (after a wipe, so a surviving `kth-user-data` is never re-imported). */
export function writeImportMarker(sql: ExtCtx['sql'], source: string): void {
  sql.execute(
    `INSERT INTO setting (category, key, value, value_type) VALUES (?, ?, ?, 'json')
     ON CONFLICT(category, key) DO UPDATE SET value = excluded.value`,
    [IMPORT_MARKER.category, IMPORT_MARKER.key, JSON.stringify({ items: 0, links: 0, source })],
  );
}

const inFlight = new WeakMap<object, Promise<ImportResult>>();

export function importKthUserData(
  req: Extract<UserDbRequest, { op: 'import' }>,
  ctx: ExtCtx,
  deps: { indexedDB?: IDBFactory | null } = {},
): Promise<ImportResult> {
  if (req.source !== 'kth-user-data') return Promise.reject(new Error(`Unknown import source: ${String(req.source)}`));
  // Two tabs asking at once share one run.
  let run = inFlight.get(ctx.sql);
  if (!run) {
    run = doImport(ctx, deps).finally(() => inFlight.delete(ctx.sql));
    inFlight.set(ctx.sql, run);
  }
  return run;
}

async function doImport(ctx: ExtCtx, deps: { indexedDB?: IDBFactory | null }): Promise<ImportResult> {
  const { sql } = ctx;
  const marked = () =>
    sql.queryOne('SELECT 1 AS x FROM setting WHERE category = ? AND key = ?', [IMPORT_MARKER.category, IMPORT_MARKER.key]) !== undefined;
  if (marked()) return { items: 0, links: 0, skipped: true };

  const factory = deps.indexedDB === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : deps.indexedDB;
  const rows = factory ? await readIdb(factory) : null;

  return sql.transaction(() => {
    // Re-check inside the transaction: nothing else runs between this and the marker write.
    if (marked()) return { items: 0, links: 0, skipped: true };
    const items = rows?.items ?? [];
    const links = rows?.links ?? [];
    if (items.length > 0 || links.length > 0) {
      const repo = createUserDataMirrorRepo(sql);
      repo.applyChanges([
        ...items.map((row): UserData.UserDataChange => ({ type: 'item:put', row })),
        ...links.map((row): UserData.UserDataChange => ({ type: 'link:put', row })),
      ]);
      bumpSequence(sql, 'user_data_item', items.reduce((m, r) => Math.max(m, r.item_id), 0));
      bumpSequence(sql, 'verse_link', links.reduce((m, r) => Math.max(m, r.link_id), 0));
    }
    sql.execute(
      `INSERT INTO setting (category, key, value, value_type) VALUES (?, ?, ?, 'json')
       ON CONFLICT(category, key) DO UPDATE SET value = excluded.value`,
      [IMPORT_MARKER.category, IMPORT_MARKER.key, JSON.stringify({ items: items.length, links: links.length, source: IDB_NAME })],
    );
    return { items: items.length, links: links.length };
  });
}
