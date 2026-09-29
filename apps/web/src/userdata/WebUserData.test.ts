import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { UserData } from '@bible/core/browser';
import { userDataContract } from '../../../../packages/core/src/__tests__/contracts/userDataContract';
import { ID_BLOCK, WebUserData } from './WebUserData';

const { UserDataItem, VerseLinkRecord, appOwner } = UserData;
const harness = { describe, it, expect, beforeEach, afterEach };
const tick = () => new Promise((r) => setTimeout(r, 20));

let opened: WebUserData[] = [];
async function open(factory: IDBFactory, channelName: string | null = null): Promise<WebUserData> {
  const store = await WebUserData.open({ indexedDB: factory, channelName });
  opened.push(store);
  return store;
}
afterEach(() => {
  for (const s of opened) s.close();
  opened = [];
});

// The same contract the desktop SQLite repositories pass.
userDataContract(harness, 'IndexedDB-backed WebUserData', async () => {
  const store = await open(new IDBFactory());
  return { items: store.items, links: store.links, settle: () => store.flush() };
});

describe('WebUserData persistence', () => {
  it('survives a reopen: items, links, ids and dates', async () => {
    const factory = new IDBFactory();
    const a = await open(factory);
    const item = a.items.put(UserDataItem.json(appOwner('t'), 'c', 'k', { v: 1 }, { sortOrder: 3, metadata: { m: 1 } }));
    a.links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: item.itemId!, verseIdStart: 43003016 }));
    await a.flush();
    a.close();

    const b = await open(factory);
    const back = b.items.get(appOwner('t'), 'c', 'k')!;
    expect(back.parsedValue()).toEqual({ v: 1 });
    expect(back.itemId).toBe(item.itemId);
    expect(back.createdDate).toBe(item.createdDate);
    expect(back.metadata).toEqual({ m: 1 });
    expect(b.links.getForSource('user_data_item', item.itemId!)).toHaveLength(1);
  });

  it('persists removals and clears', async () => {
    const factory = new IDBFactory();
    const a = await open(factory);
    a.items.put(UserDataItem.json('app:t', 'c', 'x', 1));
    a.items.put(UserDataItem.json('app:t', 'c', 'y', 2));
    a.items.put(UserDataItem.json('app:t', 'd', 'z', 3));
    await a.flush();
    a.items.remove('app:t', 'c', 'x');
    a.items.clearCollection('app:t', 'd');
    await a.flush();
    a.close();
    const b = await open(factory);
    expect(b.items.list('app:t', 'c').map((i) => i.itemKey)).toEqual(['y']);
    expect(b.items.list('app:t', 'd')).toEqual([]);
  });

  it('coalesces synchronous writes into one transaction', async () => {
    const factory = new IDBFactory();
    const a = await open(factory);
    const spy = vi.spyOn(a['idb']!, 'transaction');
    for (let i = 0; i < 50; i++) a.items.put(UserDataItem.json('app:t', 'c', String(i), i));
    await a.flush();
    expect(spy.mock.calls.filter(([, mode]) => mode === 'readwrite')).toHaveLength(1);
  });

  it('keeps failed writes queued and retries them with the next flush', async () => {
    const factory = new IDBFactory();
    const a = await open(factory);
    const errors: unknown[] = [];
    a.onError((e) => errors.push(e));
    const real = a['idb']!.transaction.bind(a['idb']!);
    const stub = vi.spyOn(a['idb']!, 'transaction').mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    a.items.put(UserDataItem.json('app:t', 'c', 'k', 1));
    await expect(a.flush()).rejects.toBeTruthy();
    expect(errors).toHaveLength(1);
    stub.mockImplementation(real);
    await a.flush();
    a.close();
    const b = await open(factory);
    expect(b.items.get('app:t', 'c', 'k')!.parsedValue()).toBe(1);
  });

  it('falls back to memory when IndexedDB is unavailable', async () => {
    const store = await WebUserData.open({ indexedDB: null });
    opened.push(store);
    expect(store.persistent).toBe(false);
    const item = store.items.put(UserDataItem.json('app:t', 'c', 'k', 1));
    expect(item.itemId).toBe(1);
    expect(store.items.get('app:t', 'c', 'k')!.parsedValue()).toBe(1);
    await expect(store.flush()).resolves.toBeUndefined();
  });

  it('falls back to memory when opening the database throws', async () => {
    const broken = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const store = await WebUserData.open({ indexedDB: broken });
    opened.push(store);
    expect(store.persistent).toBe(false);
  });
});

describe('WebUserData with several tabs', () => {
  it('hands each tab a disjoint id block', async () => {
    const factory = new IDBFactory();
    const a = await open(factory);
    const b = await open(factory);
    const ida = a.items.put(UserDataItem.json('app:t', 'c', 'a', 1)).itemId!;
    const idb = b.items.put(UserDataItem.json('app:t', 'c', 'b', 1)).itemId!;
    expect(ida).not.toBe(idb);
    expect(Math.abs(ida - idb)).toBeGreaterThanOrEqual(ID_BLOCK - 1);
  });

  it('continues ids above what an earlier session stored', async () => {
    const factory = new IDBFactory();
    const a = await open(factory);
    const first = a.items.put(UserDataItem.json('app:t', 'c', 'a', 1)).itemId!;
    await a.flush();
    a.close();
    const b = await open(factory);
    expect(b.items.put(UserDataItem.json('app:t', 'c', 'b', 1)).itemId!).toBeGreaterThan(first);
  });

  it('shows one tab\'s writes in the other, including deletes and links', async () => {
    const factory = new IDBFactory();
    const a = await open(factory, 'ch-1');
    const b = await open(factory, 'ch-1');
    const seen: number[] = [];
    b.onRemoteChange((c) => seen.push(c.length));

    const item = a.items.put(UserDataItem.json('app:t', 'c', 'k', 'from-a'));
    a.links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: item.itemId!, verseIdStart: 1 }));
    await a.flush();
    await tick();
    expect(b.items.get('app:t', 'c', 'k')!.parsedValue()).toBe('from-a');
    expect(b.links.getForVerse(1)).toHaveLength(1);
    expect(seen.length).toBeGreaterThan(0);

    a.items.remove('app:t', 'c', 'k');
    await a.flush();
    await tick();
    expect(b.items.get('app:t', 'c', 'k')).toBeUndefined();
  });

  it('does not echo remote changes back into storage', async () => {
    const factory = new IDBFactory();
    const a = await open(factory, 'ch-2');
    const b = await open(factory, 'ch-2');
    a.items.put(UserDataItem.json('app:t', 'c', 'k', 1));
    await a.flush();
    await tick();
    const spy = vi.spyOn(b['idb']!, 'transaction');
    await b.flush();
    expect(spy.mock.calls.filter(([, mode]) => mode === 'readwrite')).toHaveLength(0);
  });

  it('last write wins per key, and a later tab loads the winner', async () => {
    const factory = new IDBFactory();
    const a = await open(factory);
    const b = await open(factory);
    a.items.put(UserDataItem.json('app:t', 'c', 'k', 'a'));
    await a.flush();
    b.items.put(UserDataItem.json('app:t', 'c', 'k', 'b'));
    await b.flush();
    const c = await open(factory);
    expect(c.items.get('app:t', 'c', 'k')!.parsedValue()).toBe('b');
  });
});

describe('WebUserData backup', () => {
  it('exports and imports through backup format v1 and persists the import', async () => {
    const factory = new IDBFactory();
    const a = await open(factory);
    const item = a.items.put(UserDataItem.json(appOwner('t'), 'c', 'k', { v: 1 }));
    a.links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: item.itemId!, verseIdStart: 19023001 }));
    const out = await a.exportBackup();
    expect(out.extension).toBe('zip');

    const factory2 = new IDBFactory();
    const b = await open(factory2);
    const report = await b.importBackup(out.bytes);
    expect(report.items.added).toBe(1);
    b.close();
    const c = await open(factory2);
    expect(c.items.get(appOwner('t'), 'c', 'k')!.parsedValue()).toEqual({ v: 1 });
    expect(c.links.getForVerse(19023001)).toHaveLength(1);
  });
});

describe('requestPersistence', () => {
  it('reports unsupported when the browser has no storage API', async () => {
    const store = await open(new IDBFactory());
    const nav = vi.spyOn(globalThis, 'navigator', 'get').mockReturnValue({} as Navigator);
    expect(await store.requestPersistence()).toEqual({ supported: false, persisted: false });
    nav.mockRestore();
  });

  it('asks the browser to persist when not yet persisted', async () => {
    const store = await open(new IDBFactory());
    const persist = vi.fn().mockResolvedValue(true);
    const nav = vi.spyOn(globalThis, 'navigator', 'get').mockReturnValue({ storage: { persisted: async () => false, persist } } as unknown as Navigator);
    expect(await store.requestPersistence()).toEqual({ supported: true, persisted: true });
    expect(persist).toHaveBeenCalledOnce();
    nav.mockRestore();
  });
});
