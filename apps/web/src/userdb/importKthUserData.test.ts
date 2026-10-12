// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

vi.mock('@bible/core/browser', async (orig) => ({
  ...(await orig<object>()),
  UserRepositories: await import('../../../../packages/core/src/Data/Repositories/userRepositories'),
}));

import { UserData } from '@bible/core/browser';
import { WebUserData } from '../userdata/WebUserData';
import { IMPORT_MARKER, importKthUserData } from './importKthUserData';
import { createInProcessClient, loadSqlite, type Sqlite3 } from './mirrorTestHarness';

const { UserDataItem, VerseLinkRecord, appOwner } = UserData;
const OWNER = appOwner('t');
const req = { op: 'import', source: 'kth-user-data' } as const;

let sqlite3: Sqlite3;
beforeAll(async () => {
  sqlite3 = await loadSqlite();
}, 60_000);

const clientFor = (idb: IDBFactory | null) =>
  createInProcessClient(sqlite3, { import: (r, ctx) => importKthUserData(r, ctx, { indexedDB: idb }) });

async function seedIdb(idb: IDBFactory) {
  const old = await WebUserData.open({ indexedDB: idb, channelName: null });
  const a = old.items.put(UserDataItem.json(OWNER, 'c', 'a', { v: 1 }));
  old.items.put(UserDataItem.json(OWNER, 'c', 'b', { v: 2 }));
  old.links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: a.itemId!, verseIdStart: 1001001 }));
  await old.flush();
  const snap = old.db.snapshot();
  old.close();
  return snap;
}

describe('importKthUserData', () => {
  it('copies rows with ids and links, sets the marker, and is one-shot', async () => {
    const idb = new IDBFactory();
    const snap = await seedIdb(idb);
    const client = clientFor(idb);
    expect(await client.request(req)).toEqual({ items: 2, links: 1 });
    expect(await client.call('userDataMirror', 'readSnapshot')).toEqual({ items: snap.user_data_item, links: snap.verse_link });
    const marker = client.sql().queryOne('SELECT value FROM setting WHERE category = ? AND key = ?', [IMPORT_MARKER.category, IMPORT_MARKER.key]);
    expect(marker).toBeDefined();
    // sequences were raised past the imported ids
    expect(await client.call('userDataMirror', 'reserveIds', 'item', 1)).toEqual({ start: 3, end: 4 });

    // a later change in OPFS is not overwritten by a second import
    await client.call('userDataMirror', 'applyChanges', [{ type: 'item:delete', ownerUuid: OWNER, collection: 'c', itemKey: 'a' }]);
    expect(await client.request(req)).toEqual({ items: 0, links: 0, skipped: true });
    expect(((await client.call('userDataMirror', 'readSnapshot')) as { items: unknown[] }).items).toHaveLength(1);
  });

  it('never deletes or changes the IndexedDB store', async () => {
    const idb = new IDBFactory();
    const snap = await seedIdb(idb);
    await clientFor(idb).request(req);
    const again = await WebUserData.open({ indexedDB: idb, channelName: null });
    expect(again.db.snapshot()).toEqual(snap);
    again.close();
  });

  it('without an IndexedDB store: sets the marker, copies nothing and does not create the database', async () => {
    const idb = new IDBFactory();
    const client = clientFor(idb);
    expect(await client.request(req)).toEqual({ items: 0, links: 0 });
    expect(client.sql().queryOne('SELECT 1 AS x FROM setting WHERE key = ?', [IMPORT_MARKER.key])).toBeDefined();
    const names = (await idb.databases()).map((d) => d.name);
    expect(names).not.toContain('kth-user-data');
    expect(await client.request(req)).toMatchObject({ skipped: true });
  });

  it('without any IndexedDB at all behaves the same', async () => {
    const client = clientFor(null);
    expect(await client.request(req)).toEqual({ items: 0, links: 0 });
  });

  it('after a wipe the marker is gone with the OPFS DB, and the (deleted) IndexedDB store yields nothing', async () => {
    const idb = new IDBFactory();
    await seedIdb(idb);
    const client = clientFor(idb);
    await client.request(req);
    await client.request({ op: 'wipe' });
    // the wipe path (wipeStores.ts) deletes the IndexedDB database; simulate that here
    await new Promise<void>((res, rej) => {
      const d = idb.deleteDatabase('kth-user-data');
      d.onsuccess = () => res();
      d.onerror = () => rej(d.error);
    });
    expect(await client.request(req)).toEqual({ items: 0, links: 0 });
    expect(((await client.call('userDataMirror', 'readSnapshot')) as { items: unknown[] }).items).toEqual([]);
  });

  it('concurrent requests share one run', async () => {
    const idb = new IDBFactory();
    await seedIdb(idb);
    const client = clientFor(idb);
    const [x, y] = await Promise.all([client.request(req), client.request(req)]);
    expect(x).toEqual({ items: 2, links: 1 });
    expect(y).toEqual({ items: 2, links: 1 });
  });
});
