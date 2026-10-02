/**
 * Web `IAssetStore` and `IAssetRegistryStore` over the Cache API.
 *
 * A committed file is one entry keyed by its absolute URL, so a service worker
 * route (and the Piper worker, for `tts-models-v1`) finds it. A partial download
 * is a run of 4 MiB segment entries plus one `meta` entry under a reserved
 * origin, so a reload resumes where the last flush stopped.
 */

import { ASSET_REGISTRY_SCHEMA, AssetError, isAssetError } from '@bible/core/browser';
import type {
  AssetFileRef,
  AssetKind,
  AssetRegistrySnapshot,
  IAssetRegistryStore,
  IAssetStore,
  IPartialFile,
} from '@bible/core/browser';
import { ASSET_CACHE_NAMES, cacheNameForKind } from './assetCacheNames';

export const SEGMENT_BYTES = 4 * 1024 * 1024;
const PARTIAL_ORIGIN = 'https://kth-assets.invalid/partial/';
const REGISTRY_KEY = 'https://kth-assets.invalid/registry.json';

function absolute(key: string): string {
  try {
    return new URL(key, typeof location !== 'undefined' ? location.href : undefined).href;
  } catch {
    return key;
  }
}

function toAssetError(e: unknown, what: string): AssetError {
  if (isAssetError(e)) return e as AssetError;
  const name = e && typeof e === 'object' ? (e as { name?: unknown }).name : undefined;
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  if (name === 'QuotaExceededError' || code === 22) return new AssetError('quota', `Storage is full (${what})`);
  return new AssetError('storage', `${what}: ${e instanceof Error ? e.message : String(e)}`);
}

async function guard<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toAssetError(e, what);
  }
}

function concat(parts: Uint8Array[]): BlobPart[] {
  return parts as unknown as BlobPart[];
}

interface PartialMeta {
  validator: string | null;
  segments: number;
  size: number;
  touchedAt: number;
}

async function* streamResponse(res: Response): AsyncGenerator<Uint8Array> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length) yield buf;
    return;
  }
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value && value.length) yield value;
    }
  } finally {
    try { await reader.cancel(); } catch { /* closed */ }
  }
}

export class CacheAssetStore implements IAssetStore {
  constructor(
    private readonly storage: CacheStorage,
    private readonly cacheNameFor: (kind: AssetKind) => string = cacheNameForKind,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private open(kind: AssetKind): Promise<Cache> {
    return this.storage.open(this.cacheNameFor(kind));
  }

  async exists(ref: AssetFileRef): Promise<boolean> {
    return guard('exists', async () => (await (await this.open(ref.kind)).match(absolute(ref.url))) !== undefined);
  }

  async read(ref: AssetFileRef): Promise<AsyncIterable<Uint8Array> | null> {
    return guard('read', async () => {
      const res = await (await this.open(ref.kind)).match(absolute(ref.url));
      return res ? streamResponse(res) : null;
    });
  }

  async openPartial(ref: AssetFileRef): Promise<IPartialFile> {
    return guard('openPartial', async () => {
      const cache = await this.open(ref.kind);
      const partial = new CachePartial(cache, ref, this.now);
      await partial.load();
      return partial;
    });
  }

  async delete(refs: AssetFileRef[]): Promise<void> {
    await guard('delete', async () => {
      for (const ref of refs) {
        const cache = await this.open(ref.kind);
        await cache.delete(absolute(ref.url));
        await deletePartialEntries(cache, partialBase(ref));
      }
    });
  }

  async sweepPartials(olderThanMs: number): Promise<void> {
    await guard('sweepPartials', async () => {
      const names = new Set([this.cacheNameFor('tts-voice'), this.cacheNameFor('data')]);
      const cutoff = this.now() - olderThanMs;
      for (const name of names) {
        const cache = await this.storage.open(name);
        const urls = (await cache.keys()).map((r) => r.url).filter((u) => u.startsWith(PARTIAL_ORIGIN));
        const bases = new Set(urls.map((u) => u.slice(0, u.lastIndexOf('/'))));
        for (const base of bases) {
          const meta = await readMeta(cache, base);
          // No readable meta: a crash left orphan segments; drop them.
          if (!meta || meta.touchedAt <= cutoff) await deletePartialEntries(cache, base);
        }
      }
    });
  }

  async freeBytes(): Promise<number | null> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (!est || typeof est.quota !== 'number' || typeof est.usage !== 'number') return null;
      return Math.max(0, est.quota - est.usage);
    } catch {
      return null;
    }
  }
}

function partialBase(ref: AssetFileRef): string {
  return `${PARTIAL_ORIGIN}${encodeURIComponent(absolute(ref.url))}`;
}

async function readMeta(cache: Cache, base: string): Promise<PartialMeta | null> {
  const hit = await cache.match(`${base}/meta`);
  if (!hit) return null;
  try {
    const m = await hit.json() as PartialMeta;
    if (m && typeof m.segments === 'number' && typeof m.size === 'number' && typeof m.touchedAt === 'number') {
      return { validator: typeof m.validator === 'string' ? m.validator : null, segments: m.segments, size: m.size, touchedAt: m.touchedAt };
    }
  } catch { /* corrupt */ }
  return null;
}

async function deletePartialEntries(cache: Cache, base: string): Promise<void> {
  const prefix = `${base}/`;
  for (const req of await cache.keys()) {
    if (req.url.startsWith(prefix)) await cache.delete(req.url);
  }
}

class CachePartial implements IPartialFile {
  private segments = 0;
  private flushed = 0;
  private buffer: Uint8Array[] = [];
  private buffered = 0;
  private _validator: string | null = null;
  private readonly base: string;
  private readonly url: string;

  constructor(private readonly cache: Cache, private readonly ref: AssetFileRef, private readonly now: () => number) {
    this.url = absolute(ref.url);
    this.base = partialBase(ref);
  }

  get size(): number { return this.flushed + this.buffered; }
  get validator(): string | null { return this._validator; }

  async load(): Promise<void> {
    const meta = await readMeta(this.cache, this.base);
    if (!meta) {
      await deletePartialEntries(this.cache, this.base);
      return;
    }
    let total = 0;
    for (let i = 0; i < meta.segments; i++) {
      const seg = await this.cache.match(`${this.base}/${i}`);
      if (!seg) { total = -1; break; }
      total += (await seg.blob()).size;
    }
    if (total < 0 || total !== meta.size) {
      // A segment is missing or damaged: start again.
      await deletePartialEntries(this.cache, this.base);
      return;
    }
    this.segments = meta.segments;
    this.flushed = meta.size;
    this._validator = meta.validator;
  }

  private async writeMeta(): Promise<void> {
    const meta: PartialMeta = { validator: this._validator, segments: this.segments, size: this.flushed, touchedAt: this.now() };
    await this.cache.put(`${this.base}/meta`, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  }

  private async flush(): Promise<void> {
    if (this.buffered === 0) return;
    const blob = new Blob(concat(this.buffer));
    await this.cache.put(`${this.base}/${this.segments}`, new Response(blob, { headers: { 'Content-Type': 'application/octet-stream' } }));
    this.segments += 1;
    this.flushed += this.buffered;
    this.buffer = [];
    this.buffered = 0;
    await this.writeMeta();
  }

  async append(chunk: Uint8Array): Promise<void> {
    if (chunk.length === 0) return;
    this.buffer.push(chunk);
    this.buffered += chunk.length;
    if (this.buffered >= SEGMENT_BYTES) await guard('append', () => this.flush());
  }

  async *read(): AsyncGenerator<Uint8Array> {
    const segments = this.segments;
    for (let i = 0; i < segments; i++) {
      const seg = await guard('read partial', () => this.cache.match(`${this.base}/${i}`));
      if (!seg) throw new AssetError('storage', 'Partial download segment is missing');
      yield* streamResponse(seg);
    }
    for (const c of [...this.buffer]) yield c;
  }

  async reset(validator: string | null): Promise<void> {
    await guard('reset', async () => {
      await deletePartialEntries(this.cache, this.base);
      this.segments = 0;
      this.flushed = 0;
      this.buffer = [];
      this.buffered = 0;
      this._validator = validator;
      await this.writeMeta();
    });
  }

  async close(): Promise<void> {
    await guard('close', async () => {
      await this.flush();
      if (this.segments > 0 || this._validator !== null) await this.writeMeta();
    });
  }

  async commit(): Promise<void> {
    await guard('commit', async () => {
      const parts: BlobPart[] = [];
      for (let i = 0; i < this.segments; i++) {
        const seg = await this.cache.match(`${this.base}/${i}`);
        if (!seg) throw new AssetError('storage', 'Partial download segment is missing');
        parts.push(await seg.blob());
      }
      parts.push(...concat(this.buffer));
      const blob = new Blob(parts);
      await this.cache.put(this.url, new Response(blob, {
        headers: {
          'Content-Type': this.ref.contentType ?? 'application/octet-stream',
          'Content-Length': String(blob.size),
        },
      }));
      await deletePartialEntries(this.cache, this.base);
      this.segments = 0;
      this.flushed = 0;
      this.buffer = [];
      this.buffered = 0;
    });
  }

  async discard(): Promise<void> {
    await guard('discard', async () => {
      await deletePartialEntries(this.cache, this.base);
      this.segments = 0;
      this.flushed = 0;
      this.buffer = [];
      this.buffered = 0;
      this._validator = null;
    });
  }
}

export class CacheAssetRegistryStore implements IAssetRegistryStore {
  constructor(private readonly storage: CacheStorage, private readonly cacheName: string = ASSET_CACHE_NAMES.assets) {}

  async load(): Promise<AssetRegistrySnapshot | null> {
    try {
      const hit = await (await this.storage.open(this.cacheName)).match(REGISTRY_KEY);
      if (!hit) return null;
      const json = await hit.json() as AssetRegistrySnapshot;
      return json && json.schema === ASSET_REGISTRY_SCHEMA && Array.isArray(json.assets) ? json : null;
    } catch {
      return null;
    }
  }

  async save(snapshot: AssetRegistrySnapshot): Promise<void> {
    await guard('save registry', async () => {
      await (await this.storage.open(this.cacheName)).put(
        REGISTRY_KEY,
        new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } }),
      );
    });
  }
}
