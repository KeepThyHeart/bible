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
