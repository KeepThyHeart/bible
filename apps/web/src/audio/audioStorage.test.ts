import { describe, it, expect } from 'vitest';
import { MemoryAssetCache } from './AssetCache';
import { audioStorageUsage, clearChapters, clearModels, formatBytes, formatClock } from './audioStorage';

const res = (n: number) => new Response(new Uint8Array(n));

describe('audio storage', () => {
  it('reports what is stored and clears each area separately', async () => {
    const caches = { models: new MemoryAssetCache(), chapters: new MemoryAssetCache(), manifests: new MemoryAssetCache() };
    await caches.models.put('https://x/runtime/a.wasm', res(1000));
    await caches.chapters.put('https://x/1.ogg', res(300));
    await caches.chapters.put('https://x/2.ogg', res(200));
    await caches.manifests.put('https://x/1.json', res(10));
    expect(await audioStorageUsage(caches)).toEqual({ modelBytes: 1000, chapterBytes: 500, chapterCount: 2 });
    await clearChapters(caches);
    expect(await audioStorageUsage(caches)).toEqual({ modelBytes: 1000, chapterBytes: 0, chapterCount: 0 });
    expect(await caches.manifests.has('https://x/1.json')).toBe(false);
    await clearModels(caches);
    expect((await audioStorageUsage(caches)).modelBytes).toBe(0);
  });

  it('formats sizes and clock times', () => {
    expect(formatBytes(63_104_526)).toBe('63 MB');
    expect(formatBytes(1_300_000)).toBe('1.3 MB');
    expect(formatBytes(820)).toBe('1 KB');
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatClock(138)).toBe('2:18');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(-3)).toBe('0:00');
  });
});
