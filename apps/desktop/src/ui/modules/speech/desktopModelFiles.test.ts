import { describe, it, expect, vi } from 'vitest';
import { createDesktopModelFiles, type AssetsBridgeLike } from './desktopModelFiles';

const ok = <T,>(data: T) => Promise.resolve({ ok: true, value: data }) as never;
const snap = (e: Record<string, unknown>) => ok({ entries: [{ id: 'a', ...e }], storedBytes: 0, active: 0 });

function bridge(over: Partial<AssetsBridgeLike> = {}): AssetsBridgeLike {
  return {
    list: vi.fn(() => snap({ status: 'available' })),
    install: vi.fn(() => ok({ started: true })),
    cancel: vi.fn(() => ok({ cancelled: true })),
    remove: vi.fn(() => ok({ removed: true })),
    read: vi.fn(() => ok(new Uint8Array([1, 2]))),
    ...over,
  };
}

describe('desktopModelFiles', () => {
  it('isInstalled follows the entry status', async () => {
    expect(await createDesktopModelFiles(() => bridge(), 1).isInstalled('a')).toBe(false);
    expect(await createDesktopModelFiles(() => bridge({ list: vi.fn(() => snap({ status: 'installed' })) }), 1).isInstalled('a')).toBe(true);
    expect(await createDesktopModelFiles(() => bridge(), 1).isInstalled('zzz')).toBe(false);
  });

  it('install polls list, reports progress and resolves when installed', async () => {
    const list = vi
      .fn()
      .mockReturnValueOnce(snap({ status: 'downloading', progress: { loaded: 5, total: 10 } }))
      .mockReturnValue(snap({ status: 'installed' }));
    const onProgress = vi.fn();
    await createDesktopModelFiles(() => bridge({ list }), 1).install('a', onProgress, new AbortController().signal);
    expect(onProgress).toHaveBeenCalledWith({ phase: 'engine', loaded: 5, total: 10 });
  });

  it('install rejects with the job error', async () => {
    const list = vi.fn(() => snap({ status: 'error', error: { code: 'network', message: 'offline' } }));
    await expect(createDesktopModelFiles(() => bridge({ list }), 1).install('a', vi.fn(), new AbortController().signal)).rejects.toThrow('offline');
  });

  it('abort cancels the job and rejects', async () => {
    const b = bridge({ list: vi.fn(() => snap({ status: 'downloading' })) });
    const ctrl = new AbortController();
    const p = createDesktopModelFiles(() => b, 1).install('a', vi.fn(), ctrl.signal);
    await vi.waitFor(() => expect(b.list).toHaveBeenCalled());
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(b.cancel).toHaveBeenCalledWith('a');
  });

  it('read returns bytes (also from an ArrayBuffer) and remove delegates', async () => {
    const b = bridge({ read: vi.fn(() => ok(new Uint8Array([9]).buffer)) });
    const f = createDesktopModelFiles(() => b, 1);
    expect(Array.from(await f.read('a', 'config.json'))).toEqual([9]);
    expect(b.read).toHaveBeenCalledWith('a', 'config.json');
    await f.remove('a');
    expect(b.remove).toHaveBeenCalledWith('a');
  });
});
