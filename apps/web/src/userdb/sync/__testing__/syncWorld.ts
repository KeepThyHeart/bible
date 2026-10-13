/**
 * Integration world for the web sync host (tests only). The REAL sync server (`@bible/sync-server`, over an in-memory
 * sqlite-wasm database) listens on 127.0.0.1:0; each "browser" has its own cookie jar, its own fake IndexedDB and an
 * `Origin` header equal to the server's origin (cookie auth + the server's CSRF Origin check, `cookieSecure: false`
 * for plain http). Each "worker" is the real `createUserDbHandler` with the real `createSyncHost` as its `sync`
 * extension, over an in-memory sqlite-wasm user DB, with manual timers. Everything the worker answers or emits goes
 * through `structuredClone` (as `postMessage` would) and is recorded in `browser.seen` for key-material scans.
 *
 * The test file must `vi.mock('@bible/sync-server', ...)` to the package source (its dist may be stale) and
 * `vi.mock('@bible/core', ...)` to the browser barrel's `Crypto`/`Sync` (the server's only runtime core imports).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { IDBFactory } from 'fake-indexeddb';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createSyncServer, type SyncServer } from '@bible/sync-server';
import { Sync } from '@bible/core/browser';
import { createWasmSql } from '../../createWasmSql';
import { toWireError, type WireError } from '../../errors';
import { createUserDbHandler } from '../../handler';
import { finishOpen } from '../../openUserDb';
import type { ModuleRef, UserDbEvent, UserDbRequest } from '../../protocol';
import { wipeBrowserStores } from '../../wipeStores';
import { createSyncHost, type SyncHost } from '../syncHost';

export type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
export const loadSqlite = (): Promise<Sqlite3> => sqlite3InitModule();

export const PASSWORD = 'violet-Lantern-quietly-7291';
export const WRONG_PASSWORD = 'granite-Harbor-sparrow-5038';
/** The Argon2id floor (fast enough for tests, still accepted by `validateKdfParams`). */
export const FLOOR_KDF = { m: 19456, t: 2, p: 1 };
export const CONSENT = { terms: true, ageConfirmed: true } as const;
export const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

// --- manual timers --------------------------------------------------------------------------------------------

export interface ManualTimers extends Sync.SyncTimers {
  /** Moves the clock and runs every timer due by then, in order (timers armed while running fire too if due). */
  advance(ms: number): void;
  pending(): number;
}

export function manualTimers(): ManualTimers {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(h) { timers.delete(h as number); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | undefined;
        for (const e of timers) if (e[1].at <= until && (!next || e[1].at < next[1].at)) next = e;
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

// --- server ---------------------------------------------------------------------------------------------------

export interface Mail { to: string; subject: string; text: string }

export interface World {
  origin: string;
  server: SyncServer;
  /** The server's database, for record counts. */
  serverSql: Sync.ISql;
  mail: Mail[];
  close(): Promise<void>;
}

export async function startWorld(sqlite3: Sqlite3): Promise<World> {
  const app = express();
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const serverSql = createWasmSql(new sqlite3.oo1.DB(':memory:'), ':memory:');
  const mail: Mail[] = [];
  const server = createSyncServer({
    sql: serverSql as never, serverSecret: new Uint8Array(32).fill(7), publicUrl: origin,
    email: { send: async (m) => { mail.push(m); } }, allowedOrigins: [origin], cookieSecure: false,
  });
  app.use(Sync.SYNC_API_PREFIX, server.router);
  return {
    origin, server, serverSql, mail,
    close: () => new Promise<void>((r) => {
      srv.closeAllConnections?.();
      srv.close(() => { server.close(); r(); });
    }),
  };
}

/** The one-time token in the last mail to `to` matching `subject` (mail is sent after the route answers). */
export async function mailToken(w: World, to: string, subject: RegExp): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const hit = [...w.mail].reverse().find((m) => m.to === to && subject.test(m.subject));
    const tok = hit && /#token=([A-Za-z0-9_-]{43})/.exec(hit.text);
    if (tok) return tok[1];
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no mail to ${to} matching ${subject}`);
}

export function serverRecordCount(w: World): number {
  return w.serverSql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM record')!.n;
}

// --- browsers and workers -------------------------------------------------------------------------------------

export interface Browser {
  name: string;
  origin: string;
  indexedDB: IDBFactory;
  cookies: Map<string, string>;
  fetch: typeof fetch;
  /** The user DB (OPFS stand-in): survives a "leader change" (a new worker), not a wipe. */
  db: { handle: unknown | null };
  /** Every value a worker of this browser answered, every event and every wire error (structured-cloned). */
  seen: unknown[];
  /** Route suffixes (e.g. `/logout`) whose requests fail like a dropped connection. */
  blocked: Set<string>;
}

export function createBrowser(w: World, name: string): Browser {
  const cookies = new Map<string, string>();
  const blocked = new Set<string>();
  const doFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const path = new URL(String(input)).pathname;
    if ([...blocked].some((b) => path.endsWith(b))) throw new TypeError('fetch failed');
    const headers = new Headers(init?.headers);
    headers.set('Origin', w.origin);
    if (cookies.size > 0) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await globalThis.fetch(input, { ...init, headers });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const eq = pair.indexOf('=');
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a));
      if (expired || value === '') cookies.delete(key);
      else cookies.set(key, value);
    }
    return res;
  }) as typeof fetch;
  return { name, origin: w.origin, indexedDB: new IDBFactory(), cookies, fetch: doFetch, db: { handle: null }, seen: [], blocked };
}

export interface Worker {
  host: SyncHost;
  timers: ManualTimers;
  online: EventTarget;
  events: UserDbEvent[];
  /** `ctx.wipe()` reached the database files (count). */
  wipes: number;
  /** IndexedDB stores deleted by the handler's `onWipe` (count of `wipeBrowserStores` runs). */
  storeWipes: number;
  request(req: UserDbRequest): Promise<unknown>;
  sync(action: 'status' | 'syncNow'): Promise<unknown>;
  configure(o?: { remember?: boolean; modules?: ModuleRef[]; baseUrl?: string }): Promise<Sync.SyncStatus>;
  account<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  api<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  /** The worker's current ISql (opens the database if needed). */
  sql(): Promise<Sync.ISql>;
  statusEvents(): Sync.SyncStatus[];
}

export class WireFailure extends Error {
  constructor(readonly wire: WireError) {
    super(wire.message);
    this.name = wire.name;
  }
  get code(): string | undefined { return this.wire.code; }
}

/** A user-DB worker (as a new leader would start one) for `b`: a fresh handler + sync host over `b.db`. */
export function startWorker(sqlite3: Sqlite3, b: Browser, o: { engineDebounceMs?: number } = {}): Worker {
  const timers = manualTimers();
  const online = new EventTarget();
  const events: UserDbEvent[] = [];
  let current: Sync.ISql | null = null;
  const host = createSyncHost({
    fetch: b.fetch, indexedDB: b.indexedDB, origin: b.origin, timers, online, userAgent: FIREFOX_UA,
    account: { kdfCost: FLOOR_KDF }, engine: { debounceMs: o.engineDebounceMs ?? 1000 },
  });
  const worker: Worker = {
    host, timers, online, events, wipes: 0, storeWipes: 0,
    request: async () => null, sync: async () => null, configure: async () => ({}) as never,
    account: async () => null as never, api: async () => null as never, sql: async () => current!,
    statusEvents: () => events.flatMap((e) => (e.event === 'syncStatus' ? [e.status] : [])),
  };
  const handler = createUserDbHandler({
    open: async () => {
      const h = b.db.handle as { isOpen(): boolean } | null;
      if (!h || !h.isOpen()) b.db.handle = new sqlite3.oo1.DB(':memory:');
      const opened = finishOpen(b.db.handle, ':memory:', async () => { worker.wipes++; });
      current = opened.sql;
      return opened;
    },
    emit: (e) => {
      const c = structuredClone(e);
      events.push(c);
      b.seen.push(c);
    },
    extensions: { sync: (req, ctx) => host.handle(req, ctx) },
    onLocalWrite: (tables) => host.notifyLocalChange(tables),
    onWipe: async () => {
      worker.storeWipes++;
      await wipeBrowserStores(b.indexedDB);
    },
  });
  worker.request = async (req) => {
    try {
      const v = structuredClone(await handler.handle(structuredClone(req)));
      b.seen.push(v);
      return v;
    } catch (e) {
      const wire = structuredClone(toWireError(e));
      b.seen.push(wire);
      throw new WireFailure(wire);
    }
  };
  worker.sync = (action) => worker.request({ op: 'sync', action });
  worker.configure = (c = {}) => worker.request({
    op: 'sync', action: 'configure', baseUrl: c.baseUrl ?? b.origin, remember: c.remember ?? true,
    modules: c.modules ?? [{ id: 1, abbr: 'KJV' }, { id: 2, abbr: 'ESV' }],
  }) as Promise<Sync.SyncStatus>;
  worker.account = (method, ...args) =>
    worker.request({ op: 'sync', action: 'account', method: method as never, args }) as Promise<never>;
  worker.api = (method, ...args) =>
    worker.request({ op: 'sync', action: 'api', method: method as never, args }) as Promise<never>;
  worker.sql = async () => {
    await worker.request({ op: 'open' });
    return current!;
  };
  return worker;
}

/** Waits (real time) until `check` passes; for engine work started by a timer callback. */
export async function until(check: () => boolean | Promise<boolean>, what = 'condition', ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

let counter = 0;
export function freshEmail(): string { return `web${++counter}-${Date.now().toString(36)}@example.com`; }

/** Configure + sign up + verify the address (pushing needs a verified account). Returns the recovery-code result. */
export async function signUpVerified(w: World, worker: Worker, email: string, remember = true): Promise<unknown> {
  await worker.configure({ remember });
  const res = await worker.account('signUp', email, PASSWORD, CONSENT);
  await worker.api('verifyEmail', await mailToken(w, email, /Confirm/i));
  return res;
}

// --- secret scans ---------------------------------------------------------------------------------------------

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');
const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');

function containsBytes(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Every place in `values` (deep: objects, arrays, Maps, Sets, typed arrays, ArrayBuffers, Error fields) where one of
 * the `secrets` shows up: raw bytes (any 16-byte window of a byte secret), its hex / base64 / base64url text, or a
 * string secret as a substring. Returns readable paths of the hits (never the secret).
 */
export function findSecrets(values: unknown[], secrets: Record<string, Uint8Array | string>): string[] {
  const hits: string[] = [];
  const textNeedles: Array<[string, string]> = [];
  const byteNeedles: Array<[string, Uint8Array]> = [];
  for (const [name, s] of Object.entries(secrets)) {
    if (typeof s === 'string') { textNeedles.push([name, s]); continue; }
    for (let i = 0; i + 16 <= s.length; i += 8) byteNeedles.push([name, s.subarray(i, i + 16)]);
    if (s.length < 16) byteNeedles.push([name, s]);
    for (const enc of [hex(s), b64(s).replace(/=+$/, ''), b64url(s)]) textNeedles.push([name, enc.slice(0, 20)]);
  }
  const seen = new Set<unknown>();
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      for (const [name, n] of textNeedles) if (v.includes(n)) hits.push(`${path}: ${name}`);
      return;
    }
    if (typeof v !== 'object' || v === null || seen.has(v)) return;
    seen.add(v);
    let bytes: Uint8Array | null = null;
    if (v instanceof ArrayBuffer) bytes = new Uint8Array(v);
    else if (ArrayBuffer.isView(v)) bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (bytes) {
      for (const [name, n] of byteNeedles) if (containsBytes(bytes, n)) hits.push(`${path}: ${name} (bytes)`);
      return;
    }
    if (v instanceof Map) { for (const [k, x] of v) { walk(k, `${path}.<key>`); walk(x, `${path}.get(${String(k)})`); } return; }
    if (v instanceof Set) { let i = 0; for (const x of v) walk(x, `${path}.<${i++}>`); return; }
    if (v instanceof Error) { walk(v.message, `${path}.message`); walk(v.name, `${path}.name`); }
    for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}.${k}`);
  };
  values.forEach((v, i) => walk(v, `#${i}`));
  return hits;
}

/** Names of the IndexedDB databases that exist in `idb`. */
export async function idbNames(idb: IDBFactory): Promise<string[]> {
  return (await idb.databases()).map((d) => d.name ?? '');
}

/** Raw records of `kth-secrets`' object store (empty when the database or the store does not exist). */
export async function rawSecretRecords(idb: IDBFactory): Promise<IDBValidKey[]> {
  if (!(await idbNames(idb)).includes('kth-secrets')) return [];
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = idb.open('kth-secrets');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  try {
    if (!db.objectStoreNames.contains('keys')) return [];
    return await new Promise<IDBValidKey[]>((res, rej) => {
      const r = db.transaction('keys', 'readonly').objectStore('keys').getAllKeys();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } finally {
    db.close();
  }
}

/** Creates the legacy `kth-user-data` IndexedDB store with one record (what the pre-OPFS web app kept). */
export async function seedLegacyUserData(idb: IDBFactory): Promise<void> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = idb.open('kth-user-data', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('items'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('items', 'readwrite');
    tx.objectStore('items').put('x', 'k');
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}
