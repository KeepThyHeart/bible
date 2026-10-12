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
});
