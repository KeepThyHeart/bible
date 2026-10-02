/**
 * Test doubles for the asset store (task 0090). Dependency-light (vitest + core only) so the web
 * and desktop store tests can import `describeAssetStoreContract` from here.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { AssetManager } from '../../assets/AssetManager';
import { MemoryAssetRegistryStore, MemoryAssetStore } from '../../assets/memory';
import type { MemoryAssetStoreOptions } from '../../assets/memory';
import { sha256Hex } from '../../assets/sha256';
import { AssetError } from '../../assets/types';
import type {
  AssetFileRef,
  AssetManagerDeps,
  AssetManifest,
  IAssetStore,
  IAssetTransport,
  TransportRequest,
  TransportResponse,
} from '../../assets/types';

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

/** Deterministic pseudo-random bytes. */
export function makeBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

export async function collect(source: AsyncIterable<Uint8Array> | null): Promise<Uint8Array> {
  if (!source) throw new Error('collect(null)');
  const chunks: Uint8Array[] = [];
  let n = 0;
  for await (const c of source) {
    chunks.push(c);
    n += c.length;
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function ref(url: string, size = 0, over: Partial<AssetFileRef> = {}): AssetFileRef {
  return { assetId: 'a', kind: 'data', version: '1', path: 'f.bin', url, size, ...over };
}

// ---------------------------------------------------------------------------
// FakeTransport
// ---------------------------------------------------------------------------

export interface FakeResource {
  body: Uint8Array;
  /** Default a strong ETag derived from the digest; `null` = no ETag header. */
  etag?: string | null;
  lastModified?: string;
  contentType?: string;
}

/** One scripted answer for the next request to a url (default: honour Range, serve normally). */
export interface FakeStep {
  /** honour Range (default) | ignore Range (always 200 full) | wrong Content-Range start on a 206. */
  mode?: 'honour' | 'ignore-range' | 'wrong-range';
  wrongStart?: number;
  /** Answer with this status and an empty body (404, 416, 503...). */
  status?: number;
  headers?: Partial<TransportResponse['headers']>;
  /** Serve these bytes instead of the resource (corruption, overrun, short body). */
  body?: Uint8Array;
  /** Body throws `error` (default retryable `network`) after this many bytes of THIS response. */
  failAfter?: number;
  error?: AssetError;
  /** Body yields this many bytes, then hangs until the request signal aborts (then throws `aborted`). */
  stallAfter?: number;
  /** `get()` itself rejects (offline...). */
  throwOnGet?: AssetError;
}

function strip(url: string): string {
  return url.replace(/([?&])download=1(&|$)/, (_m, a: string, b: string) => (b ? a : '')).replace(/[?&]$/, '');
}

export class FakeTransport implements IAssetTransport {
  /** Every `get`, in order (url as requested, i.e. with `download=1`). */
  requests: Array<{ url: string; rangeStart?: number; ifRange?: string }> = [];
  textRequests: string[] = [];
  bytesServed = 0;
  /** `get` calls currently in flight (from call until the body ends/aborts). */
  active = 0;
  maxActive = 0;
  chunkSize = 64;

  private resources = new Map<string, FakeResource>();
  private texts = new Map<string, string | null>();
  private scripts = new Map<string, FakeStep[]>();
  private gates = new Map<string, { promise: Promise<void>; release: () => void }>();

  /** Register a resource; with `sidecar` also `<url>.sha256` in sha256sum format. */
  add(url: string, body: Uint8Array, opts: { sidecar?: boolean; etag?: string | null; lastModified?: string } = {}): FakeResource {
    const res: FakeResource = { body, etag: opts.etag, lastModified: opts.lastModified };
    this.resources.set(url, res);
    if (opts.sidecar) this.texts.set(`${url}.sha256`, `${sha256Hex(body)}  ${url.split('/').pop()}\n`);
    return res;
  }

  /** Text (sidecar) answer; `null` = 404. */
  setText(url: string, text: string | null): void {
    this.texts.set(url, text);
  }

  /** Queue scripted steps for the next requests to `url` (consumed in order, then default). */
  script(url: string, ...steps: FakeStep[]): void {
    this.scripts.set(url, [...(this.scripts.get(url) ?? []), ...steps]);
  }

  /** Requests to `url` wait until the returned function is called. */
  gate(url: string): () => void {
    let release!: () => void;
    const promise = new Promise<void>((r) => {
      release = r;
    });
    this.gates.set(url, { promise, release });
    return release;
  }

  requestsFor(url: string): Array<{ url: string; rangeStart?: number; ifRange?: string }> {
    return this.requests.filter((r) => strip(r.url) === url);
  }

  async get(req: TransportRequest): Promise<TransportResponse> {
    this.requests.push({ url: req.url, rangeStart: req.rangeStart, ifRange: req.ifRange });
    const key = strip(req.url);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    let counted = true;
    const done = (): void => {
      if (counted) {
        counted = false;
        this.active--;
      }
    };
    req.signal.addEventListener('abort', done, { once: true });
    try {
      const gate = this.gates.get(key);
      if (gate) await this.waitOrAbort(gate.promise, req.signal);
      if (req.signal.aborted) throw new AssetError('aborted', 'aborted');
      const step = this.scripts.get(key)?.shift() ?? {};
      if (step.throwOnGet) throw step.throwOnGet;
      const res = this.resources.get(key);
      if (!res) {
        done();
        return { status: 404, headers: {}, body: this.body(new Uint8Array(0), {}, req, done) };
      }
      const full = step.body ?? res.body;
      const etag = res.etag === undefined ? `"e-${sha256Hex(res.body).slice(0, 8)}"` : res.etag ?? undefined;
      const base: TransportResponse['headers'] = { etag, lastModified: res.lastModified, contentType: res.contentType, ...step.headers };
      if (step.status !== undefined) {
        done();
        return { status: step.status, headers: base, body: this.body(new Uint8Array(0), {}, req, done) };
      }
      const start = req.rangeStart;
      const mode = step.mode ?? 'honour';
      let status = 200;
      let payload = full;
      let headers = { ...base, contentLength: full.length };
      if (start !== undefined && start > 0 && mode !== 'ignore-range') {
        if (mode === 'wrong-range') {
          const s = step.wrongStart ?? start + 1;
          status = 206;
          payload = full.subarray(start);
          headers = { ...base, contentLength: payload.length, contentRange: `bytes ${s}-${full.length - 1}/${full.length}` };
        } else if (start >= full.length) {
          done();
          return { status: 416, headers: { ...base, contentRange: `bytes */${full.length}` }, body: this.body(new Uint8Array(0), {}, req, done) };
        } else {
          const current = etag ?? res.lastModified;
          if (req.ifRange && req.ifRange !== current) {
            status = 200;
          } else {
            status = 206;
            payload = full.subarray(start);
            headers = { ...base, contentLength: payload.length, contentRange: `bytes ${start}-${full.length - 1}/${full.length}` };
          }
        }
      }
      return { status, headers, body: this.body(payload, step, req, done) };
    } catch (e) {
      done();
      throw e;
    }
  }

  async getText(url: string, signal: AbortSignal): Promise<string | null> {
    this.textRequests.push(url);
    if (signal.aborted) throw new AssetError('aborted', 'aborted');
    return this.texts.get(url) ?? null;
  }

  private waitOrAbort(p: Promise<void>, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new AssetError('aborted', 'aborted'));
      signal.addEventListener('abort', () => reject(new AssetError('aborted', 'aborted')), { once: true });
      void p.then(resolve);
    });
  }

  private body(payload: Uint8Array, step: FakeStep, req: TransportRequest, done: () => void): AsyncIterable<Uint8Array> {
    const self = this;
    return (async function* () {
      try {
        let sent = 0;
        while (sent < payload.length) {
          if (req.signal.aborted) throw new AssetError('aborted', 'aborted');
          if (step.stallAfter !== undefined && sent >= step.stallAfter) {
            await new Promise<void>((resolve) => {
              if (req.signal.aborted) return resolve();
              req.signal.addEventListener('abort', () => resolve(), { once: true });
            });
            throw new AssetError('aborted', 'aborted');
          }
          if (step.failAfter !== undefined && sent >= step.failAfter) {
            throw step.error ?? new AssetError('network', 'connection reset', true);
          }
          let end = Math.min(payload.length, sent + self.chunkSize);
          if (step.stallAfter !== undefined && sent < step.stallAfter) end = Math.min(end, step.stallAfter);
          if (step.failAfter !== undefined && sent < step.failAfter) end = Math.min(end, step.failAfter);
          const chunk = payload.slice(sent, end);
          sent = end;
          self.bytesServed += chunk.length;
          yield chunk;
        }
      } finally {
        done();
      }
    })();
  }
}

// ---------------------------------------------------------------------------
// Manifest + harness helpers
// ---------------------------------------------------------------------------

export interface MakeAssetOptions {
  id?: string;
  kind?: string;
  version?: string;
  /** path -> bytes, or a byte count (deterministic bytes). Default one 300-byte file. */
  files?: Record<string, Uint8Array | number>;
  /** Put `sha256` in the manifest (default true). When false, see `sidecar`. */
  sha?: boolean;
  /** Serve `<url>.sha256` (default: true when `sha` is false). */
  sidecar?: boolean;
  allowUnverified?: boolean;
  seed?: number;
  baseUrl?: string;
  title?: string;
}

export interface MadeAsset {
  manifest: AssetManifest;
  bodies: Record<string, Uint8Array>;
  urls: Record<string, string>;
}

let seedCounter = 100;

/** Build a manifest and register its bytes (and sidecars) on the transport. */
export function makeAsset(transport: FakeTransport, opts: MakeAssetOptions = {}): MadeAsset {
  const id = opts.id ?? 'asset-a';
  const kind = opts.kind ?? 'data';
  const version = opts.version ?? '1';
  const base = opts.baseUrl ?? 'https://assets.test';
  const spec = opts.files ?? { 'a.bin': 300 };
  const withSha = opts.sha !== false;
  const sidecar = opts.sidecar ?? !withSha;
  const bodies: Record<string, Uint8Array> = {};
  const urls: Record<string, string> = {};
  const files: AssetManifest['files'] = [];
  let total = 0;
  for (const [path, v] of Object.entries(spec)) {
    const body = typeof v === 'number' ? makeBytes(v, (opts.seed ?? seedCounter++) + files.length) : v;
    const url = `${base}/${kind}/${id}/${version}/${path}`;
    transport.add(url, body, { sidecar });
    bodies[path] = body;
    urls[path] = url;
    files.push({ path, url, size: body.length, ...(withSha ? { sha256: sha256Hex(body) } : {}) });
    total += body.length;
  }
  const manifest: AssetManifest = { id, kind, version, title: opts.title ?? id, license: 'MIT', size: total, files };
  if (opts.allowUnverified) manifest.allowUnverified = true;
  return { manifest, bodies, urls };
}

export interface Harness {
  transport: FakeTransport;
  store: MemoryAssetStore;
  registry: MemoryAssetRegistryStore;
  manager: AssetManager;
  clock: { t: number; now(): number; advance(ms: number): void };
  sleeps: number[];
  logs: string[];
  /** A fresh manager over the same store/registry/transport (simulates an app restart). */
  restart(over?: Partial<AssetManagerDeps>): AssetManager;
}

export interface HarnessOptions extends Partial<Omit<AssetManagerDeps, 'store' | 'registry' | 'transport'>> {
  storeOptions?: MemoryAssetStoreOptions;
  transport?: FakeTransport;
  store?: MemoryAssetStore;
  registry?: MemoryAssetRegistryStore;
}

export function createHarness(opts: HarnessOptions = {}): Harness {
  const clock = {
    t: 1_000_000,
    now() {
      return this.t;
    },
    advance(ms: number) {
      this.t += ms;
    },
  };
  const transport = opts.transport ?? new FakeTransport();
  const store = opts.store ?? new MemoryAssetStore({ now: () => clock.t, ...opts.storeOptions });
  const registry = opts.registry ?? new MemoryAssetRegistryStore();
  const sleeps: number[] = [];
  const logs: string[] = [];
  const { storeOptions: _s, transport: _t, store: _st, registry: _r, ...rest } = opts;
  void [_s, _t, _st, _r];
  const build = (over: Partial<AssetManagerDeps> = {}): AssetManager =>
    new AssetManager({
      transport,
      store,
      registry,
      now: () => clock.t,
      sleep: async (ms, signal) => {
        sleeps.push(ms);
        if (signal.aborted) throw new AssetError('aborted', 'aborted');
      },
      log: (m) => {
        logs.push(m);
      },
      stallTimeoutMs: 0,
      ...rest,
      ...over,
    });
  return { transport, store, registry, manager: build(), clock, sleeps, logs, restart: build };
}

/** Wait until `cond()` is true (macrotask turns). */
export async function until(cond: () => boolean, what = 'condition', turns = 500): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (cond()) return;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ---------------------------------------------------------------------------
// IAssetStore contract suite (shared by core memory, web Cache and desktop fs stores)
// ---------------------------------------------------------------------------

export type StoreFactory = () =>
  | IAssetStore
  | Promise<IAssetStore>
  | { store: IAssetStore; cleanup?: () => void | Promise<void> }
  | Promise<{ store: IAssetStore; cleanup?: () => void | Promise<void> }>;

/**
 * The behaviour every IAssetStore must have. `makeStore` must return a fresh, empty store each call
 * (or `{ store, cleanup }`). Two calls in one test are NOT expected to share state; reopening within
 * a test uses the same store instance (`openPartial` again after `close`).
 */
export function describeAssetStoreContract(makeStore: StoreFactory, label = 'IAssetStore contract'): void {
  describe(label, () => {
    const cleanups: Array<() => void | Promise<void>> = [];
    async function fresh(): Promise<IAssetStore> {
      const made = await makeStore();
      if ('store' in made) {
        if (made.cleanup) cleanups.push(made.cleanup);
        return made.store;
      }
      return made;
    }
    const f1 = ref('https://store.test/assets/v1/data/a/1/one.bin', 0, { path: 'one.bin' });
    const f2 = ref('https://store.test/assets/v1/data/a/1/two.bin', 0, { path: 'two.bin' });
    const bytes = (n: number, seed = 1): Uint8Array => makeBytes(n, seed);

    afterAll(async () => {
      for (const c of cleanups.splice(0)) await c();
    });

    it('starts empty', async () => {
      const s = await fresh();
      expect(await s.exists(f1)).toBe(false);
      expect(await s.read(f1)).toBeNull();
      const p = await s.openPartial(f1);
      expect(p.size).toBe(0);
      expect(p.validator).toBeNull();
      await p.discard();
    });

    it('append accumulates; read yields the bytes in order; size tracks appends', async () => {
      const s = await fresh();
      const p = await s.openPartial(f1);
      const a = bytes(1000, 1);
      const b = bytes(500, 2);
      await p.append(a);
      expect(p.size).toBe(1000);
      await p.append(b);
      expect(p.size).toBe(1500);
      expect(await collect(p.read())).toEqual(concatBytes(a, b));
      await p.discard();
    });

    it('reset drops the bytes and stores the new validator', async () => {
      const s = await fresh();
      const p = await s.openPartial(f1);
      await p.append(bytes(100));
      await p.reset('"v2"');
      expect(p.size).toBe(0);
      expect(p.validator).toBe('"v2"');
      expect((await collect(p.read())).length).toBe(0);
      await p.append(bytes(10, 9));
      expect(p.size).toBe(10);
      await p.reset(null);
      expect(p.validator).toBeNull();
      await p.discard();
    });

    it('close keeps the bytes and validator for a later openPartial', async () => {
      const s = await fresh();
      const p = await s.openPartial(f1);
      await p.reset('"etag-1"');
      const a = bytes(700, 3);
      await p.append(a);
      await p.close();
      await p.close(); // idempotent
      const again = await s.openPartial(f1);
      expect(again.size).toBe(700);
      expect(again.validator).toBe('"etag-1"');
      expect(await collect(again.read())).toEqual(a);
      const b = bytes(50, 4);
      await again.append(b);
      expect(again.size).toBe(750);
      expect(await collect(again.read())).toEqual(concatBytes(a, b));
      await again.discard();
    });

    it('a partial is not a committed file', async () => {
      const s = await fresh();
      const p = await s.openPartial(f1);
      await p.append(bytes(10));
      await p.close();
      expect(await s.exists(f1)).toBe(false);
      expect(await s.read(f1)).toBeNull();
      await (await s.openPartial(f1)).discard();
    });

    it('commit makes the bytes the committed file and ends the partial', async () => {
      const s = await fresh();
      const p = await s.openPartial(f1);
      const a = bytes(2000, 5);
      await p.append(a.subarray(0, 1200));
      await p.append(a.subarray(1200));
      await p.commit();
      expect(await s.exists(f1)).toBe(true);
      expect(await collect(await s.read(f1))).toEqual(a);
      const after = await s.openPartial(f1);
      expect(after.size).toBe(0);
      await after.discard();
    });

    it('commit replaces an existing committed file; the old bytes stay readable until then', async () => {
      const s = await fresh();
      const oldBytes = bytes(300, 6);
      const p1 = await s.openPartial(f1);
      await p1.append(oldBytes);
      await p1.commit();
      const newBytes = bytes(400, 7);
      const p2 = await s.openPartial(f1);
      await p2.append(newBytes);
      expect(await collect(await s.read(f1))).toEqual(oldBytes);
      await p2.commit();
      expect(await collect(await s.read(f1))).toEqual(newBytes);
    });

    it('discard deletes the partial and is idempotent; the committed file is untouched', async () => {
      const s = await fresh();
      const keep = bytes(64, 8);
      const c = await s.openPartial(f1);
      await c.append(keep);
      await c.commit();
      const p = await s.openPartial(f1);
      await p.append(bytes(10, 9));
      await p.discard();
      await p.discard();
      expect((await s.openPartial(f1)).size).toBe(0);
      expect(await collect(await s.read(f1))).toEqual(keep);
    });

    it('refs are independent; delete removes committed file and partial, ignores missing refs', async () => {
      const s = await fresh();
      const a = bytes(32, 10);
      const pa = await s.openPartial(f1);
      await pa.append(a);
      await pa.commit();
      const pb = await s.openPartial(f2);
      await pb.append(bytes(16, 11));
      await pb.close();
      const missing = ref('https://store.test/assets/v1/data/a/1/none.bin', 0, { path: 'none.bin' });
      await s.delete([f2, missing]);
      expect(await collect(await s.read(f1))).toEqual(a);
      expect((await s.openPartial(f2)).size).toBe(0);
      await s.delete([f1]);
      expect(await s.exists(f1)).toBe(false);
      expect(await s.read(f1)).toBeNull();
    });

    it('sweepPartials removes old partials only', async () => {
      const s = await fresh();
      const p = await s.openPartial(f1);
      await p.append(bytes(10));
      await p.close();
      await s.sweepPartials(60 * 60 * 1000);
      expect((await s.openPartial(f1)).size).toBe(10);
      await new Promise<void>((r) => setTimeout(r, 25));
      await s.sweepPartials(5);
      expect((await s.openPartial(f1)).size).toBe(0);
    });

    it('sweepPartials does not touch committed files', async () => {
      const s = await fresh();
      const p = await s.openPartial(f1);
      await p.append(bytes(10));
      await p.commit();
      await new Promise<void>((r) => setTimeout(r, 15));
      await s.sweepPartials(1);
      expect(await s.exists(f1)).toBe(true);
    });

    it('freeBytes, when provided, is a non-negative number or null', async () => {
      const s = await fresh();
      if (!s.freeBytes) return;
      const free = await s.freeBytes();
      if (free !== null) expect(free).toBeGreaterThanOrEqual(0);
    });
  });
}
