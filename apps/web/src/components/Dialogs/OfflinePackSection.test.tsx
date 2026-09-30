import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import type { IPackInstaller, IPackSource, PackOffer } from '@bible/core/browser';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key }),
}));
vi.mock('../../offline/moduleAssets', () => ({ installModuleAsset: vi.fn() }));
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
    expect(screen.getByText('Download: 0 KB')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/KJV/));
    await waitFor(() => expect(screen.getByText('Download: 2 MB')).toBeTruthy());
    expect(screen.getByText('Stored: 5 MB')).toBeTruthy();
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

  it('keeps no pack state in browser storage', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    render(<OfflinePackSection source={source([offer('KJV', 'bible', true)])} installers={{}} />);
    await screen.findByText('KJV');
    fireEvent.click(screen.getByLabelText(/KJV/));
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });
});
