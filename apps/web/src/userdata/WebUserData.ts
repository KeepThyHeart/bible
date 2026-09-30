/**
 * The web app's local user-data store.
 *
 * `IUserDataRepository` and `IVerseLinkRepository` are synchronous (the desktop
 * runs them over SQLite), and IndexedDB is not. So the store keeps every row in
 * a `MemoryUserDb` and writes each change through to IndexedDB in coalesced
 * transactions: reads are instant and identical to desktop, writes become
 * durable a moment later (`flush()` waits for that).
 *
 * The data set is small by design (settings-like records, lists, links), so
 * holding it in memory is cheap. If the store ever needs to hold megabytes, this
 * class is the seam where `@sqlite.org/sqlite-wasm` on OPFS replaces it (see
 * `docs/user-data-store.md`); callers only see the repository interfaces.
 *
 * Several tabs:
 * - Every tab loads the full store and applies the changes other tabs make,
 *   delivered over a `BroadcastChannel` after those tabs' transactions commit.
 *   Last write wins per key, exactly as in IndexedDB.
 * - Item and link ids come from blocks reserved in an IndexedDB transaction
 *   (transactions serialize across tabs), so two tabs never issue the same id.
 * - IndexedDB is the truth: a tab that opens later reads what was committed.
 *
 * If IndexedDB cannot be opened (a browser that blocks site data), the store still
 * works for the session in memory and reports `persistent: false`.
 */
import { UserData } from '@bible/core/browser';

type MemoryUserDb = UserData.MemoryUserDb;
type UserDataChange = UserData.UserDataChange;
type UserDataItemRow = UserData.UserDataItemRow;
type VerseLinkRow = UserData.VerseLinkRow;

const DB_VERSION = 1;
const ITEMS = 'user_data_item';
const LINKS = 'verse_link';
const META = 'meta';
/** Ids reserved per tab per block. Large enough that a tab cannot exhaust one in a single synchronous burst. */
export const ID_BLOCK = 1_000_000;
const MESSAGE_CHUNK = 500;

export interface WebUserDataOptions {
  /** Defaults to the global `indexedDB`. */
  indexedDB?: IDBFactory | null;
  /** Database name. Default `kth-user-data`. */
  dbName?: string;
  /** Broadcast channel name; `null` disables cross-tab sync. Default `kth-user-data`. */
  channelName?: string | null;
  now?: () => Date;
}

export interface PersistenceStatus {
  /** The browser has a storage API at all. */
  supported: boolean;
  /** Storage is marked persistent (not evictable under pressure). */
  persisted: boolean;
}

interface Block {
  next: number;
  end: number;
}

type Kind = 'item' | 'link';

interface MetaRow {
  name: string;
  next: number;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: ['owner_uuid', 'collection', 'item_key'] });
      if (!db.objectStoreNames.contains(LINKS)) db.createObjectStore(LINKS, { keyPath: 'link_id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

export class WebUserData {
  /** The store. Prefer `items` and `links`; the raw db is for backup and tests. */
  readonly db: MemoryUserDb;
  readonly items: MemoryUserDb['items'];
  readonly links: MemoryUserDb['links'];
  /** False when IndexedDB was unavailable and the store lives in memory only. */
  readonly persistent: boolean;

  private idb: IDBDatabase | null = null;
  private channel: BroadcastChannel | null = null;
  private pending: UserDataChange[] = [];
  private chain: Promise<void> = Promise.resolve();
  private scheduled = false;
  private lastError: unknown = null;
  private readonly blocks: Record<Kind, Block[]> = { item: [], link: [] };
  private readonly refilling: Record<Kind, boolean> = { item: false, link: false };
  private readonly remoteListeners = new Set<(changes: UserDataChange[]) => void>();
  private readonly errorListeners = new Set<(error: unknown) => void>();
  private closed = false;

  private constructor(idb: IDBDatabase | null, options: WebUserDataOptions) {
    this.idb = idb;
    this.persistent = idb !== null;
    this.db = new UserData.MemoryUserDb({
      now: options.now,
      nextItemId: () => this.allocate('item'),
      nextLinkId: () => this.allocate('link'),
    });
    this.items = this.db.items;
    this.links = this.db.links;
  }

  /** Open (creating if needed) and load the store. Never rejects: falls back to a memory-only store. */
  static async open(options: WebUserDataOptions = {}): Promise<WebUserData> {
    const factory = options.indexedDB === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : options.indexedDB;
    let idb: IDBDatabase | null = null;
    if (factory) {
      try {
        idb = await openDatabase(factory, options.dbName ?? 'kth-user-data');
      } catch {
        idb = null;
      }
    }
    const store = new WebUserData(idb, options);
    if (!idb) {
      // Memory-only: ids still need a source.
      store.blocks.item.push({ next: 1, end: Number.MAX_SAFE_INTEGER });
      store.blocks.link.push({ next: 1, end: Number.MAX_SAFE_INTEGER });
      return store;
    }
    const buffered: UserDataChange[][] = [];
    let hydrated = false;
    const channelName = options.channelName === undefined ? 'kth-user-data' : options.channelName;
    if (channelName && typeof BroadcastChannel !== 'undefined') {
      store.channel = new BroadcastChannel(channelName);
      store.channel.onmessage = (ev: MessageEvent) => {
        const changes = (ev.data as { changes?: UserDataChange[] } | null)?.changes;
        if (!Array.isArray(changes)) return;
        if (hydrated) store.applyRemote(changes);
        else buffered.push(changes);
      };
    }
    try {
      await store.hydrate();
      hydrated = true;
      for (const c of buffered) store.applyRemote(c);
    } catch (e) {
      store.close();
      // Could not read the database: degrade rather than break the app.
      const fallback = await WebUserData.open({ ...options, indexedDB: null });
      fallback.lastError = e;
      return fallback;
    }
    store.db.subscribe((c) => store.enqueue(c));
    return store;
  }

  // --- loading and ids ---------------------------------------------------------------------

  private async hydrate(): Promise<void> {
    const idb = this.idb!;
    const tx = idb.transaction([ITEMS, LINKS], 'readonly');
    const [items, links] = await Promise.all([
      request(tx.objectStore(ITEMS).getAll() as IDBRequest<UserDataItemRow[]>),
      request(tx.objectStore(LINKS).getAll() as IDBRequest<VerseLinkRow[]>),
    ]);
    this.db.load(items, links);
    const top = this.db.maxIds();
    await Promise.all([this.reserve('item', top.item), this.reserve('link', top.link)]);
  }

  /** Reserve a fresh id block in a transaction other tabs cannot interleave with. */
  private async reserve(kind: Kind, atLeastAbove = 0): Promise<void> {
    const tx = this.idb!.transaction(META, 'readwrite');
    const store = tx.objectStore(META);
    const name = `ids:${kind}`;
    const row = (await request(store.get(name) as IDBRequest<MetaRow | undefined>)) ?? { name, next: 1 };
    const start = Math.max(row.next, atLeastAbove + 1);
    store.put({ name, next: start + ID_BLOCK } satisfies MetaRow);
    await done(tx);
    this.blocks[kind].push({ next: start, end: start + ID_BLOCK });
  }

  private allocate(kind: Kind): number {
    const blocks = this.blocks[kind];
    while (blocks.length > 0 && blocks[0].next >= blocks[0].end) blocks.shift();
    if (blocks.length === 0) throw new Error('user-data id block exhausted; reopen the store');
    const id = blocks[0].next++;
    const remaining = blocks.reduce((n, b) => n + (b.end - b.next), 0);
    if (this.idb && remaining < ID_BLOCK / 2 && !this.refilling[kind]) {
      this.refilling[kind] = true;
      this.reserve(kind)
        .catch((e) => this.fail(e))
        .finally(() => {
          this.refilling[kind] = false;
        });
    }
    return id;
  }

  // --- writing ---------------------------------------------------------------------------------

  private enqueue(change: UserDataChange): void {
    if (!this.idb) return;
    this.pending.push(change);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.chain = this.chain.then(() => this.drain());
    });
  }

  private async drain(): Promise<void> {
    if (this.pending.length === 0 || !this.idb || this.closed) return;
    const batch = this.pending;
    this.pending = [];
    try {
      const tx = this.idb.transaction([ITEMS, LINKS], 'readwrite');
      const items = tx.objectStore(ITEMS);
      const links = tx.objectStore(LINKS);
      for (const c of batch) {
        if (c.type === 'item:put') items.put(c.row);
        else if (c.type === 'item:delete') items.delete([c.ownerUuid, c.collection, c.itemKey]);
        else if (c.type === 'link:put') links.put(c.row);
        else links.delete(c.linkId);
      }
      await done(tx);
      this.lastError = null;
    } catch (e) {
      // Keep the changes for the next attempt (a quota error may clear) and tell whoever listens.
      this.pending = batch.concat(this.pending);
      this.fail(e);
      return;
    }
    if (this.channel) {
      for (let i = 0; i < batch.length; i += MESSAGE_CHUNK) this.channel.postMessage({ changes: batch.slice(i, i + MESSAGE_CHUNK) });
    }
  }

  private fail(error: unknown): void {
    this.lastError = error;
    for (const l of [...this.errorListeners]) l(error);
  }

  /** Resolves when every change made so far is committed to IndexedDB. Rejects if the last write failed. */
  async flush(): Promise<void> {
    if (!this.idb) return;
    this.scheduled = false;
    this.chain = this.chain.then(() => this.drain());
    await this.chain;
    if (this.pending.length > 0 && this.lastError) throw this.lastError;
  }

  /** Be told when a background write fails (quota, storage cleared). The changes stay queued and retry with the next write. */
  onError(listener: (error: unknown) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  // --- other tabs -----------------------------------------------------------------------------

  private applyRemote(changes: UserDataChange[]): void {
    for (const c of changes) this.db.applyRemote(c);
    for (const l of [...this.remoteListeners]) l(changes);
  }

  /** Be told about changes committed by other tabs (already applied to this tab's store). */
  onRemoteChange(listener: (changes: UserDataChange[]) => void): () => void {
    this.remoteListeners.add(listener);
    return () => this.remoteListeners.delete(listener);
  }

  // --- persistence and lifecycle -------------------------------------------------------------

  /**
   * Ask the browser to keep this origin's storage. Call it after the user has
   * saved something worth keeping; some browsers prompt, others decide silently.
   */
  async requestPersistence(): Promise<PersistenceStatus> {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage || typeof storage.persist !== 'function') return { supported: false, persisted: false };
    try {
      let persisted = typeof storage.persisted === 'function' ? await storage.persisted() : false;
      if (!persisted) persisted = await storage.persist();
      return { supported: true, persisted };
    } catch {
      return { supported: true, persisted: false };
    }
  }

  /** Export as backup format v1: a `.zip`, or an encrypted `.bbk` when a password is given. */
  exportBackup(options: Omit<Parameters<typeof UserData.exportUserData>[1], 'app'> & { app?: Parameters<typeof UserData.exportUserData>[1]['app'] } = {}) {
    return UserData.exportUserData(this.db, { app: { name: 'Keep Thy Heart', version: '0', platform: 'web' }, ...options });
  }

  /** Import a `.zip` or `.bbk`; the changes persist like any other write. */
  async importBackup(file: Uint8Array, options: Parameters<typeof UserData.importUserData>[2] = {}) {
    const report = await UserData.importUserData(this.db, file, options);
    await this.flush();
    return report;
  }

  close(): void {
    this.closed = true;
    this.channel?.close();
    this.channel = null;
    this.idb?.close();
    this.idb = null;
  }
}
