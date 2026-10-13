// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { wipeBrowserStores } from './wipeStores';

function create(idb: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('s');
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

describe('wipeBrowserStores', () => {
  it('deletes kth-secrets and kth-user-data and leaves other databases', async () => {
    const idb = new IDBFactory();
    for (const n of ['kth-secrets', 'kth-user-data', 'kth-offline']) await create(idb, n);
    await wipeBrowserStores(idb);
    const names = (await idb.databases()).map((d) => d.name).sort();
    expect(names).toEqual(['kth-offline']);
  });

  it('is fine when the stores are absent or there is no IndexedDB', async () => {
    await expect(wipeBrowserStores(new IDBFactory())).resolves.toBeUndefined();
    await expect(wipeBrowserStores(undefined)).resolves.toBeUndefined();
  });

  it('settles within the timeout (wipe_incomplete) when another connection ignores versionchange', async () => {
    const idb = new IDBFactory();
    await create(idb, 'kth-secrets');
    // A holder that never closes.
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open('kth-user-data', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('s');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    held.onversionchange = () => undefined;
    const started = Date.now();
    await expect(wipeBrowserStores(idb, 50)).rejects.toMatchObject({ code: 'wipe_incomplete' });
    expect(Date.now() - started).toBeLessThan(2000);
    held.close();
  });
});
