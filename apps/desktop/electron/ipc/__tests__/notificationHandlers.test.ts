// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => handlers.set(channel, (...a) => fn({}, ...a)) },
}));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { registerNotificationHandlers } from '../notificationHandlers';
import type { ElectronReminderHost } from '../../notifications/ElectronReminderHost';

type R = { ok: boolean; value?: unknown; error?: { code: string } };
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) as Promise<R>;

const host = {
  getViewState: vi.fn(() => ({ marker: 'state' })),
  setSettings: vi.fn(async (s: unknown) => ({ marker: 'saved', s })),
  setDevice: vi.fn((p: unknown) => ({ marker: 'device', p })),
  sendTest: vi.fn(async () => {}),
  requestPermission: vi.fn(async () => 'granted'),
};
let current: ElectronReminderHost | null = null;
beforeAll(() => registerNotificationHandlers(() => current));

describe('notification IPC handlers', () => {
  it('is unavailable until the host exists', async () => {
    expect(await call('notifications:get-state')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    current = host as unknown as ElectronReminderHost;
  });

  it('delegates the five channels to the host', async () => {
    expect(await call('notifications:get-state')).toEqual({ ok: true, value: { marker: 'state' } });
    expect((await call('notifications:set-settings', { version: 1, enabled: true })).ok).toBe(true);
    expect(host.setSettings).toHaveBeenCalledWith({ version: 1, enabled: true });
    expect(await call('notifications:set-device', { tray: true })).toMatchObject({ ok: true, value: { marker: 'device', p: { tray: true } } });
    expect((await call('notifications:send-test')).ok).toBe(true);
    expect(host.sendTest).toHaveBeenCalled();
    expect(await call('notifications:request-permission')).toEqual({ ok: true, value: 'granted' });
  });

  it('validates argument shapes', async () => {
    host.setSettings.mockClear();
    host.setDevice.mockClear();
    for (const bad of [null, 'x', 3, [1]]) {
      expect(await call('notifications:set-settings', bad)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(await call('notifications:set-device', bad)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    }
    expect(await call('notifications:set-device', { tray: 'yes' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(host.setSettings).not.toHaveBeenCalled();
    expect(host.setDevice).not.toHaveBeenCalled();
  });

  it('drops unknown device keys', async () => {
    host.setDevice.mockClear();
    await call('notifications:set-device', { openAtLogin: true, evil: 1 });
    expect(host.setDevice).toHaveBeenCalledWith({ openAtLogin: true });
  });
});
