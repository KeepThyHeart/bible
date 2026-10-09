// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Sync } from '@bible/core/browser';
import { IndexedDbSecretStore, SECRETS_DB_NAME, SECRETS_STORE_NAME } from './IndexedDbSecretStore';

const open: IndexedDbSecretStore[] = [];
afterEach(() => { for (const s of open.splice(0)) s.close(); });
function make(f: IDBFactory) {
  const s = new IndexedDbSecretStore({ indexedDB: f });
  open.push(s);
  return s;
}

/** Read every raw record straight from IndexedDB, bypassing the store. */
async function rawRecords(f: IDBFactory): Promise<Array<[IDBValidKey, unknown]>> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = f.open(SECRETS_DB_NAME);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const out: Array<[IDBValidKey, unknown]> = [];
  await new Promise<void>((res, rej) => {
    const c = db.transaction(SECRETS_STORE_NAME, 'readonly').objectStore(SECRETS_STORE_NAME).openCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res();
    };
    c.onerror = () => rej(c.error);
  });
  db.close();
  return out;
}

const secret = () => Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 0xff);
function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

describe('IndexedDbSecretStore', () => {
  it('round trips and reports persistent', async () => {
    const s = make(new IDBFactory());
    expect(s.persistence).toBe('persistent');
    expect(await s.get('sync.unlocked')).toBeNull();
    await s.set('sync.unlocked', secret());
    expect(await s.get('sync.unlocked')).toEqual(secret());
  });

  it('survives reopening the database with the same key', async () => {
    const f = new IDBFactory();
    await make(f).set('sync.token', secret());
    expect(await make(f).get('sync.token')).toEqual(secret());
  });

  it('stores only wrapped bytes, never the plaintext', async () => {
    const f = new IDBFactory();
    const s = make(f);
    await s.set('sync.unlocked', secret());
    const records = await rawRecords(f);
    const values = records.filter(([k]) => k !== 'wrapKey').map(([, v]) => new Uint8Array(v as ArrayBuffer | Uint8Array));
    expect(values).toHaveLength(1);
    expect(values[0].length).toBe(12 + 64 + 16);
    expect(contains(values[0], secret())).toBe(false);
    expect(contains(values[0], secret().subarray(0, 16))).toBe(false);
  });

  it('uses a fresh nonce for every write', async () => {
    const f = new IDBFactory();
    const s = make(f);
    await s.set('sync.token', secret());
    const a = new Uint8Array((await rawRecords(f)).find(([k]) => k !== 'wrapKey')![1] as Uint8Array);
    await s.set('sync.token', secret());
    const b = new Uint8Array((await rawRecords(f)).find(([k]) => k !== 'wrapKey')![1] as Uint8Array);
    expect(a.slice(0, 12)).not.toEqual(b.slice(0, 12));
  });

  it('keeps the wrapping key non-extractable', async () => {
    const f = new IDBFactory();
    await make(f).set('sync.token', secret());
    const key = (await rawRecords(f)).find(([k]) => k === 'wrapKey')![1] as CryptoKey;
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe('AES-GCM');
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('binds the value to its name (AAD): a moved record fails to decrypt', async () => {
    const f = new IDBFactory();
    const s = make(f);
    await s.set('sync.token', secret());
    const raw = (await rawRecords(f)).find(([k]) => k === 'value:sync.token')![1];
    const db = await new Promise<IDBDatabase>((res) => { const r = f.open(SECRETS_DB_NAME); r.onsuccess = () => res(r.result); });
    const tx = db.transaction(SECRETS_STORE_NAME, 'readwrite');
    tx.objectStore(SECRETS_STORE_NAME).put(raw, 'value:sync.unlocked');
    await new Promise<void>((res) => { tx.oncomplete = () => res(); });
    db.close();
    await expect(s.get('sync.unlocked')).rejects.toThrow();
    expect(await s.get('sync.token')).toEqual(secret());
  });

  it('rejects tampered ciphertext', async () => {
    const f = new IDBFactory();
    const s = make(f);
    await s.set('sync.token', secret());
    const raw = new Uint8Array((await rawRecords(f)).find(([k]) => k === 'value:sync.token')![1] as Uint8Array);
    raw[raw.length - 1] ^= 1;
    const db = await new Promise<IDBDatabase>((res) => { const r = f.open(SECRETS_DB_NAME); r.onsuccess = () => res(r.result); });
    const tx = db.transaction(SECRETS_STORE_NAME, 'readwrite');
    tx.objectStore(SECRETS_STORE_NAME).put(raw, 'value:sync.token');
    await new Promise<void>((res) => { tx.oncomplete = () => res(); });
    db.close();
    await expect(s.get('sync.token')).rejects.toThrow();
  });

  it('delete removes one entry; deleteAll removes entries and the key', async () => {
    const f = new IDBFactory();
    const s = make(f);
    await s.set('sync.token', secret());
    await s.set('sync.unlocked', secret());
    await s.delete('sync.token');
    expect(await s.get('sync.token')).toBeNull();
    expect(await s.get('sync.unlocked')).toEqual(secret());
    await s.deleteAll();
    expect(await rawRecords(f)).toEqual([]);
    expect(await s.get('sync.unlocked')).toBeNull();
    // usable again with a brand new key
    await s.set('sync.unlocked', secret());
    expect(await s.get('sync.unlocked')).toEqual(secret());
  });

  it('concurrent first writes agree on one wrapping key', async () => {
    const f = new IDBFactory();
    const a = make(f);
    const b = make(f);
    await Promise.all([a.set('sync.token', secret()), b.set('sync.unlocked', secret())]);
    expect(await a.get('sync.unlocked')).toEqual(secret());
    expect(await b.get('sync.token')).toEqual(secret());
  });

  it('memory mode (MemorySecretStore) leaves IndexedDB empty', async () => {
    const f = new IDBFactory();
    const m = new Sync.MemorySecretStore();
    await m.set('sync.unlocked', secret());
    expect(await m.get('sync.unlocked')).toEqual(secret());
    expect(m.persistence).toBe('memory');
    const dbs = await f.databases();
    expect(dbs.find((d) => d.name === SECRETS_DB_NAME)).toBeUndefined();
  });
});
