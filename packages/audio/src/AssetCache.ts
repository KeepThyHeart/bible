/**
 * `IAssetCache` implementations: the Cache API from the page, and an in-memory
 * stand-in.
 *
 * The Cache API is used directly by page code (not through a service worker)
 * because the PWA worker is off by default; that way recordings, manifests and
 * TTS models are cached whether or not the PWA is enabled. Keys are the full
 * URLs, so a service worker route added in PWA builds shares the same entries.
 *
 * Recency: the Cache API does not say which entry was used last, and evicting
 * "recently played chapters" needs that. Each cache therefore keeps one small
 * JSON entry (`LRU_KEY`) mapping key to last-used time. `keys()` sorts by it.
 *
 * `MemoryAssetCache` is the fallback where `caches` does not exist (insecure
 * origins, some private modes) and the double used by tests.
 */

import type { CachedResponse, IAssetCache } from '@bible/core/browser';

/** A reserved, syntactically valid URL for the recency table; never fetched. */
const LRU_KEY = 'https://kth-audio.invalid/lru.json';

/**
 * The Cache API reports keys as absolute URLs whatever the caller passed, so
 * every key is made absolute up front. Otherwise the recency table (keyed by
 * what the caller passed) would never match `keys()` for a relative URL.
 */
function absolute(key: string): string {
  try {
    return new URL(key, typeof location !== 'undefined' ? location.href : undefined).href;
  } catch {
    return key;
  }
}

export class CacheApiAssetCache implements IAssetCache {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly name: string,
    private readonly storage: CacheStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private open(): Promise<Cache> {
    return this.storage.open(this.name);
  }

  /** Serialise read-modify-write of the recency table. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  private async readLru(cache: Cache): Promise<Record<string, number>> {
    const hit = await cache.match(LRU_KEY);
    if (!hit) return {};
    try {
      const table = await hit.json();
      return table && typeof table === 'object' ? table as Record<string, number> : {};
    } catch {
      return {};
    }
  }

  private async writeLru(cache: Cache, table: Record<string, number>): Promise<void> {
    await cache.put(LRU_KEY, new Response(JSON.stringify(table), { headers: { 'Content-Type': 'application/json' } }));
  }

  async get(key: string): Promise<CachedResponse | undefined> {
    return (await this.open()).match(absolute(key));
  }

  async has(key: string): Promise<boolean> {
    return (await (await this.open()).match(absolute(key))) !== undefined;
  }

  async put(rawKey: string, res: CachedResponse): Promise<void> {
    const key = absolute(rawKey);
    const cache = await this.open();
    await cache.put(key, res as Response);
    await this.exclusive(async () => {
      const table = await this.readLru(cache);
      table[key] = this.now();
      await this.writeLru(cache, table);
    });
  }

  async touch(rawKey: string): Promise<void> {
    const key = absolute(rawKey);
    const cache = await this.open();
    await this.exclusive(async () => {
      const table = await this.readLru(cache);
      if (!(key in table)) return;
      table[key] = this.now();
      await this.writeLru(cache, table);
    });
  }

  async keys(rawPrefix: string): Promise<string[]> {
    const prefix = rawPrefix === '' ? '' : absolute(rawPrefix);
    const cache = await this.open();
    const table = await this.readLru(cache);
    const urls = (await cache.keys()).map(r => r.url).filter(u => u !== LRU_KEY && u.startsWith(prefix));
    // Oldest first; an entry with no recency record (stored by another writer) sorts first.
    return urls.sort((a, b) => (table[a] ?? 0) - (table[b] ?? 0));
  }

  async delete(rawPrefix: string): Promise<number> {
    const prefix = rawPrefix === '' ? '' : absolute(rawPrefix);
    const cache = await this.open();
    const doomed = (await cache.keys()).map(r => r.url).filter(u => u !== LRU_KEY && u.startsWith(prefix));
    let count = 0;
    for (const url of doomed) {
      if (await cache.delete(url)) count++;
    }
    await this.exclusive(async () => {
      const table = await this.readLru(cache);
      for (const url of doomed) delete table[url];
      await this.writeLru(cache, table);
    });
    return count;
  }

  async usage(rawPrefix: string): Promise<number> {
    const prefix = rawPrefix === '' ? '' : absolute(rawPrefix);
    const cache = await this.open();
    let total = 0;
    for (const req of await cache.keys()) {
      if (req.url === LRU_KEY || !req.url.startsWith(prefix)) continue;
      const res = await cache.match(req);
      if (!res) continue;
      const declared = Number(res.headers.get('Content-Length'));
      total += Number.isFinite(declared) && declared > 0 ? declared : (await res.blob()).size;
    }
    return total;
  }
}

interface MemoryEntry {
  body: ArrayBuffer;
  status: number;
  headers: [string, string][];
}

export class MemoryAssetCache implements IAssetCache {
  /** Insertion order is recency order: `touch` re-inserts. */
  private readonly entries = new Map<string, MemoryEntry>();

  async get(key: string): Promise<CachedResponse | undefined> {
    const e = this.entries.get(key);
    if (!e) return undefined;
    return new Response(e.body.slice(0), { status: e.status, headers: e.headers });
  }

  async has(key: string): Promise<boolean> {
    return this.entries.has(key);
  }

  async put(key: string, res: CachedResponse): Promise<void> {
    const copy = res as Response;
    const body = await copy.arrayBuffer();
    this.entries.delete(key);
    this.entries.set(key, { body, status: copy.status, headers: [...copy.headers.entries()] });
  }

  async touch(key: string): Promise<void> {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    this.entries.set(key, e);
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.entries.keys()].filter(k => k.startsWith(prefix));
  }

  async delete(prefix: string): Promise<number> {
    let count = 0;
    for (const k of [...this.entries.keys()]) {
      if (k.startsWith(prefix)) { this.entries.delete(k); count++; }
    }
    return count;
  }

  async usage(prefix: string): Promise<number> {
    let total = 0;
    for (const [k, e] of this.entries) if (k.startsWith(prefix)) total += e.body.byteLength;
    return total;
  }
}

/** The Cache API when the browser has it, otherwise memory (lost on reload). */
export function createAssetCache(name: string): IAssetCache {
  if (typeof caches !== 'undefined') return new CacheApiAssetCache(name, caches);
  return new MemoryAssetCache();
}

export { AUDIO_CACHE_NAMES } from './cacheNames';
