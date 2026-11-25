import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import UpdateCheckDialog from './UpdateCheckDialog';
import { useNetworkStore } from '../stores/useNetworkStore';

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const info = { configured: true, offline: true, host: 'updates.example', currentVersion: '1.0.0' };

beforeEach(() => {
  const requestAllow = vi.fn().mockResolvedValue(true);
  useNetworkStore.setState({ allowWebRequests: false, loaded: true, requestAllow });
  (window as unknown as { electron: unknown }).electron = {
    updates: { getInfo: vi.fn().mockResolvedValue({ ok: true, value: info }), canInstall: vi.fn(), onDownloadProgress: vi.fn(() => () => undefined) },
  };
});

describe('UpdateCheckDialog offline state (B-160)', () => {
  it('offers a Turn on button that moves on to the host confirmation', async () => {
    render(<UpdateCheckDialog onClose={() => undefined} />);
    expect(await screen.findByTestId('update-offline')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('update-offline-turn-on'));
    expect(useNetworkStore.getState().requestAllow).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByTestId('update-host')).toHaveTextContent('updates.example'));
  });
});

describe('UpdateCheckDialog downloaded state', () => {
  it('offers Restart and update plus Later, and Later closes without installing', async () => {
    const install = vi.fn();
    const onClose = vi.fn();
    (window as unknown as { electron: unknown }).electron = {
      updates: {
        getInfo: vi.fn().mockResolvedValue({ ok: true, value: { ...info, offline: false } }),
        check: vi.fn().mockResolvedValue({ ok: true, value: { status: 'update-available', latestVersion: '1.0.1', currentVersion: '1.0.0', host: 'updates.example', releaseUrl: '' } }),
        canInstall: vi.fn().mockResolvedValue({ ok: true, value: { supported: true } }),
        download: vi.fn().mockResolvedValue({ ok: true, value: { status: 'downloaded', version: '1.0.1' } }),
        install,
        onDownloadProgress: vi.fn(() => () => undefined),
      },
    };
    useNetworkStore.setState({ allowWebRequests: true, loaded: true });
    render(<UpdateCheckDialog onClose={onClose} />);
    await userEvent.click(await screen.findByTestId('update-check-confirm'));
    await userEvent.click(await screen.findByTestId('update-download-install'));
    expect(await screen.findByTestId('update-restart-install')).toHaveTextContent('updateCheck.restartAndInstall');
    expect(screen.getByTestId('update-check-close')).toHaveTextContent('updateCheck.later');
    await userEvent.click(screen.getByTestId('update-check-close'));
    expect(onClose).toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });
});
