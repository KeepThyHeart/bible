import { describe, it, expect, vi } from 'vitest';
import { ASSET_REGISTRY_SCHEMA, isAssetError } from '@bible/core/browser';
import type { AssetFileRef } from '@bible/core/browser';
import { describeAssetStoreContract, makeBytes, collect } from '../../../../packages/core/src/__tests__/assets/fakes';
import { CacheAssetRegistryStore, CacheAssetStore, SEGMENT_BYTES } from './CacheAssetStore';

class FakeCache {
  entries = new Map<string, Response>();
  failPut: Error | null = null;
  async match(key: string | { url: string }) {
    const r = this.entries.get(typeof key === 'string' ? key : key.url);
    return r ? r.clone() : undefined;
  }
  async put(key: string, res: Response) {
    if (this.failPut) throw this.failPut;
    this.entries.set(key, res);
  }
  async keys() { return [...this.entries.keys()].map((url) => ({ url })); }
  async delete(key: string) { return this.entries.delete(key); }
}
class FakeStorage {
  caches = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name)! as unknown as Cache;
  }
  cache(name: string): FakeCache { return this.caches.get(name)!; }
}
const asStorage = (s: FakeStorage) => s as unknown as CacheStorage;

describeAssetStoreContract(() => new CacheAssetStore(asStorage(new FakeStorage())), 'CacheAssetStore (IAssetStore contract)');

function ref(url: string, kind = 'data', extra: Partial<AssetFileRef> = {}): AssetFileRef {
  return { assetId: 'a', kind, version: '1', path: 'f.bin', url, size: 0, ...extra };
}

describe('CacheAssetStore', () => {
  it('routes tts kinds to tts-models-v1 and others to assets-v1, keyed by absolute url with content headers', async () => {
    const st = new FakeStorage();
    const s = new CacheAssetStore(asStorage(st));
    const v = ref('https://x.test/v.onnx', 'tts-voice', { contentType: 'application/onnx' });
    const d = ref('https://x.test/d.bin', 'data');
    for (const r of [v, d]) {
      const p = await s.openPartial(r);
      await p.append(makeBytes(10));
      await p.commit();
    }
    const hit = await st.cache('tts-models-v1').match('https://x.test/v.onnx');
    expect(hit!.headers.get('Content-Type')).toBe('application/onnx');
    expect(hit!.headers.get('Content-Length')).toBe('10');
    expect(await st.cache('assets-v1').match('https://x.test/d.bin')).toBeDefined();
    expect(await st.cache('assets-v1').match('https://x.test/v.onnx')).toBeUndefined();
    expect([...st.cache('assets-v1').entries.keys()].filter((k) => k.includes('/partial/'))).toEqual([]);
  });

  it('flushes a 4 MiB segment, then resumes from meta after a reload with the tail in a second segment', async () => {
    const st = new FakeStorage();
    const r = ref('https://x.test/big.bin');
    const a = makeBytes(SEGMENT_BYTES + 100, 3);
    const b = makeBytes(50, 4);
    const p = await new CacheAssetStore(asStorage(st)).openPartial(r);
    await p.reset('"etag1"');
    await p.append(a);
    const segKeys = () => [...st.cache('assets-v1').entries.keys()].filter((k) => /\/\d+$/.test(k));
    expect(segKeys()).toHaveLength(1);
    await p.append(b);
    expect(p.size).toBe(a.length + b.length);
    await p.close();
    expect(segKeys()).toHaveLength(2);

    const p2 = await new CacheAssetStore(asStorage(st)).openPartial(r);
    expect(p2.size).toBe(a.length + b.length);
    expect(p2.validator).toBe('"etag1"');
    const got = await collect(p2.read());
    expect(got.length).toBe(a.length + b.length);
    expect(got.subarray(0, 20)).toEqual(a.subarray(0, 20));
    expect(got.subarray(a.length)).toEqual(b);
    await p2.commit();
    const s = new CacheAssetStore(asStorage(st));
    expect((await collect(await s.read(r))).length).toBe(a.length + b.length);
    expect([...st.cache('assets-v1').entries.keys()].filter((k) => k.includes('/partial/'))).toEqual([]);
  });

  it('read() yields flushed segments before the unflushed buffer', async () => {
    const st = new FakeStorage();
    const p = await new CacheAssetStore(asStorage(st)).openPartial(ref('https://x.test/o.bin'));
    const a = makeBytes(SEGMENT_BYTES, 5);
    const b = makeBytes(7, 6);
    await p.append(a);
    await p.append(b);
    const got = await collect(p.read());
    expect(got.subarray(got.length - 7)).toEqual(b);
    expect(got.length).toBe(SEGMENT_BYTES + 7);
  });

  it('treats a partial with a missing segment as empty', async () => {
    const st = new FakeStorage();
    const r = ref('https://x.test/m.bin');
    const p = await new CacheAssetStore(asStorage(st)).openPartial(r);
    await p.append(makeBytes(20));
    await p.close();
    const seg = [...st.cache('assets-v1').entries.keys()].find((k) => /\/0$/.test(k))!;
    st.cache('assets-v1').entries.delete(seg);
    const p2 = await new CacheAssetStore(asStorage(st)).openPartial(r);
    expect(p2.size).toBe(0);
    expect(p2.validator).toBeNull();
  });

  it('maps QuotaExceededError to AssetError quota and other failures to storage', async () => {
    const st = new FakeStorage();
    const s = new CacheAssetStore(asStorage(st));
    const p = await s.openPartial(ref('https://x.test/q.bin'));
    await p.append(makeBytes(10));
    st.cache('assets-v1').failPut = new DOMException('full', 'QuotaExceededError');
    const e = await p.commit().catch((x) => x);
    expect(isAssetError(e) && e.code).toBe('quota');
    st.cache('assets-v1').failPut = new Error('disk on fire');
    const e2 = await p.commit().catch((x) => x);
    expect(isAssetError(e2) && e2.code).toBe('storage');
  });

  it('freeBytes is quota minus usage, or null when unknown', async () => {
    const s = new CacheAssetStore(asStorage(new FakeStorage()));
    const orig = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ quota: 1000, usage: 300 }) } });
    expect(await s.freeBytes()).toBe(700);
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({}) } });
    expect(await s.freeBytes()).toBeNull();
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    expect(await s.freeBytes()).toBeNull();
    if (orig) Object.defineProperty(navigator, 'storage', orig); else delete (navigator as unknown as Record<string, unknown>).storage;
  });
});

describe('CacheAssetRegistryStore', () => {
  it('round-trips a snapshot in assets-v1 and returns null when empty or foreign', async () => {
    const st = new FakeStorage();
    const reg = new CacheAssetRegistryStore(asStorage(st));
    expect(await reg.load()).toBeNull();
    const snap = { schema: ASSET_REGISTRY_SCHEMA, assets: [] } as const;
    await reg.save({ ...snap, assets: [] });
    expect(await reg.load()).toEqual(snap);
    expect(st.cache('assets-v1').entries.has('https://kth-assets.invalid/registry.json')).toBe(true);
    st.cache('assets-v1').entries.set('https://kth-assets.invalid/registry.json', new Response('{"schema":"other"}'));
    expect(await reg.load()).toBeNull();
    st.cache('assets-v1').entries.set('https://kth-assets.invalid/registry.json', new Response('not json'));
    expect(await reg.load()).toBeNull();
  });

  it('save failure on quota is an AssetError', async () => {
    const st = new FakeStorage();
    const reg = new CacheAssetRegistryStore(asStorage(st));
    await reg.save({ schema: ASSET_REGISTRY_SCHEMA, assets: [] });
    st.cache('assets-v1').failPut = new DOMException('full', 'QuotaExceededError');
    const e = await reg.save({ schema: ASSET_REGISTRY_SCHEMA, assets: [] }).catch((x) => x);
    expect(isAssetError(e) && e.code).toBe('quota');
    vi.restoreAllMocks();
  });
});
