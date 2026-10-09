/**
 * Persistent secret store for the web app (contracts 0063 section 12). Runs inside the user-DB worker.
 *
 * A non-extractable AES-GCM CryptoKey, generated once and kept in IndexedDB as a CryptoKey object, wraps each value
 * with a fresh 12-byte nonce and AAD = utf8(name). Only `nonce || ciphertext` is stored, so a copy of the IndexedDB
 * files alone yields no plaintext; the raw wrapping key cannot be read back by script (exportKey rejects).
 */
import type { Sync } from '@bible/core/browser';

type ISecretStore = Sync.ISecretStore;
type SecretName = Sync.SecretName;

export const SECRETS_DB_NAME = 'kth-secrets';
export const SECRETS_STORE_NAME = 'keys';
const WRAP_KEY_ID = 'wrapKey';
const VALUE_PREFIX = 'value:';
const NONCE_LEN = 12;

export interface IndexedDbSecretStoreOptions {
  indexedDB?: IDBFactory;
  crypto?: Crypto;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IndexedDbSecretStore implements ISecretStore {
  readonly persistence = 'persistent' as const;
  private readonly idb: IDBFactory;
  private readonly crypto: Crypto;
  private db: Promise<IDBDatabase> | null = null;
  private key: Promise<CryptoKey> | null = null;

  constructor(options: IndexedDbSecretStoreOptions = {}) {
    this.idb = options.indexedDB ?? globalThis.indexedDB;
    this.crypto = options.crypto ?? globalThis.crypto;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const r = this.idb.open(SECRETS_DB_NAME, 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains(SECRETS_STORE_NAME)) r.result.createObjectStore(SECRETS_STORE_NAME);
        };
        r.onsuccess = () => {
          r.result.onversionchange = () => { r.result.close(); this.db = null; this.key = null; };
          resolve(r.result);
        };
        r.onerror = () => reject(r.error ?? new Error('Cannot open secret store'));
      });
      this.db.catch(() => { this.db = null; });
    }
    return this.db;
  }

  /** Gets the wrapping key, creating it once. Safe against concurrent creators (first writer wins). */
  private wrapKey(): Promise<CryptoKey> {
    if (!this.key) {
      this.key = (async () => {
        const db = await this.open();
        const existing = await req(db.transaction(SECRETS_STORE_NAME, 'readonly').objectStore(SECRETS_STORE_NAME).get(WRAP_KEY_ID));
        if (existing) return existing as CryptoKey;
        const fresh = await this.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const tx = db.transaction(SECRETS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SECRETS_STORE_NAME);
        const raced = await req(store.get(WRAP_KEY_ID));
        if (!raced) store.put(fresh, WRAP_KEY_ID);
        await txDone(tx);
        return (raced as CryptoKey | undefined) ?? fresh;
      })();
      this.key.catch(() => { this.key = null; });
    }
    return this.key;
  }

  async get(name: SecretName): Promise<Uint8Array | null> {
    const db = await this.open();
    const stored = await req(db.transaction(SECRETS_STORE_NAME, 'readonly').objectStore(SECRETS_STORE_NAME).get(VALUE_PREFIX + name));
    if (!stored) return null;
    const bytes = new Uint8Array(stored as ArrayBuffer | Uint8Array);
    if (bytes.length < NONCE_LEN + 16) throw new Error('Stored secret is malformed');
    const key = await this.wrapKey();
    try {
      const plain = await this.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.slice(0, NONCE_LEN), additionalData: new TextEncoder().encode(name) },
        key,
        bytes.slice(NONCE_LEN),
      );
      return new Uint8Array(plain);
    } catch {
      throw new Error('Stored secret could not be decrypted');
    }
  }

  async set(name: SecretName, value: Uint8Array): Promise<void> {
    const key = await this.wrapKey();
    const nonce = this.crypto.getRandomValues(new Uint8Array(NONCE_LEN));
    const ct = new Uint8Array(
      await this.crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(name) }, key, value.slice()),
    );
    const out = new Uint8Array(NONCE_LEN + ct.length);
    out.set(nonce, 0);
    out.set(ct, NONCE_LEN);
    const db = await this.open();
    const tx = db.transaction(SECRETS_STORE_NAME, 'readwrite');
    tx.objectStore(SECRETS_STORE_NAME).put(out, VALUE_PREFIX + name);
    await txDone(tx);
  }

  async delete(name: SecretName): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(SECRETS_STORE_NAME, 'readwrite');
    tx.objectStore(SECRETS_STORE_NAME).delete(VALUE_PREFIX + name);
    await txDone(tx);
  }

  /** Sign-out wipe: removes every entry and the wrapping key itself. */
  async deleteAll(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(SECRETS_STORE_NAME, 'readwrite');
    tx.objectStore(SECRETS_STORE_NAME).clear();
    await txDone(tx);
    this.key = null;
  }

  close(): void {
    const p = this.db;
    this.db = null;
    this.key = null;
    void p?.then((d) => d.close(), () => undefined);
  }
}
