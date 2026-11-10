import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfflineBibleProvider } from './OfflineBibleProvider';
import { offlineStore } from '../stores/offlineStore';

const mod = (abbreviation: string) => ({ abbreviation, type: 'bible' }) as never;

function setup(fileIsMissing: (m: string) => Promise<boolean>) {
  const proxy = { isModuleOpen: () => false, openDb: vi.fn().mockRejectedValue(new Error('wasm failed to load')), closeDb: vi.fn() };
  const p = new OfflineBibleProvider({} as never, proxy as never, fileIsMissing);
  return { p, proxy };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('OfflineBibleProvider stale-entry removal (W-058)', () => {
  beforeEach(() => { offlineStore.downloadedModules = [mod('KJV')]; });

  it('keeps the entry when the open fails but OPFS cannot say the file is missing', async () => {
    const { p } = setup(async () => false);
    await p.preload();
    await flush();
    expect(offlineStore.downloadedModules.map(m => m.abbreviation)).toEqual(['KJV']);
  });

  it('removes the entry when OPFS positively reports the file missing', async () => {
    const { p } = setup(async () => true);
    await p.preload();
    await flush();
    expect(offlineStore.downloadedModules).toEqual([]);
  });
});
