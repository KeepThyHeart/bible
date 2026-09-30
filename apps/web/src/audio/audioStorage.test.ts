import { describe, it, expect } from 'vitest';
import type { IAssetManager } from '@bible/core/browser';
import { MemoryAssetCache } from './AssetCache';
import { audioStorageUsage, clearChapters, clearModels, formatBytes, formatClock } from './audioStorage';

function fakeAssets(entries: Array<{ id: string; kind: string; storedBytes: number }>): IAssetManager & { removed: string[] } {
  const live = new Set(entries.filter((e) => e.storedBytes > 0).map((e) => e.id));
  const removed: string[] = [];
  return {
    getSnapshot: () => ({ entries: entries as never, storedBytes: 0, active: 0 }),
    installed: (id: string) => (live.has(id) ? ({ id } as never) : undefined),
    remove: async (id: string) => { removed.push(id); live.delete(id); },
    removed,
  } as unknown as IAssetManager & { removed: string[] };
}

const res = (n: number) => new Response(new Uint8Array(n));

describe('audio storage', () => {
  it('reports what is stored and clears each area separately', async () => {
    const caches = { models: new MemoryAssetCache(), chapters: new MemoryAssetCache(), manifests: new MemoryAssetCache() };
    await caches.models.put('https://x/runtime/a.wasm', res(1000));
    await caches.chapters.put('https://x/1.ogg', res(300));
    await caches.chapters.put('https://x/2.ogg', res(200));
    await caches.manifests.put('https://x/1.json', res(10));
    expect(await audioStorageUsage(caches, fakeAssets([]))).toEqual({ modelBytes: 1000, chapterBytes: 500, chapterCount: 2 });
    await clearChapters(caches);
    expect(await audioStorageUsage(caches, fakeAssets([]))).toEqual({ modelBytes: 1000, chapterBytes: 0, chapterCount: 0 });
    expect(await caches.manifests.has('https://x/1.json')).toBe(false);
    await clearModels(caches, fakeAssets([]));
    expect((await audioStorageUsage(caches, fakeAssets([]))).modelBytes).toBe(0);
  });

  it('counts manager-held speech assets and removes each tts entry', async () => {
    const caches = { models: new MemoryAssetCache(), chapters: new MemoryAssetCache(), manifests: new MemoryAssetCache() };
    await caches.models.put('https://x/runtime/a.wasm', res(1000));
    const assets = fakeAssets([
      { id: 'piper-runtime', kind: 'tts-runtime', storedBytes: 5000 },
      { id: 'amy', kind: 'tts-voice', storedBytes: 2000 },
      { id: 'table', kind: 'data', storedBytes: 9000 },
      { id: 'other-voice', kind: 'tts-voice', storedBytes: 0 },
    ]);
    expect((await audioStorageUsage(caches, assets)).modelBytes).toBe(7000);
    await clearModels(caches, assets);
    expect(assets.removed).toEqual(['piper-runtime', 'amy']);
    expect(await caches.models.has('https://x/runtime/a.wasm')).toBe(false);
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
