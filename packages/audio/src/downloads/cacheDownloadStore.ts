/**
 * `IAudioDownloadStore` over an `IAssetCache` (web: the pinned Cache API cache
 * `audio-downloads-v1`) and `fetch`. Nothing here evicts: downloads stay until the
 * reader removes them. `layeredAssetCache` lets the player read them first.
 */
import type { CachedResponse, IAssetCache } from '@bible/core/browser';
import type { AudioDownloadFile, IAudioDownloadStore } from './audioDownloads';

/** True when the blob's SHA-256 is `hex`, or when this context cannot hash (no `crypto.subtle`: insecure origin). */
async function sha256Matches(blob: Blob, hex: string): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return true;
  const digest = new Uint8Array(await subtle.digest('SHA-256', await blob.arrayBuffer()));
  const got = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  return got === hex.toLowerCase();
}

const abortError = () => Object.assign(new Error('aborted'), { code: 'aborted', name: 'AbortError' });

export interface CacheDownloadStoreOptions {
  fetchFn?: (url: string, init: { signal: AbortSignal; cache?: RequestCache }) => Promise<Response>;
  /** Free bytes (default: `navigator.storage.estimate()` quota minus usage). */
  freeBytes?: () => Promise<number | null>;
  /** Default `navigator.storage.persist()`. */
  persist?: () => Promise<unknown>;
}

export function createCacheDownloadStore(cache: IAssetCache, opts: CacheDownloadStoreOptions = {}): IAudioDownloadStore {
  const fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    async present(urls) {
      const out = new Set<string>();
      for (const u of urls) if (await cache.has(u).catch(() => false)) out.add(u);
      return out;
    },

    async fetch(files: readonly AudioDownloadFile[], { signal, onBytes }) {
      let loaded = 0;
      for (const f of files) {
        if (signal.aborted) throw abortError();
        let res: Response;
        try {
          // `index.json` changes (new narrators, revisions): never answered from the HTTP cache.
          res = await fetchFn(f.url, f.url.endsWith('/index.json') ? { signal, cache: 'no-cache' } : { signal });
        } catch (e) {
          if (signal.aborted) throw abortError();
          throw e;
        }
        if (!res.ok) throw new Error(`Download failed (${res.status}): ${f.url.split('/').slice(-3).join('/')}`);
        // Read the whole body first: a cut-off download must never be stored as complete.
        const blob = await res.blob();
        if (signal.aborted) throw abortError();
        if (f.bytes > 0 && blob.size !== f.bytes) throw new Error(`Size mismatch for ${f.url.split('/').pop()}`);
        if (f.sha256 && !(await sha256Matches(blob, f.sha256))) throw new Error(`Checksum mismatch for ${f.url.split('/').pop()}`);
        await cache.put(f.url, new Response(blob, { headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } }) as CachedResponse);
        loaded += f.bytes || blob.size;
        onBytes(loaded);
      }
    },

    async remove(urls) {
      for (const u of urls) await cache.delete(u);
    },

    freeBytes: opts.freeBytes ?? (async () => {
      const est = await nav?.storage?.estimate?.().catch(() => undefined);
      return est && typeof est.quota === 'number' ? Math.max(0, est.quota - (est.usage ?? 0)) : null;
    }),

    async persist() {
      await (opts.persist ? opts.persist() : nav?.storage?.persist?.());
    },
  };
}

/**
 * Reads `pinned` (downloads) first, then `inner` (the evicting LRU); writes, recency, listing
 * and eviction only ever touch `inner`, so downloaded files never count toward or get removed
 * by the LRU.
 */
export function layeredAssetCache(pinned: IAssetCache, inner: IAssetCache): IAssetCache {
  return {
    get: async key => (await pinned.get(key).catch(() => undefined)) ?? inner.get(key),
    has: async key => (await pinned.has(key).catch(() => false)) || inner.has(key),
    put: (key, res) => inner.put(key, res),
    touch: key => inner.touch(key),
    keys: prefix => inner.keys(prefix),
    delete: prefix => inner.delete(prefix),
    usage: prefix => inner.usage(prefix),
  };
}
