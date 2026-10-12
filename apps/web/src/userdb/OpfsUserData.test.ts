// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

vi.mock('@bible/core/browser', async (orig) => ({
  ...(await orig<object>()),
  UserRepositories: await import('../../../../packages/core/src/Data/Repositories/userRepositories'),
}));

import { UserData } from '@bible/core/browser';
import { userDataContract } from '../../../../packages/core/src/__tests__/contracts/userDataContract';
import { WebUserData } from '../userdata/WebUserData';
import { importKthUserData } from './importKthUserData';
import { createInProcessClient, loadSqlite, type Sqlite3 } from './mirrorTestHarness';
import { ID_BLOCK, OpfsUserData } from './OpfsUserData';

const { UserDataItem, VerseLinkRecord, appOwner } = UserData;
const harness = { describe, it, expect, beforeEach, afterEach };
const OWNER = appOwner('t');
const tick = () => new Promise((r) => setTimeout(r, 25));

let sqlite3: Sqlite3;
beforeAll(async () => {
  sqlite3 = await loadSqlite();
}, 60_000);

let opened: OpfsUserData[] = [];
const newClient = (idb: IDBFactory | null = new IDBFactory()) =>
  createInProcessClient(sqlite3, { import: (req, ctx) => importKthUserData(req, ctx, { indexedDB: idb }) });
async function open(client: ReturnType<typeof newClient>) {
  const s = await OpfsUserData.open({ client });
  opened.push(s);
  return s;
}
afterEach(() => {
  opened.forEach((s) => s.close());
  opened = [];
});

// The contract every user-data implementation passes (desktop SQLite, memory, IndexedDB, and now the OPFS mirror).
userDataContract(harness, 'OPFS-backed OpfsUserData', async () => {
  const store = await open(newClient());
  return { items: store.items, links: store.links, settle: () => store.flush() };
});

describe('OpfsUserData', () => {
  it('persists through the worker DB and a second store (another tab) sees it', async () => {
    const client = newClient();
    const a = await open(client);
    const b = await open(client);
    const seen: unknown[] = [];
    b.onRemoteChange((c) => seen.push(...c));
    const item = a.items.put(UserDataItem.json(OWNER, 'c', 'k', { v: 1 }));
    a.links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: item.itemId!, verseIdStart: 43003016 }));
    await a.flush();
    await tick();
    expect(b.items.get(OWNER, 'c', 'k')?.parsedValue()).toEqual({ v: 1 });
    expect(b.items.get(OWNER, 'c', 'k')?.itemId).toBe(item.itemId);
    expect(b.links.getForSource('user_data_item', item.itemId!)).toHaveLength(1);
    expect(seen.length).toBeGreaterThan(0);
    // and back, with a delete
    b.items.remove(OWNER, 'c', 'k');
    await b.flush();
    await tick();
    expect(a.items.get(OWNER, 'c', 'k')).toBeUndefined();
    // a new store on the same DB (reopen) reads everything
    a.items.put(UserDataItem.json(OWNER, 'c', 'keep', 1));
    await a.flush();
    const c = await open(client);
    expect(c.items.get(OWNER, 'c', 'keep')).toBeDefined();
  });

  it('two stores never issue the same item or link id', async () => {
    const client = newClient();
    const a = await open(client);
    const b = await open(client);
    const ids = new Set<number>();
    for (let i = 0; i < 20; i++) {
      for (const s of [a, b]) {
        const it = s.items.put(UserDataItem.json(OWNER, 'c', `${i}-${s === a ? 'a' : 'b'}`, i));
        const ln = s.links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: it.itemId!, verseIdStart: 1001001 + i }));
        expect(ids.has(it.itemId!)).toBe(false);
        ids.add(it.itemId!);
        expect(ln.linkId).toBeDefined();
      }
    }
    await Promise.all([a.flush(), b.flush()]);
    await tick();
    expect(a.db.snapshot().user_data_item).toHaveLength(40);
    expect(b.db.snapshot()).toEqual(a.db.snapshot());
  });

  it('reserved blocks never collide with a raw insert made after the reservation', async () => {
    const client = newClient();
    const a = await open(client);
    await client.handler.handle({ op: 'open' });
    // raw insert (as a sync pull would do) after both blocks were reserved
    client.sql().execute("INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end) VALUES ('x', 1, 1, 1)");
    client.sql().execute("INSERT INTO user_data_item (owner_uuid, collection, item_key) VALUES ('x', 'y', 'z')");
    const snap = await client.call<{ links: Array<{ link_id: number }>; items: Array<{ item_id: number }> }>('userDataMirror', 'readSnapshot');
    expect(snap.links[0].link_id).toBeGreaterThan(ID_BLOCK);
    expect(snap.items[0].item_id).toBeGreaterThan(ID_BLOCK);
    const mine = a.links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 2 }));
    expect(snap.links.some((l) => l.link_id === mine.linkId)).toBe(false);
    await a.flush();
  });

  it('a local write racing a refresh is not undone', async () => {
    const client = newClient();
    const a = await open(client);
    const b = await open(client);
    b.items.put(UserDataItem.json(OWNER, 'c', 'other', 1));
    a.items.put(UserDataItem.json(OWNER, 'c', 'mine', 1)); // not flushed yet when b's change event reaches a
    await b.flush();
    await a.flush();
    await tick();
    expect(a.items.get(OWNER, 'c', 'mine')).toBeDefined();
    expect(a.items.get(OWNER, 'c', 'other')).toBeDefined();
    expect(b.items.get(OWNER, 'c', 'mine')).toBeDefined();
  });

  it('a wipe empties every store, reports it, and issues fresh non-colliding ids', async () => {
    const client = newClient();
    const a = await open(client);
    const b = await open(client);
    for (let i = 0; i < 3; i++) a.items.put(UserDataItem.json(OWNER, 'c', `k${i}`, i));
    await a.flush();
    await tick();
    const removed: unknown[] = [];
    b.onRemoteChange((c) => removed.push(...c));
    await client.request({ op: 'wipe' });
    await tick();
    expect(a.db.snapshot().user_data_item).toHaveLength(0);
    expect(b.db.snapshot().user_data_item).toHaveLength(0);
    expect(removed.length).toBe(3);
    // the new database restarted its sequences: stores re-reserve, and a sync-style insert lands above
    a.items.put(UserDataItem.json(OWNER, 'c', 'after', 1));
    client.sql().execute("INSERT INTO user_data_item (owner_uuid, collection, item_key) VALUES (?, 'c', 'sync')", [OWNER]);
    await a.flush();
    await tick();
    const rows = a.db.snapshot().user_data_item;
    expect(new Set(rows.map((r) => r.item_id)).size).toBe(rows.length);
  });

  it('keeps failed writes queued, reports them and retries', async () => {
    const client = newClient();
    const a = await open(client);
    const errors: unknown[] = [];
    a.onError((e) => errors.push(e));
    const real = client.call;
    let failing = true;
    (a as unknown as { client: { call: typeof real } }).client = {
      ...client,
      call: (...args: Parameters<typeof real>) => (failing && args[1] === 'applyChanges' ? Promise.reject(new Error('quota')) : real(...args)),
    } as never;
    a.items.put(UserDataItem.json(OWNER, 'c', 'k', 1));
    await expect(a.flush()).rejects.toThrow('quota');
    expect(errors).toHaveLength(2);
    failing = false;
    await a.flush();
    expect((await client.call<{ items: unknown[] }>('userDataMirror', 'readSnapshot')).items).toHaveLength(1);
  });

  it('imports the old IndexedDB store on open, keeping ids and links, and leaves IndexedDB intact', async () => {
    const idb = new IDBFactory();
    const old = await WebUserData.open({ indexedDB: idb, channelName: null });
    const it1 = old.items.put(UserDataItem.json(OWNER, 'c', 'one', { n: 1 }, { sortOrder: 2 }));
    const it2 = old.items.put(UserDataItem.json(OWNER, 'c', 'two', { n: 2 }));
    const ln = old.links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: it2.itemId!, verseIdStart: 43003016, verseIdEnd: 43003017 }));
    await old.flush();
    const before = old.db.snapshot();
    old.close();

    const client = newClient(idb);
    const store = await open(client);
    expect(store.db.snapshot()).toEqual(before);
    expect(store.items.get(OWNER, 'c', 'one')?.itemId).toBe(it1.itemId);
    expect(store.links.getForSource('user_data_item', it2.itemId!)[0].linkId).toBe(ln.linkId);
    // new ids continue above the imported ones
    const fresh = store.items.put(UserDataItem.json(OWNER, 'c', 'three', 3));
    expect(fresh.itemId!).toBeGreaterThan(it2.itemId!);
    await store.flush();
    // the IndexedDB store is still there and unchanged
    const again = await WebUserData.open({ indexedDB: idb, channelName: null });
    expect(again.db.snapshot()).toEqual(before);
    again.close();
  });
});
