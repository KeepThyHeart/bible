import { describe, it, expect, vi } from 'vitest';
import { createDesktopDownloadStore } from './desktopDownloadStore';

function api(states: Array<{ state: 'running' | 'done' | 'failed' | 'cancelled'; loaded: number; code?: string }>) {
  let i = 0;
  return {
    downloadsPresent: vi.fn(async (u: string[]) => u.slice(0, 1)),
    downloadsFetch: vi.fn(async () => ({ jobId: 'j1' })),
    downloadsProgress: vi.fn(async () => states[Math.min(i++, states.length - 1)]),
    downloadsCancel: vi.fn(async () => {}),
    downloadsRemove: vi.fn(async () => {}),
    downloadsFreeBytes: vi.fn(async () => 123),
  };
}

const files = [{ url: 'kth-audio://app/audio/v1/KJV/a/1/43/001.ogg', bytes: 10 }];

describe('createDesktopDownloadStore', () => {
  it('polls until done and reports bytes', async () => {
    const a = api([{ state: 'running', loaded: 4 }, { state: 'done', loaded: 10 }]);
    const onBytes = vi.fn();
    await createDesktopDownloadStore(a, 1).fetch(files, { signal: new AbortController().signal, onBytes });
    expect(onBytes.mock.calls.map(c => c[0])).toEqual([4, 10]);
  });

  it('rejects with the main process code on failure', async () => {
    const a = api([{ state: 'failed', loaded: 0, code: 'offline' }]);
    await expect(createDesktopDownloadStore(a, 1).fetch(files, { signal: new AbortController().signal, onBytes: () => {} }))
      .rejects.toMatchObject({ code: 'offline' });
  });

  it('cancels the job on abort and rejects as aborted', async () => {
    const a = api([{ state: 'running', loaded: 1 }]);
    const ac = new AbortController();
    const p = createDesktopDownloadStore(a, 5).fetch(files, { signal: ac.signal, onBytes: () => {} });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    expect(a.downloadsCancel).toHaveBeenCalledWith('j1');
  });

  it('maps present, remove and free space', async () => {
    const a = api([]);
    const s = createDesktopDownloadStore(a);
    expect([...(await s.present(['x', 'y']))]).toEqual(['x']);
    await s.remove(['x']);
    expect(a.downloadsRemove).toHaveBeenCalledWith(['x']);
    expect(await s.freeBytes()).toBe(123);
  });
});
