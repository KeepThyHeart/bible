import { describe, it, expect, vi } from 'vitest';
import type { IAssetManager, PackPlanStep } from '@bible/core/browser';

vi.mock('./moduleAssets', () => ({ installModuleAsset: vi.fn() }));
vi.mock('../assets/webAssets', () => ({ getAssetManager: vi.fn() }));

import { createWebPackInstallers } from './webPackInstallers';

const step = (kind: 'module' | 'asset', id: string) => ({ key: `${kind}:${id}`, offer: { ref: { kind, id } }, action: 'install', after: [] }) as unknown as PackPlanStep;

describe('createWebPackInstallers', () => {
  it('module installer installs pinned and forwards bytes and the signal', async () => {
    const installModule = vi.fn(async (_a: string, o: { onProgress?: (l: number, t: number) => void }) => { o.onProgress?.(5, 10); });
    const { module } = createWebPackInstallers({ installModule: installModule as never });
    const ctl = new AbortController();
    const onBytes = vi.fn();
    await module.install(step('module', 'KJV'), { signal: ctl.signal, onBytes });
    expect(installModule).toHaveBeenCalledWith('KJV', expect.objectContaining({ pinned: true, signal: ctl.signal }));
    expect(onBytes).toHaveBeenCalledWith(5, 10);
  });

  it('asset installer maps AssetProgress to bytes and installs pinned', async () => {
    const install = vi.fn(async (_id: string, o: { onProgress?: (p: object) => void }) => { o.onProgress?.({ loaded: 3, total: 9 }); });
    const { asset } = createWebPackInstallers({ assetManager: () => ({ install }) as unknown as IAssetManager });
    const ctl = new AbortController();
    const onBytes = vi.fn();
    await asset.install(step('asset', 'amy'), { signal: ctl.signal, onBytes });
    expect(install).toHaveBeenCalledWith('amy', expect.objectContaining({ pinned: true, signal: ctl.signal }));
    expect(onBytes).toHaveBeenCalledWith(3, 9);
  });

  it('propagates rejections (abort)', async () => {
    const { asset } = createWebPackInstallers({ assetManager: () => ({ install: async () => { throw new Error('aborted'); } }) as unknown as IAssetManager });
    await expect(asset.install(step('asset', 'a'), { signal: new AbortController().signal, onBytes: () => {} })).rejects.toThrow('aborted');
  });

  it('a speech voice also caches its pronunciation overlay after it installs', async () => {
    const order: string[] = [];
    const install = vi.fn(async () => { order.push('install'); });
    const prefetchPronunciation = vi.fn(async () => { order.push('overlay'); });
    const am = { install, getSnapshot: () => ({ entries: [{ id: 'amy', kind: 'tts-voice' }, { id: 'piper-runtime', kind: 'tts-runtime' }] }) } as unknown as IAssetManager;
    const { asset } = createWebPackInstallers({ assetManager: () => am, prefetchPronunciation });
    const ctl = new AbortController();
    await asset.install(step('asset', 'amy'), { signal: ctl.signal, onBytes: () => {} });
    expect(prefetchPronunciation).toHaveBeenCalledWith('amy', ctl.signal);
    expect(order).toEqual(['install', 'overlay']);
    // The runtime and other assets carry no overlay.
    await asset.install(step('asset', 'piper-runtime'), { signal: ctl.signal, onBytes: () => {} });
    expect(prefetchPronunciation).toHaveBeenCalledTimes(1);
  });

  it('a failing overlay fetch does not fail the voice install', async () => {
    const am = { install: async () => {}, getSnapshot: () => ({ entries: [{ id: 'amy', kind: 'tts-voice' }] }) } as unknown as IAssetManager;
    const { asset } = createWebPackInstallers({ assetManager: () => am, prefetchPronunciation: async () => { throw new Error('x'); } });
    await expect(asset.install(step('asset', 'amy'), { signal: new AbortController().signal, onBytes: () => {} })).resolves.toBeUndefined();
  });

  it('a Bible module that installs after its voice also caches the overlay', async () => {
    const installModule = vi.fn(async () => {});
    const prefetchPronunciationForModule = vi.fn(async () => {});
    const am = { getSnapshot: () => ({ entries: [{ id: 'amy', kind: 'tts-voice', status: 'installed' }, { id: 'bob', kind: 'tts-voice', status: 'available' }] }) } as unknown as IAssetManager;
    const { module } = createWebPackInstallers({ installModule: installModule as never, assetManager: () => am, prefetchPronunciationForModule });
    const ctl = new AbortController();
    await module.install(step('module', 'KJV'), { signal: ctl.signal, onBytes: () => {} });
    expect(prefetchPronunciationForModule).toHaveBeenCalledWith('KJV', ['amy'], ctl.signal);
  });

  it('a module with no installed voice skips the overlay and a failing overlay does not fail the module', async () => {
    const prefetchPronunciationForModule = vi.fn(async () => { throw new Error('x'); });
    const none = { getSnapshot: () => ({ entries: [] }) } as unknown as IAssetManager;
    const a = createWebPackInstallers({ installModule: vi.fn(async () => {}) as never, assetManager: () => none, prefetchPronunciationForModule });
    await a.module.install(step('module', 'KJV'), { signal: new AbortController().signal, onBytes: () => {} });
    expect(prefetchPronunciationForModule).not.toHaveBeenCalled();
    const some = { getSnapshot: () => ({ entries: [{ id: 'amy', kind: 'tts-voice', status: 'installed' }] }) } as unknown as IAssetManager;
    const b = createWebPackInstallers({ installModule: vi.fn(async () => {}) as never, assetManager: () => some, prefetchPronunciationForModule });
    await expect(b.module.install(step('module', 'KJV'), { signal: new AbortController().signal, onBytes: () => {} })).resolves.toBeUndefined();
  });
});
