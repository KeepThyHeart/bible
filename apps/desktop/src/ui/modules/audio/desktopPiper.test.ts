import { describe, it, expect, vi } from 'vitest';
import { createDesktopPiperAssets, type AssetsBridgeLike } from './desktopPiper';

type Entry = { id: string; status: string; size: number; progress?: { loaded: number; total: number }; error?: { code: string; message: string } };

function bridge(entries: Entry[], onTick?: (e: Entry[], polls: number) => void) {
  let polls = 0;
  const b = {
    list: vi.fn(async () => { polls++; onTick?.(entries, polls); return { ok: true, value: { entries, storedBytes: 0, active: 0 } }; }),
    install: vi.fn(async (id: string) => { const e = entries.find(x => x.id === id)!; e.status = 'downloading'; return { ok: true, value: { started: true } }; }),
    cancel: vi.fn(async () => ({ ok: true, value: { cancelled: true } })),
    remove: vi.fn(async () => ({ ok: true, value: { removed: true } })),
  };
  return b as unknown as AssetsBridgeLike & typeof b;
}
const fresh = (): Entry[] => [
  { id: 'piper-runtime', status: 'available', size: 100 },
  { id: 'piper-pronunciation', status: 'available', size: 20 },
  { id: 'piper-voice-x', status: 'available', size: 50 },
];

describe('desktop PiperAssetPort', () => {
  it('installing the runtime also installs the pronunciation overlay, with summed progress', async () => {
    const entries = fresh();
    const b = bridge(entries, (es, n) => {
      if (n === 1) { es[0].progress = { loaded: 40, total: 100 }; }
      if (n === 2) { es[0].status = 'installed'; es[1].progress = { loaded: 10, total: 20 }; }
      if (n >= 3) es[1].status = 'installed';
    });
    const progress: Array<[number, number]> = [];
    await createDesktopPiperAssets(() => b, 0).install('piper-runtime', { onProgress: p => progress.push([p.loaded, p.total]) });
    expect(b.install.mock.calls.map(c => c[0])).toEqual(['piper-runtime', 'piper-pronunciation']);
    expect(progress[0]).toEqual([40, 120]);
    expect(progress.at(-1)).toEqual([120, 120]);
  });

  it('installs a manifest by its id; a voice alone is one asset', async () => {
    const entries = fresh();
    const b = bridge(entries, (es) => { es[2].status = 'installed'; });
    await createDesktopPiperAssets(() => b, 0).install({ id: 'piper-voice-x' } as never, {});
    expect(b.install.mock.calls.map(c => c[0])).toEqual(['piper-voice-x']);
  });

  it('abort cancels and rejects with AbortError', async () => {
    const b = bridge(fresh());
    const ac = new AbortController();
    const p = createDesktopPiperAssets(() => b, 0).install('piper-voice-x', { signal: ac.signal });
    await new Promise(r => setTimeout(r, 5));
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect((b.cancel.mock.calls as unknown[][]).map(c => c[0])).toContain('piper-voice-x');
  });

  it('a failed download throws its message', async () => {
    const b = bridge(fresh(), es => { es[2].status = 'error'; es[2].error = { code: 'network', message: 'You are offline' }; });
    await expect(createDesktopPiperAssets(() => b, 0).install('piper-voice-x', {})).rejects.toThrow('You are offline');
  });

  it('installed() needs the whole group; adopt() is false; remove() removes the group', async () => {
    const entries = fresh();
    entries[0].status = 'installed';
    const b = bridge(entries);
    const port = createDesktopPiperAssets(() => b, 0);
    expect(await port.installed('piper-runtime')).toBe(false);
    entries[1].status = 'update-available';
    expect(await port.installed('piper-runtime')).toBe(true);
    expect(await port.adopt({} as never)).toBe(false);
    await port.remove('piper-runtime');
    expect((b.remove.mock.calls as unknown[][]).map(c => c[0])).toEqual(['piper-runtime', 'piper-pronunciation']);
  });
});
