/**
 * The user-data store on the local user database (flag `localUserDb`): `UserDataStore` over the user-DB worker.
 *
 * Same seam as `WebUserData`: the synchronous `IUserDataRepository` / `IVerseLinkRepository` are a `MemoryUserDb`
 * mirror held in the tab; every change is written through to the worker (`userDataMirror.applyChanges`, coalesced
 * per microtask, one SQLite transaction) instead of IndexedDB.
 *
 * - Open: one-shot import of the old IndexedDB store (`op:'import'`), snapshot, `MemoryUserDb.load`, then one id
 *   block per kind reserved in the worker (`reserveIds` bumps `sqlite_sequence`, so a later insert by sync or
 *   another repo always lands above every reserved block).
 * - Other tabs, sync pulls and wipes arrive as `changed` events: the store flushes its own writes, re-reads the
 *   snapshot, diffs it against the mirror and applies the difference with `applyRemote` (then `onRemoteChange`).
 *   A refresh that races a local write is discarded and retried, so a local change is never undone.
 * - A wipe resets the worker's sequences; blocks beyond the sequence are detected (`reserveIds(kind, 0)`) and
 *   re-reserved after every refresh.
 * Lazy chunk only: reached through `await import('../userdb/OpfsUserData')` from `userdata/userData.ts`.
 */
import { UserData } from '@bible/core/browser';
import type { PersistenceStatus, UserDataStore } from '../userdata/types';
import type { UserDbClient } from './UserDbClient';

type UserDataChange = UserData.UserDataChange;
type UserDataItemRow = UserData.UserDataItemRow;
type VerseLinkRow = UserData.VerseLinkRow;
type Kind = 'item' | 'link';
interface Block { next: number; end: number }

/** Ids reserved per tab per block (same as `WebUserData`). */
export const ID_BLOCK = 1_000_000;
const MAX_REFRESH_ATTEMPTS = 5;

export interface OpfsUserDataOptions {
  /** Defaults to the page's `getUserDbClient()`. Tests pass a client over an in-process handler. */
  client?: Pick<UserDbClient, 'call' | 'request' | 'onEvent'>;
  now?: () => Date;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class OpfsUserData implements UserDataStore {
  readonly db: UserData.MemoryUserDb;
  readonly items: UserData.MemoryUserDb['items'];
  readonly links: UserData.MemoryUserDb['links'];
  readonly persistent = true;

  private pending: UserDataChange[] = [];
  private chain: Promise<void> = Promise.resolve();
  private scheduled = false;
  private lastError: unknown = null;
  private localVersion = 0;
  private refreshQueued = false;
  private closed = false;
  private readonly blocks: Record<Kind, Block[]> = { item: [], link: [] };
  private readonly refilling: Record<Kind, boolean> = { item: false, link: false };
  private readonly remoteListeners = new Set<(changes: UserDataChange[]) => void>();
  private readonly errorListeners = new Set<(error: unknown) => void>();
  private offEvents: (() => void) | null = null;

  private constructor(private readonly client: NonNullable<OpfsUserDataOptions['client']>, options: OpfsUserDataOptions) {
    this.db = new UserData.MemoryUserDb({
      now: options.now,
      nextItemId: () => this.allocate('item'),
      nextLinkId: () => this.allocate('link'),
    });
    this.items = this.db.items;
    this.links = this.db.links;
  }

  /** Open the worker DB, import the IndexedDB store once, load the mirror. Rejects when the worker is unusable. */
  static async open(options: OpfsUserDataOptions = {}): Promise<OpfsUserData> {
    const client = options.client ?? (await (await import('./client')).getUserDbClient());
    const store = new OpfsUserData(client, options);
    await client.request({ op: 'import', source: 'kth-user-data' });
    const snap = await store.readSnapshot();
    store.db.load(snap.items, snap.links);
    await Promise.all([store.reserve('item'), store.reserve('link')]);
    store.db.subscribe((c) => store.enqueue(c));
    store.offEvents = client.onEvent((e) => {
      if (e.event === 'changed' && e.tables.some((t) => t === 'user_data_item' || t === 'verse_link')) store.scheduleRefresh();
    });
    return store;
  }

  // --- ids ------------------------------------------------------------------------------------

  private async reserve(kind: Kind): Promise<void> {
    const { start, end } = await this.client.call<{ start: number; end: number }>('userDataMirror', 'reserveIds', kind, ID_BLOCK);
    this.blocks[kind].push({ next: start, end });
  }

  private allocate(kind: Kind): number {
    const blocks = this.blocks[kind];
    while (blocks.length > 0 && blocks[0].next >= blocks[0].end) blocks.shift();
    if (blocks.length === 0) throw new Error('user-data id block exhausted; reopen the store');
    const id = blocks[0].next++;
    const remaining = blocks.reduce((n, b) => n + (b.end - b.next), 0);
    if (remaining < ID_BLOCK / 2 && !this.refilling[kind] && !this.closed) {
      this.refilling[kind] = true;
      this.reserve(kind)
        .catch((e) => this.fail(e))
        .finally(() => {
          this.refilling[kind] = false;
        });
    }
    return id;
  }

  /** After a wipe the worker's sequences restart: drop blocks that lie beyond them and reserve fresh ones. */
  private async verifyBlocks(): Promise<void> {
    for (const kind of ['item', 'link'] as const) {
      const probe = await this.client.call<{ start: number; end: number }>('userDataMirror', 'reserveIds', kind, 0);
      const stale = this.blocks[kind].some((b) => b.end - 1 > probe.start - 1);
      if (stale) {
        this.blocks[kind] = [];
        await this.reserve(kind);
      }
    }
  }

  // --- writing --------------------------------------------------------------------------------

  private enqueue(change: UserDataChange): void {
    this.localVersion++;
    this.pending.push(change);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.chain = this.chain.then(() => this.drain());
    });
  }

  private async drain(): Promise<void> {
    if (this.pending.length === 0 || this.closed) return;
    const batch = this.pending;
    this.pending = [];
    try {
      await this.client.call('userDataMirror', 'applyChanges', batch);
      this.lastError = null;
    } catch (e) {
      // Keep the changes for the next attempt and tell whoever listens.
      this.pending = batch.concat(this.pending);
      this.fail(e);
    }
  }

  private fail(error: unknown): void {
    this.lastError = error;
    for (const l of [...this.errorListeners]) l(error);
  }

  async flush(): Promise<void> {
    this.scheduled = false;
    this.chain = this.chain.then(() => this.drain());
    await this.chain;
    if (this.pending.length > 0 && this.lastError) throw this.lastError;
  }

  onError(listener: (error: unknown) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  // --- other tabs, sync, wipes ----------------------------------------------------------------

  private readSnapshot() {
    return this.client.call<{ items: UserDataItemRow[]; links: VerseLinkRow[] }>('userDataMirror', 'readSnapshot');
  }

  private scheduleRefresh(): void {
    if (this.refreshQueued || this.closed) return;
    this.refreshQueued = true;
    this.chain = this.chain.then(async () => {
      this.refreshQueued = false;
      try {
        await this.refresh();
      } catch (e) {
        this.fail(e);
      }
    });
  }

  /** Read the worker's rows and bring the mirror to them. Runs on the chain (never concurrently with a drain). */
  private async refresh(): Promise<void> {
    for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS && !this.closed; attempt++) {
      await this.drain();
      const version = this.localVersion;
      const snap = await this.readSnapshot();
      if (version !== this.localVersion || this.pending.length > 0) continue; // a local write raced the read: try again
      const changes = this.diff(snap.items, snap.links);
      for (const c of changes) this.db.applyRemote(c);
      await this.verifyBlocks();
      if (changes.length > 0) for (const l of [...this.remoteListeners]) l(changes);
      return;
    }
  }

  private diff(items: UserDataItemRow[], links: VerseLinkRow[]): UserDataChange[] {
    const mirror = this.db.snapshot();
    const changes: UserDataChange[] = [];
    const key = (r: UserDataItemRow) => JSON.stringify([r.owner_uuid, r.collection, r.item_key]);
    const have = new Map(mirror.user_data_item.map((r) => [key(r), r]));
    const seen = new Set<string>();
    for (const row of items) {
      const k = key(row);
      seen.add(k);
      const mine = have.get(k);
      if (!mine || !sameJson(mine, { ...mine, ...row })) changes.push({ type: 'item:put', row });
    }
    for (const [k, r] of have) {
      if (!seen.has(k)) changes.push({ type: 'item:delete', ownerUuid: r.owner_uuid, collection: r.collection, itemKey: r.item_key });
    }
    const haveLinks = new Map(mirror.verse_link.map((r) => [r.link_id, r]));
    const seenLinks = new Set<number>();
    for (const row of links) {
      seenLinks.add(row.link_id);
      const mine = haveLinks.get(row.link_id);
      if (!mine || !sameJson(mine, { ...mine, ...row })) changes.push({ type: 'link:put', row });
    }
    for (const id of haveLinks.keys()) if (!seenLinks.has(id)) changes.push({ type: 'link:delete', linkId: id });
    return changes;
  }

  onRemoteChange(listener: (changes: UserDataChange[]) => void): () => void {
    this.remoteListeners.add(listener);
    return () => this.remoteListeners.delete(listener);
  }

  // --- persistence and lifecycle --------------------------------------------------------------

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

  exportBackup(options: Omit<Parameters<typeof UserData.exportUserData>[1], 'app'> & { app?: Parameters<typeof UserData.exportUserData>[1]['app'] } = {}) {
    return UserData.exportUserData(this.db, { app: { name: 'Keep Thy Heart', version: '0', platform: 'web' }, ...options });
  }

  async importBackup(file: Uint8Array, options: Parameters<typeof UserData.importUserData>[2] = {}) {
    const report = await UserData.importUserData(this.db, file, options);
    await this.flush();
    return report;
  }

  /** Stops listening; the shared worker client stays open (other features use it). */
  close(): void {
    this.closed = true;
    this.offEvents?.();
    this.offEvents = null;
  }
}
