import { describe, it, expect, vi, afterEach } from 'vitest';
import { AssetError } from '@bible/core/browser';
import type { PackPlanStep } from '@bible/core/browser';
import { createDesktopPackInstallers } from './desktopPackInstallers';

const step = (catalogId?: number): PackPlanStep => ({
  key: 'module:kjv',
  action: 'install',
  after: [],
  offer: {
    ref: { kind: 'module', id: 'KJV' },
    key: 'module:kjv',
    title: 'King James',
    group: 'bible',
    version: '1',
    downloadBytes: 100,
    storedBytes: 300,
    offlineReadable: true,
    status: 'absent',
    ...(catalogId !== undefined ? { catalogId } : {}),
  },
});

afterEach(() => vi.useRealTimers());

describe('createDesktopPackInstallers', () => {
  it('installs with the catalog id and maps polled progress to onBytes', async () => {
    vi.useFakeTimers();
    let finish!: (ok: boolean) => void;
    const installModule = vi.fn(() => new Promise<boolean>((r) => (finish = r)));
    const getActiveDownloads = vi.fn(async () => [
      { queueId: 1, moduleId: 'other', status: 'downloading', progressBytes: 9, totalBytes: 9 },
      { queueId: 2, moduleId: 'kjv', status: 'downloading', progressBytes: 40, totalBytes: 100 },
    ]);
    const { module } = createDesktopPackInstallers({ installModule, getActiveDownloads, pollMs: 10 });
    const onBytes = vi.fn();
    const p = module.install(step(7), { signal: new AbortController().signal, onBytes });
    await vi.advanceTimersByTimeAsync(10);
    expect(onBytes).toHaveBeenCalledWith(40, 100);
    finish(true);
    await p;
    expect(installModule).toHaveBeenCalledWith('KJV', 7);
    expect(onBytes).toHaveBeenLastCalledWith(100, 100);
  });

  it('rejects with the store error when install returns false', async () => {
    const { module } = createDesktopPackInstallers({
      installModule: async () => false,
      getActiveDownloads: async () => [],
      getLastError: () => 'disk full',
    });
    await expect(module.install(step(), { signal: new AbortController().signal, onBytes: vi.fn() })).rejects.toThrow('disk full');
  });

  it('rejects aborted up front when already aborted', async () => {
    const installModule = vi.fn(async () => true);
    const { module } = createDesktopPackInstallers({ installModule, getActiveDownloads: async () => [] });
    const ac = new AbortController();
    ac.abort();
    await expect(module.install(step(), { signal: ac.signal, onBytes: vi.fn() })).rejects.toBeInstanceOf(AssetError);
    expect(installModule).not.toHaveBeenCalled();
  });

  it('without a cancel API, finishes the current module then rejects aborted', async () => {
    let finish!: (ok: boolean) => void;
    const installModule = vi.fn(() => new Promise<boolean>((r) => (finish = r)));
    const { module } = createDesktopPackInstallers({ installModule, getActiveDownloads: async () => [] });
    const ac = new AbortController();
    const p = module.install(step(), { signal: ac.signal, onBytes: vi.fn() });
    ac.abort();
    finish(true);
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });

  it('with a cancel API, cancels the matching download on abort', async () => {
    vi.useFakeTimers();
    let finish!: (ok: boolean) => void;
    const installModule = vi.fn(() => new Promise<boolean>((r) => (finish = r)));
    const cancelDownload = vi.fn(async () => undefined);
    const { module } = createDesktopPackInstallers({
      installModule,
      cancelDownload,
      pollMs: 10,
      getActiveDownloads: async () => [{ queueId: 5, moduleId: 'kjv', status: 'downloading', progressBytes: 1, totalBytes: 2 }],
    });
    const ac = new AbortController();
    const p = module.install(step(), { signal: ac.signal, onBytes: vi.fn() });
    const settled = expect(p).rejects.toMatchObject({ code: 'aborted' });
    await vi.advanceTimersByTimeAsync(10);
    ac.abort();
    finish(false);
    await settled;
    expect(cancelDownload).toHaveBeenCalledWith(5);
  });
});
