import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { offlineStore as OfflineStoreT } from '../stores/offlineStore';
import type { OfflineStorageManager } from '../providers/OfflineStorageManager';

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

let offlineStore: typeof OfflineStoreT;

async function setup() {
  vi.resetModules();
  // The same (fresh) store instance the manager imports.
  ({ offlineStore } = await import('../stores/offlineStore'));
  for (const m of [...offlineStore.downloadedModules]) offlineStore.removeDownloadedModule(m.abbreviation);
  const mod = await import('./autoDownloadManager');
  const manager = {
    downloadModuleLite: vi.fn(async (abbr: string, name: string) => {
      offlineStore.addDownloadedModule({
        abbreviation: abbr, name, type: 'bible', sizeBytes: 1,
        downloadedAt: new Date().toISOString(), autoDownloaded: true,
      });
    }),
    removeModule: vi.fn(async (abbr: string) => { offlineStore.removeDownloadedModule(abbr); }),
  };
  mod.initAutoDownload(manager as unknown as OfflineStorageManager);
  return { ...mod, manager };
}

beforeEach(() => {
  localStorage.clear();
  // Run idle callbacks at once, and report OPFS as available.
  vi.stubGlobal('requestIdleCallback', (fn: () => void) => fn());
  vi.stubGlobal('navigator', { ...navigator, storage: { getDirectory: async () => ({}) } });
});

describe('autoDownloadManager', () => {
  it('does not download a translation opened only in passing', async () => {
    const { triggerAutoDownload, manager, MIN_CHAPTER_READS } = await setup();
    for (let i = 0; i < MIN_CHAPTER_READS - 1; i++) triggerAutoDownload('ASV', 'ASV');
    await flush();
    expect(manager.downloadModuleLite).not.toHaveBeenCalled();
  });

  it('downloads a working translation once it has been read enough', async () => {
    const { triggerAutoDownload, manager, MIN_CHAPTER_READS } = await setup();
    for (let i = 0; i < MIN_CHAPTER_READS; i++) triggerAutoDownload('KJV', 'KJV');
    await flush();
    expect(manager.downloadModuleLite).toHaveBeenCalledTimes(1);
  });

  it('keeps at most MAX_AUTO_DOWNLOADS, dropping the least recently used', async () => {
    const { triggerAutoDownload, manager, MIN_CHAPTER_READS, MAX_AUTO_DOWNLOADS } = await setup();
    const names = ['A', 'B', 'C', 'D'].slice(0, MAX_AUTO_DOWNLOADS + 1);
    for (const n of names) {
      for (let i = 0; i < MIN_CHAPTER_READS; i++) triggerAutoDownload(n, n);
      await flush();
      await new Promise((r) => setTimeout(r, 2)); // distinct downloadedAt times
    }
    expect(manager.removeModule).toHaveBeenCalledWith(names[0]);
    expect(offlineStore.downloadedModules.map((m) => m.abbreviation).sort()).toEqual(names.slice(1).sort());
  });

  // W-024
  it('does not ping-pong re-downloads when three translations alternate', async () => {
    const { triggerAutoDownload, manager, MIN_CHAPTER_READS } = await setup();
    const names = ['KJV', 'ASV', 'WEB'];
    for (const n of names) {
      for (let i = 0; i < MIN_CHAPTER_READS; i++) triggerAutoDownload(n, n);
      await flush();
      await new Promise((r) => setTimeout(r, 2));
    }
    const downloadsAfterSettling = manager.downloadModuleLite.mock.calls.length;
    for (let round = 0; round < 5; round++) {
      for (const n of names) { triggerAutoDownload(n, n); await flush(); }
    }
    expect(manager.downloadModuleLite.mock.calls.length).toBe(downloadsAfterSettling);
    expect(offlineStore.downloadedModules.length).toBe(2);
  });

  // W-024
  it('does not evict a good copy when the new download fails', async () => {
    const { triggerAutoDownload, manager, MIN_CHAPTER_READS } = await setup();
    for (const n of ['A', 'B']) {
      for (let i = 0; i < MIN_CHAPTER_READS; i++) triggerAutoDownload(n, n);
      await flush();
    }
    manager.downloadModuleLite.mockRejectedValueOnce(new Error('network'));
    for (let i = 0; i < MIN_CHAPTER_READS; i++) triggerAutoDownload('C', 'C');
    await flush();
    expect(manager.removeModule).not.toHaveBeenCalled();
    expect(offlineStore.downloadedModules.map((m) => m.abbreviation).sort()).toEqual(['A', 'B']);
  });
});
