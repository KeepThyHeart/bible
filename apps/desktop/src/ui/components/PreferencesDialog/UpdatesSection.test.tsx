import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UpdatesSection } from './UpdatesSection';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { usePreferencesStore } from '../../stores/usePreferencesStore';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key) }),
}));

const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });
const getInfo = vi.fn();
const canInstall = vi.fn();

beforeEach(() => {
  getInfo.mockReset().mockImplementation(() =>
    ok({ host: 'api.github.com', manifestUrl: 'x', currentVersion: '1.0.0-beta.3', offline: false, configured: true, channel: 'beta', buildId: 'abc1234' }));
  canInstall.mockReset().mockImplementation(() => ok({ supported: true }));
  useNetworkStore.setState({ allowWebRequests: true, loaded: true, load: vi.fn().mockResolvedValue(undefined) });
  usePreferencesStore.setState({ checkUpdatesAtStartup: false });
  (window as unknown as { electron: unknown }).electron = { updates: { getInfo, canInstall } };
});

describe('UpdatesSection', () => {
  it('shows version, build and channel without contacting any host', async () => {
    render(<UpdatesSection />);
    await waitFor(() => expect(screen.getByTestId('updates-version')).toHaveTextContent('1.0.0-beta.3'));
    expect(screen.getByTestId('updates-build')).toHaveTextContent('abc1234');
    expect(screen.getByTestId('updates-channel')).toHaveTextContent('Beta');
    expect(screen.queryByTestId('updates-unsupported-note')).toBeNull();
  });

  it('says Stable for a release without a pre-release tag', async () => {
    getInfo.mockImplementation(() => ok({ host: 'h', manifestUrl: 'x', currentVersion: '1.0.0', offline: false, configured: true, channel: null, buildId: '' }));
    render(<UpdatesSection />);
    await waitFor(() => expect(screen.getByTestId('updates-channel')).toHaveTextContent('updatesChannelStable'));
    expect(screen.queryByTestId('updates-build')).toBeNull();
  });

  it('the button opens the existing Check for Updates flow', async () => {
    const seen = vi.fn();
    window.addEventListener('command:app:checkForUpdates', seen);
    render(<UpdatesSection />);
    await userEvent.click(screen.getByTestId('updates-check-button'));
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener('command:app:checkForUpdates', seen);
  });

  it('startup check is off by default and opt-in only', async () => {
    render(<UpdatesSection />);
    const box = screen.getByTestId('updates-check-at-startup');
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(usePreferencesStore.getState().checkUpdatesAtStartup).toBe(true);
    await userEvent.click(box);
    expect(usePreferencesStore.getState().checkUpdatesAtStartup).toBe(false);
  });

  it.each([
    ['linux-package-manager', 'updatesNoteLinuxPackage'],
    ['macos-unsigned', 'updatesNoteMacUnsigned'],
  ])('explains an unsupported install (%s)', async (reason, key) => {
    canInstall.mockImplementation(() => ok({ supported: false, reason }));
    render(<UpdatesSection />);
    await waitFor(() => expect(screen.getByTestId('updates-unsupported-note')).toHaveTextContent(key));
  });

  it('mentions Allow web requests when it is off', async () => {
    useNetworkStore.setState({ allowWebRequests: false });
    render(<UpdatesSection />);
    expect(screen.getByTestId('updates-offline-note')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('updates-version')).toHaveTextContent('1.0.0-beta.3'));
  });
});
