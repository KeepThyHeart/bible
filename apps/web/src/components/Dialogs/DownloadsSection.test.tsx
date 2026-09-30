import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { AssetManager, MemoryAssetRegistryStore, MemoryAssetStore } from '@bible/core/browser';
import type { AssetListSnapshot, IAssetManager, IAssetTransport } from '@bible/core/browser';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { defaultValue?: string }) => (key.startsWith('assets.error.') ? `ERR:${key.slice(13)}` : (o?.defaultValue ?? key)),
  }),
}));
vi.mock('../../assets/webAssets', () => ({ getAssetManager: vi.fn(), refreshAssetCatalog: vi.fn(async () => {}) }));

import { DownloadsSection } from './DownloadsSection';

function fakeManager(snapshot: AssetListSnapshot) {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    install: vi.fn(async () => ({})),
    cancel: vi.fn(),
    remove: vi.fn(async () => {}),
  } as unknown as IAssetManager & { install: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
}
const entry = (o: object) => ({ id: 'a', kind: 'tts-voice', title: 'Amy', license: 'CC0', status: 'available', version: '1', size: 63_000_000, storedBytes: 0, pinned: false, verified: true, ...o });

describe('DownloadsSection', () => {
  it('lists assets, refreshes the catalog on open and installs pinned', () => {
    const m = fakeManager({ entries: [entry({}) as never], storedBytes: 0, active: 0 });
    const refresh = vi.fn(async () => {});
    render(<DownloadsSection manager={m} refresh={refresh} />);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('settings.downloads.title')).toBeTruthy();
    expect(screen.getByText('Amy')).toBeTruthy();
    expect(screen.getByText('63 MB')).toBeTruthy();
    fireEvent.click(screen.getByText('settings.downloads.download'));
    expect(m.install).toHaveBeenCalledWith('a', { pinned: true });
  });

  it('shows installed rows with Remove, and a localized error for failed ones', () => {
    const m = fakeManager({
      entries: [
        entry({ id: 'a', status: 'installed', storedBytes: 63_000_000 }) as never,
        entry({ id: 'b', title: 'Bob', status: 'error', error: { code: 'quota', message: 'raw' } }) as never,
      ],
      storedBytes: 63_000_000, active: 0,
    });
    render(<DownloadsSection manager={m} refresh={async () => {}} />);
    expect(screen.getByText('ERR:quota')).toBeTruthy();
    fireEvent.click(screen.getByText('settings.downloads.remove'));
    expect(m.remove).toHaveBeenCalledWith('a');
  });

  it('shows the empty label when nothing is offered', () => {
    render(<DownloadsSection manager={fakeManager({ entries: [], storedBytes: 0, active: 0 })} refresh={async () => {}} />);
    expect(screen.getByText('settings.downloads.empty')).toBeTruthy();
  });

  it('works with a real AssetManager (unbound subscribe/getSnapshot)', async () => {
    const transport = { get: vi.fn(), getText: vi.fn(async () => null) } as unknown as IAssetTransport;
    const manager = new AssetManager({ transport, store: new MemoryAssetStore(), registry: new MemoryAssetRegistryStore() });
    manager.setCatalog([{ id: 'v1', kind: 'tts-voice', version: '1', title: 'Real Voice', license: 'CC0', size: 10, files: [{ path: 'a.bin', url: 'https://x/a.bin', size: 10 }] } as never]);
    render(<DownloadsSection manager={manager} refresh={async () => {}} />);
    expect(await screen.findByText('Real Voice')).toBeTruthy();
  });
});
