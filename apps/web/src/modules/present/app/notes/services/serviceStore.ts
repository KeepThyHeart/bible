import type { ProseMirrorJSON } from '../editor/schema';
import { emptyDocJSON } from '../editor/schema';

/**
 * Services: each set of notes is a "service" (name + date), kept locally in
 * IndexedDB and autosaved as you type. If IndexedDB is unavailable (private
 * mode, blocked, test env) everything still works, in memory for the page's
 * lifetime.
 */
export interface Service {
  id: string;
  name: string;
  date: string;
  doc: ProseMirrorJSON;
  /** Default Bible module (translation) for references in these notes. */
  module: string;
  updatedAt: number;
}

/** Storage seam: IndexedDB in the browser, a Map in tests and as fallback. */
export interface ServiceBackend {
  getAll(): Promise<Service[]>;
  put(service: Service): Promise<void>;
  delete(id: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string | null): Promise<void>;
}

export function createMemoryBackend(): ServiceBackend {
  const services = new Map<string, Service>();
  const meta = new Map<string, string>();
  return {
    getAll: async () => [...services.values()].map((s) => structuredCloneSafe(s)),
    put: async (s) => void services.set(s.id, structuredCloneSafe(s)),
    delete: async (id) => void services.delete(id),
    getMeta: async (k) => meta.get(k) ?? null,
    setMeta: async (k, v) => void (v === null ? meta.delete(k) : meta.set(k, v)),
  };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const DB_NAME = 'bible-present';
const SERVICES = 'services';
const META = 'meta';

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Rejects if IndexedDB is missing or blocked; the store then falls back to memory. */
export function createIndexedDbBackend(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<ServiceBackend> {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error('IndexedDB unavailable'));
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(DB_NAME, 1);
    } catch (e) {
      return reject(e);
    }
    open.onupgradeneeded = () => {
      open.result.createObjectStore(SERVICES, { keyPath: 'id' });
      open.result.createObjectStore(META);
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('IndexedDB blocked'));
    open.onsuccess = () => {
      const db = open.result;
      const store = (name: string, mode: IDBTransactionMode) => db.transaction(name, mode).objectStore(name);
      resolve({
        getAll: () => reqPromise(store(SERVICES, 'readonly').getAll() as IDBRequest<Service[]>),
        put: async (s) => void (await reqPromise(store(SERVICES, 'readwrite').put(s))),
        delete: async (id) => void (await reqPromise(store(SERVICES, 'readwrite').delete(id))),
        getMeta: async (k) => ((await reqPromise(store(META, 'readonly').get(k))) as string | undefined) ?? null,
        setMeta: async (k, v) => {
          if (v === null) await reqPromise(store(META, 'readwrite').delete(k));
          else await reqPromise(store(META, 'readwrite').put(v, k));
        },
      });
    };
  });
}

export interface ServiceStoreOptions {
  /** Defaults to IndexedDB with a memory fallback. */
  backend?: ServiceBackend | Promise<ServiceBackend>;
  debounceMs?: number;
  now?: () => number;
  newId?: () => string;
  /**
   * Name of a BroadcastChannel shared by every tab of this browser. When set,
   * a write in one tab is announced and the other tabs reload that service,
   * so a stale tab does not later overwrite it with its old copy (two
   * controller tabs would otherwise silently drop each other's items).
   */
  channelName?: string;
}

export interface NewServiceInput {
  name?: string;
  date?: string;
  doc?: ProseMirrorJSON;
  module?: string;
}

const LAST_OPEN = 'lastOpenId';

function todayISO(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function defaultId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `svc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ServiceStore {
  private services = new Map<string, Service>();
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private backendPromise: Promise<ServiceBackend>;
  private readyPromise: Promise<void> | null = null;
  private lastOpenId: string | null = null;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly newId: () => string;
  private channel: BroadcastChannel | null = null;
  private remoteListeners = new Set<(id: string) => void>();
  /** True once we had to fall back to memory: the UI may say "not saved on this device". */
  persistent = true;

  constructor(opts: ServiceStoreOptions = {}) {
    this.debounceMs = opts.debounceMs ?? 600;
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? defaultId;
    const wanted = opts.backend ?? createIndexedDbBackend();
    this.backendPromise = Promise.resolve(wanted).catch(() => {
      this.persistent = false;
      return createMemoryBackend();
    });
    if (opts.channelName && typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(opts.channelName);
        this.channel.onmessage = (e: MessageEvent) => void this.onRemoteMessage(e.data);
      } catch {
        this.channel = null;
      }
    }
  }

  /** Stop listening to other tabs (tests, teardown). */
  close(): void {
    this.channel?.close();
    this.channel = null;
  }

  /** Called with a service id after another tab changed or deleted it (the local copy is already updated). */
  onRemoteChange(fn: (id: string) => void): () => void {
    this.remoteListeners.add(fn);
    return () => this.remoteListeners.delete(fn);
  }

  private announce(kind: 'put' | 'delete', id: string): void {
    try {
      this.channel?.postMessage({ kind, id });
    } catch {
      /* a closed channel must never break saving */
    }
  }

  private async onRemoteMessage(data: unknown): Promise<void> {
    const msg = data as { kind?: string; id?: string } | null;
    if (!msg?.id || (msg.kind !== 'put' && msg.kind !== 'delete')) return;
    await this.ready();
    const id = msg.id;
    if (msg.kind === 'delete') {
      this.cancelTimer(id);
      if (!this.services.delete(id)) return;
      if (this.lastOpenId === id) this.lastOpenId = null;
    } else {
      // Our own unsaved edit in flight wins its turn; it is written on its timer.
      if (this.timers.has(id)) return;
      const backend = await this.backendPromise;
      const all = await this.safe(() => backend.getAll());
      // A local edit may have started while we waited on storage: it wins its turn.
      if (this.timers.has(id)) return;
      const fresh = all?.find((x) => x.id === id);
      const cur = this.services.get(id);
      if (!fresh || (cur && cur.updatedAt >= fresh.updatedAt)) return;
      this.services.set(id, fresh);
    }
    this.emit();
    for (const fn of [...this.remoteListeners]) fn(id);
  }

  /** Load from storage. Safe to call repeatedly. */
  ready(): Promise<void> {
    this.readyPromise ??= (async () => {
      const backend = await this.backendPromise;
      const all = (await this.safe(() => backend.getAll())) ?? [];
      for (const s of all) this.services.set(s.id, s);
      this.lastOpenId = (await this.safe(() => backend.getMeta(LAST_OPEN))) ?? null;
      this.emit();
    })();
    return this.readyPromise;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Most recently changed first. */
  list(): Service[] {
    return [...this.services.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Service | undefined {
    return this.services.get(id);
  }

  getLastOpenId(): string | null {
    return this.lastOpenId && this.services.has(this.lastOpenId) ? this.lastOpenId : null;
  }

  /** The last-open service, else the newest, else a fresh one. */
  async openLastOrCreate(): Promise<Service> {
    await this.ready();
    const id = this.getLastOpenId() ?? this.list()[0]?.id;
    if (id) return this.open(id)!;
    return this.create();
  }

  open(id: string): Service | undefined {
    const service = this.services.get(id);
    if (!service) return undefined;
    this.lastOpenId = id;
    void this.persistMeta(LAST_OPEN, id);
    this.emit();
    return service;
  }

  async create(input: NewServiceInput = {}): Promise<Service> {
    const now = this.now();
    const service: Service = {
      id: this.newId(),
      name: input.name?.trim() || todayISO(now),
      date: input.date ?? todayISO(now),
      doc: input.doc ?? emptyDocJSON(),
      module: input.module ?? '',
      updatedAt: now,
    };
    this.services.set(service.id, service);
    this.lastOpenId = service.id;
    await this.persist(service);
    void this.persistMeta(LAST_OPEN, service.id);
    this.emit();
    return service;
  }

  async duplicate(id: string, name?: string): Promise<Service | undefined> {
    const src = this.services.get(id);
    if (!src) return undefined;
    await this.flush();
    return this.create({
      name: name ?? `${src.name} (copy)`,
      date: src.date,
      doc: structuredCloneSafe(this.services.get(id)!.doc),
      module: src.module,
    });
  }

  async rename(id: string, name: string): Promise<void> {
    const s = this.services.get(id);
    const trimmed = name.trim();
    if (!s || !trimmed) return;
    s.name = trimmed;
    s.updatedAt = this.now();
    await this.persist(s);
    this.emit();
  }

  async setDate(id: string, date: string): Promise<void> {
    const s = this.services.get(id);
    if (!s) return;
    s.date = date;
    s.updatedAt = this.now();
    await this.persist(s);
    this.emit();
  }

  async remove(id: string): Promise<void> {
    this.cancelTimer(id);
    if (!this.services.delete(id)) return;
    const backend = await this.backendPromise;
    await this.safe(() => backend.delete(id));
    this.announce('delete', id);
    if (this.lastOpenId === id) {
      this.lastOpenId = null;
      void this.persistMeta(LAST_OPEN, null);
    }
    this.emit();
  }

  /** Autosave: cached now, written to storage after a quiet period. */
  save(id: string, doc: ProseMirrorJSON): void {
    const s = this.services.get(id);
    if (!s) return;
    s.doc = doc;
    s.updatedAt = this.now();
    this.cancelTimer(id);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.persist(s).then(() => this.emit());
      }, this.debounceMs),
    );
  }

  /** Write any pending autosaves now (call on pagehide / before switching service). */
  async flush(): Promise<void> {
    const pending = [...this.timers.keys()];
    for (const id of pending) this.cancelTimer(id);
    await Promise.all(pending.map((id) => this.services.get(id)).filter((s): s is Service => !!s).map((s) => this.persist(s)));
    if (pending.length) this.emit();
  }

  private cancelTimer(id: string): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  private async persist(service: Service): Promise<void> {
    const backend = await this.backendPromise;
    await this.safe(() => backend.put(structuredCloneSafe(service)));
    this.announce('put', service.id);
  }

  private async persistMeta(key: string, value: string | null): Promise<void> {
    const backend = await this.backendPromise;
    await this.safe(() => backend.setMeta(key, value));
  }

  /** A failing write must never break typing; note it and carry on. */
  private async safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch {
      this.persistent = false;
      return undefined;
    }
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}

let shared: ServiceStore | null = null;

/** The app-wide store. Flushes pending autosaves when the page is hidden. */
export function getServiceStore(): ServiceStore {
  if (!shared) {
    shared = new ServiceStore({ channelName: 'bible-present-services' });
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void shared?.flush());
    }
  }
  return shared;
}
