// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';

vi.mock('electron', () => ({ ipcMain: {}, Notification: { isSupported: () => true }, powerMonitor: { on: vi.fn() } }));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import mainModule from './index';
import { notificationsMainManifest } from './manifest';
import { MAIN_MODULES, registerMainModules, closeMainModules } from '../mainModules';
import { createModuleIpc } from '../moduleIpc';
import { setActiveReminderHost } from '../../notifications/activeHost';
import type { ElectronReminderHost } from '../../notifications/ElectronReminderHost';
import type { MainModuleDeps } from '../FeatureMainModule';

type R = { ok: boolean; value?: unknown; error?: { code: string } };
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const ipcMain = {
  handle: (channel: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => handlers.set(channel, (...a) => fn({}, ...a)),
  removeHandler: (channel: string) => handlers.delete(channel),
};
const deps: MainModuleDeps = { userDataPath: '/tmp/x', getWindows: () => [], log: { info() {}, warn() {}, error() {} } };
const call = (method: string, ...args: unknown[]) => handlers.get(`module:notifications:${method}`)!(...args) as Promise<R>;

const host = {
  getViewState: vi.fn(() => ({ marker: 'state' })),
  setSettings: vi.fn(async (s: unknown) => ({ marker: 'saved', s })),
  setDevice: vi.fn((p: unknown) => ({ marker: 'device', p })),
  sendTest: vi.fn(async () => {}),
  requestPermission: vi.fn(async () => 'granted'),
  takeOpenTarget: vi.fn(() => ({ kind: 'route', route: 'settings/notifications' })),
};

beforeAll(() => {
  mainModule.registerIpc(createModuleIpc('notifications', ipcMain, deps), deps);
});

describe('notifications main module', () => {
  it('has a valid manifest and is in the production table', () => {
    expect(validateBuiltinManifest(notificationsMainManifest)).toEqual([]);
    expect(MAIN_MODULES.some((m) => m.manifest.id === 'notifications')).toBe(true);
  });

  it('registers the six module channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      ['getState', 'requestPermission', 'sendTest', 'setDevice', 'setSettings', 'takeOpenTarget'].map((m) => `module:notifications:${m}`).sort(),
    );
  });

  it('is unavailable until the host exists', async () => {
    expect(await call('getState')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    setActiveReminderHost(host as unknown as ElectronReminderHost);
  });

  it('delegates to the host', async () => {
    expect(await call('getState')).toEqual({ ok: true, value: { marker: 'state' } });
    expect((await call('setSettings', { version: 1, enabled: true })).ok).toBe(true);
    expect(host.setSettings).toHaveBeenCalledWith({ version: 1, enabled: true });
    expect(await call('setDevice', { tray: true })).toMatchObject({ ok: true, value: { marker: 'device', p: { tray: true } } });
    expect((await call('sendTest')).ok).toBe(true);
    expect(host.sendTest).toHaveBeenCalled();
    expect(await call('requestPermission')).toEqual({ ok: true, value: 'granted' });
  });

  it('hands the pending open target to the renderer', async () => {
    expect(await call('takeOpenTarget')).toEqual({ ok: true, value: { kind: 'route', route: 'settings/notifications' } });
    host.takeOpenTarget.mockReturnValueOnce(null as never);
    expect(await call('takeOpenTarget')).toEqual({ ok: true, value: null });
  });

  it('validates argument shapes', async () => {
    host.setSettings.mockClear();
    host.setDevice.mockClear();
    for (const bad of [null, 'x', 3, [1]]) {
      expect(await call('setSettings', bad)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(await call('setDevice', bad)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    }
    expect(await call('setDevice', { tray: 'yes' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(host.setSettings).not.toHaveBeenCalled();
    expect(host.setDevice).not.toHaveBeenCalled();
  });

  it('drops unknown device keys', async () => {
    host.setDevice.mockClear();
    await call('setDevice', { openAtLogin: true, evil: 1 });
    expect(host.setDevice).toHaveBeenCalledWith({ openAtLogin: true });
  });
});

describe('notifications main module registration', () => {
  const fake = { handle: vi.fn(), removeHandler: vi.fn() };
  afterEach(async () => {
    await closeMainModules();
    fake.handle.mockClear();
  });

  it('enabled: registers its channels at startup', async () => {
    const entry = MAIN_MODULES.find((m) => m.manifest.id === 'notifications')!;
    await registerMainModules(fake, deps, { modules: [entry], packaged: false, overrideText: '' });
    expect(fake.handle.mock.calls.map((c) => c[0])).toContain('module:notifications:getState');
  });

  it('disabled by KTH_MODULES: its code is never loaded and no channel is registered', async () => {
    const entry = MAIN_MODULES.find((m) => m.manifest.id === 'notifications')!;
    const load = vi.fn(entry.load);
    await registerMainModules(fake, deps, { modules: [{ manifest: entry.manifest, load }], packaged: false, overrideText: '-notifications' });
    expect(load).not.toHaveBeenCalled();
    expect(fake.handle).not.toHaveBeenCalled();
  });
});
