import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runStartupUpdateCheck } from './startupUpdateCheck';
import { useNetworkStore } from '../stores/useNetworkStore';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useToastStore } from '../stores/useToastStore';

const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });
const getInfo = vi.fn();
const check = vi.fn();
const download = vi.fn();
const install = vi.fn();

beforeEach(() => {
  getInfo.mockReset().mockImplementation(() => ok({ configured: true, offline: false, host: 'h' }));
  check.mockReset().mockImplementation(() =>
    ok({ status: 'update-available', latestVersion: '1.0.0-beta.3', currentVersion: '1.0.0-beta.2' }));
  download.mockReset();
  install.mockReset();
  useNetworkStore.setState({ allowWebRequests: true, loaded: true, load: vi.fn().mockResolvedValue(undefined) });
  usePreferencesStore.setState({ checkUpdatesAtStartup: true });
  useToastStore.setState({ toasts: [] });
  (window as unknown as { electron: unknown }).electron = { updates: { getInfo, check, download, install } };
});

describe('runStartupUpdateCheck', () => {
  it('does nothing unless the user opted in (default off)', async () => {
    usePreferencesStore.setState({ checkUpdatesAtStartup: false });
    expect(await runStartupUpdateCheck(String)).toBe('disabled');
    expect(getInfo).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it('respects Allow web requests', async () => {
    useNetworkStore.setState({ allowWebRequests: false });
    expect(await runStartupUpdateCheck(String)).toBe('offline');
    expect(check).not.toHaveBeenCalled();
  });

  it('only checks: toasts a newer version, never downloads or installs', async () => {
    expect(await runStartupUpdateCheck((v) => `new ${v}`)).toBe('update-available');
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith({ skipBlocklist: true }); // the extension blocklist is never fetched at launch
    expect(download).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['new 1.0.0-beta.3']);
  });

  it('stays silent when up to date or on error', async () => {
    check.mockImplementation(() => ok({ status: 'up-to-date' }));
    expect(await runStartupUpdateCheck(String)).toBe('up-to-date');
    check.mockImplementation(() => Promise.reject(new Error('boom')));
    expect(await runStartupUpdateCheck(String)).toBe('error');
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
