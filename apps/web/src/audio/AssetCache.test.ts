import { describe, it, expect, beforeEach } from 'vitest';
import { CacheApiAssetCache, MemoryAssetCache, createAssetCache } from './AssetCache';
import type { IAssetCache } from '@bible/core/browser';

/** A just-enough CacheStorage: match / put / keys / delete over Responses. */
class FakeCache {
  entries = new Map<string, Response>();
  async match(key: string | { url: string }) {
    const r = this.entries.get(typeof key === 'string' ? key : key.url);
    return r ? r.clone() : undefined;
  }
  async put(key: string, res: Response) { this.entries.set(key, res); }
  async keys() { return [...this.entries.keys()].map(url => ({ url })); }
  async delete(key: string) { return this.entries.delete(key); }
}
class FakeStorage {
  caches = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name)! as unknown as Cache;
  }
}

const body = (s: string) => new Response(s, { status: 200 });

function contract(name: string, make: () => IAssetCache) {
  describe(`${name} (IAssetCache contract)`, () => {
    let cache: IAssetCache;
    beforeEach(() => { cache = make(); });

    it('stores and returns a response, and reports has()', async () => {
      expect(await cache.has('https://x/a')).toBe(false);
      await cache.put('https://x/a', body('hello'));
      expect(await cache.has('https://x/a')).toBe(true);
      expect(await (await cache.get('https://x/a'))!.blob().then(b => b.size)).toBe(5);
      expect(await cache.get('https://x/missing')).toBeUndefined();
    });

    it('returns a fresh body each time it is read', async () => {
      await cache.put('https://x/a', body('hello'));
      await (await cache.get('https://x/a'))!.arrayBuffer();
      expect(await (await cache.get('https://x/a'))!.arrayBuffer().then(b => b.byteLength)).toBe(5);
    });

    it('deletes by prefix and counts what it removed', async () => {
      await cache.put('https://x/kjv/1', body('a'));
      await cache.put('https://x/kjv/2', body('b'));
      await cache.put('https://x/web/1', body('c'));
      expect(await cache.delete('https://x/kjv/')).toBe(2);
      expect(await cache.has('https://x/kjv/1')).toBe(false);
      expect(await cache.has('https://x/web/1')).toBe(true);
    });

    it('sums usage under a prefix', async () => {
      await cache.put('https://x/kjv/1', body('12345'));
      await cache.put('https://x/kjv/2', body('123'));
      await cache.put('https://x/web/1', body('1'));
      expect(await cache.usage('https://x/kjv/')).toBe(8);
      expect(await cache.usage('https://x/')).toBe(9);
      expect(await cache.usage('https://nothing/')).toBe(0);
    });

    it('lists keys oldest first and touch() makes an entry newest', async () => {
      await cache.put('https://x/1', body('a'));
      await new Promise(r => setTimeout(r, 2));
      await cache.put('https://x/2', body('b'));
      await new Promise(r => setTimeout(r, 2));
      await cache.put('https://x/3', body('c'));
      expect(await cache.keys('https://x/')).toEqual(['https://x/1', 'https://x/2', 'https://x/3']);
      await new Promise(r => setTimeout(r, 2));
      await cache.touch('https://x/1');
      expect(await cache.keys('https://x/')).toEqual(['https://x/2', 'https://x/3', 'https://x/1']);
      await cache.touch('https://x/unknown'); // no throw
    });
  });
}

contract('MemoryAssetCache', () => new MemoryAssetCache());
contract('CacheApiAssetCache', () => new CacheApiAssetCache('t', new FakeStorage() as unknown as CacheStorage));

describe('CacheApiAssetCache specifics', () => {
  it('never lists or counts its recency table', async () => {
    const cache = new CacheApiAssetCache('t', new FakeStorage() as unknown as CacheStorage);
    await cache.put('https://x/1', body('abc'));
    expect(await cache.keys('')).toEqual(['https://x/1']);
    expect(await cache.usage('')).toBe(3);
  });

  it('treats relative and absolute spellings of a key as the same entry', async () => {
    const cache = new CacheApiAssetCache('t', new FakeStorage() as unknown as CacheStorage);
    await cache.put('/audio/v1/a.ogg', body('abc'));
    const abs = new URL('/audio/v1/a.ogg', location.href).href;
    expect(await cache.has(abs)).toBe(true);
    expect(await cache.keys('/audio/')).toEqual([abs]);
    await cache.touch('/audio/v1/a.ogg');
    expect(await cache.delete('/audio/')).toBe(1);
  });

  it('keeps entries in separate named caches', async () => {
    const storage = new FakeStorage() as unknown as CacheStorage;
    const a = new CacheApiAssetCache('a', storage);
    const b = new CacheApiAssetCache('b', storage);
    await a.put('https://x/1', body('1'));
    expect(await b.has('https://x/1')).toBe(false);
  });

  it('survives concurrent puts without losing recency records', async () => {
    const cache = new CacheApiAssetCache('t', new FakeStorage() as unknown as CacheStorage);
    await Promise.all(Array.from({ length: 10 }, (_v, i) => cache.put(`https://x/${i}`, body('z'))));
    expect((await cache.keys('https://x/')).length).toBe(10);
  });
});

describe('createAssetCache', () => {
  it('falls back to memory when the Cache API is absent', async () => {
    const original = (globalThis as { caches?: unknown }).caches;
    delete (globalThis as { caches?: unknown }).caches;
    try {
      const cache = createAssetCache('x');
      expect(cache).toBeInstanceOf(MemoryAssetCache);
    } finally {
      if (original !== undefined) (globalThis as { caches?: unknown }).caches = original;
    }
  });
});
