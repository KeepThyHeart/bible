import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import type { IPackInstaller, IPackSource, PackOffer } from '@bible/core/browser';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key, i18n: { language: 'en' } }),
}));
vi.mock('../../offline/moduleAssets', () => ({ installModuleAsset: vi.fn(), pinModuleAsset: vi.fn() }));
vi.mock('../../assets/webAssets', () => ({ getAssetManager: vi.fn() }));

import { OfflinePackSection } from './OfflinePackSection';

const offer = (abbr: string, group: PackOffer['group'], readable: boolean, extra: Partial<PackOffer> = {}): PackOffer => ({
  ref: { kind: 'module', id: abbr }, key: `module:${abbr.toLowerCase()}`, title: abbr, group, version: '1',
  downloadBytes: 2_000_000, storedBytes: 5_000_000, offlineReadable: readable, status: 'absent', ...extra,
});

const source = (offers: PackOffer[], free: number | null = 100_000_000): IPackSource => ({
  listOffers: async () => offers,
  listPresets: async () => [{ id: 'starter', name: 'Starter', items: [{ kind: 'module', id: 'KJV' }, { kind: 'module', id: 'MHC' }] }],
  freeBytes: async () => free,
});

describe('OfflinePackSection', () => {
  it('disables non-bible rows with a reason and shows the shell notice', async () => {
    render(<OfflinePackSection source={source([offer('KJV', 'bible', true), offer('MHC', 'commentary', false)])} installers={{}} />);
    await screen.findByText('KJV');
    const mhc = screen.getByLabelText(/MHC/) as HTMLInputElement;
    expect(mhc.disabled).toBe(true);
    expect(screen.getByText('No offline reader for this type in the web app yet.')).toBeTruthy();
    expect(screen.getByText(/offline app shell/)).toBeTruthy();
  });

  it('hides the shell notice when asked', async () => {
    render(<OfflinePackSection source={source([offer('KJV', 'bible', true)])} installers={{}} showShellNotice={false} />);
    await screen.findByText('KJV');
    expect(screen.queryByText(/offline app shell/)).toBeNull();
  });

  it('selecting a row updates the summary; Start runs the installer to done', async () => {
    const install = vi.fn(async (_s, ctx: { onBytes(l: number, t: number): void }) => { ctx.onBytes(2_000_000, 2_000_000); });
    const installers: Record<string, IPackInstaller> = { module: { install } };
    render(<OfflinePackSection source={source([offer('KJV', 'bible', true)])} installers={installers} />);
    await screen.findByText('KJV');
    expect(screen.getByText('Download: 0 B')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/KJV/));
    await waitFor(() => expect(screen.getByText('Download: 1.9 MB')).toBeTruthy());
    expect(screen.getByText('Stored: 4.8 MB')).toBeTruthy();
    fireEvent.click(screen.getByText('Download selected'));
    await waitFor(() => expect(screen.getByText('Done. Everything is on this device.')).toBeTruthy());
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('shows progress while running and Cancel cancels the run', async () => {
    let release: () => void = () => {};
    const install = vi.fn((_s, ctx: { signal: AbortSignal; onBytes(l: number, t: number): void }) => {
      ctx.onBytes(1_000_000, 2_000_000);
      return new Promise<void>((_res, rej) => {
        release = () => {};
        ctx.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AssetError', code: 'aborted' })));
      });
    });
    render(<OfflinePackSection source={source([offer('KJV', 'bible', true)])} installers={{ module: { install } }} />);
    await screen.findByText('KJV');
    fireEvent.click(screen.getByLabelText(/KJV/));
    await waitFor(() => expect((screen.getByText('Download selected') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Download selected'));
    await screen.findByText('Downloading...', { selector: '.kth-pack-run__text' });
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.getByText(/Cancelled/)).toBeTruthy());
    release();
  });

  it('a preset selects only readable, offered items', async () => {
    render(<OfflinePackSection source={source([offer('KJV', 'bible', true), offer('MHC', 'commentary', false)])} installers={{}} />);
    await screen.findByText('Starter');
    fireEvent.click(screen.getByText('Starter'));
    await waitFor(() => expect((screen.getByLabelText(/KJV/) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByLabelText(/MHC/) as HTMLInputElement).checked).toBe(false);
  });

  it('shows the notice under the title and omits the quota-unknown warning', async () => {
    render(<OfflinePackSection source={source([offer('KJV', 'bible', true)], null)} installers={{}} />);
    await screen.findByText('KJV');
    fireEvent.click(screen.getByLabelText(/KJV/));
    await waitFor(() => expect(screen.getByText('Free space unknown')).toBeTruthy());
    expect(screen.queryByText('Free space on this device is unknown.')).toBeNull();
    const title = screen.getByRole('heading', { level: 4, name: 'Offline packs' });
    expect(title.nextElementSibling?.textContent).toMatch(/offline app shell/);
  });

  it('formats sizes with a GB step', async () => {
    render(<OfflinePackSection source={source([offer('KJV', 'bible', true)], 3 * 1024 ** 3)} installers={{}} />);
    await waitFor(() => expect(screen.getByText('Free: 3.0 GB')).toBeTruthy());
  });

  it('Remove on an installed module row removes it and on an asset row removes the asset, then refreshes', async () => {
    const listOffers = vi.fn(async () => [
      offer('KJV', 'bible', true, { status: 'installed' }),
      { ...offer('voice', 'speech', true, { status: 'installed' }), ref: { kind: 'asset' as const, id: 'tts.voice' }, key: 'asset:tts.voice', title: 'Voice' },
    ]);
    const removeModule = vi.fn(async () => {});
    const removeAsset = vi.fn(async () => {});
    render(<OfflinePackSection source={{ ...source([]), listOffers }} installers={{}} removeModule={removeModule} removeAsset={removeAsset} />);
    await screen.findByText('KJV');
    const buttons = screen.getAllByText('Remove');
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(removeModule).toHaveBeenCalledWith('KJV'));
    await waitFor(() => expect(listOffers).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getAllByText('Remove')[1]);
    await waitFor(() => expect(removeAsset).toHaveBeenCalledWith('tts.voice'));
  });

  it('selecting an installed module and pressing Download pins it (no install step)', async () => {
    const pinModule = vi.fn(async () => {});
    const pinAsset = vi.fn(async () => {});
    const install = vi.fn(async () => {});
    render(
      <OfflinePackSection
        source={source([offer('KJV', 'bible', true, { status: 'installed' })])}
        installers={{ module: { install } }}
        pinModule={pinModule}
        pinAsset={pinAsset}
        removeModule={async () => {}}
      />,
    );
    await screen.findByText('KJV');
    const box = screen.getByLabelText(/KJV/) as HTMLInputElement;
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect((screen.getByText('Download selected') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Download selected'));
    await waitFor(() => expect(pinModule).toHaveBeenCalledWith('KJV'));
    expect(install).not.toHaveBeenCalled();
    expect(pinAsset).not.toHaveBeenCalled();
  });

  it('keeps no pack state in browser storage', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    render(<OfflinePackSection source={source([offer('KJV', 'bible', true)])} installers={{}} />);
    await screen.findByText('KJV');
    fireEvent.click(screen.getByLabelText(/KJV/));
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });
});
