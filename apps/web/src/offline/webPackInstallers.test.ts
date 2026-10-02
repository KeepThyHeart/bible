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
});
