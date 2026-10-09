/**
 * The timeline main module through the real `MAIN_MODULES` table: enabled it registers
 * `module:timeline:getDataset`; disabled (`KTH_MODULES=-timeline`) it is never loaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: { getPath: vi.fn(() => '/fake/userData'), isPackaged: false } }));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../utils/appPaths', () => ({ getDataPath: () => '/nowhere', getUserModulesPath: () => '/nowhere', resolveModulePath: (p: string) => p }));
vi.mock('../../services/installedModules', () => ({ listInstalledModules: vi.fn(() => []) }));
vi.mock('../../services/sharedMainDb', () => ({ getSharedModuleMetadataRepo: vi.fn() }));

import { MAIN_MODULES, registerMainModules, closeMainModules } from '../mainModules';
import { timelineMainManifest } from './manifest';
import type { MainModuleDeps } from '../FeatureMainModule';

const deps: MainModuleDeps = { userDataPath: '/tmp/x', getWindows: () => [], log: { info() {}, warn() {}, error() {} } };

function fakeIpcMain() {
  const handlers = new Map<string, (e: unknown, ...a: any[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((c: string, fn: (e: unknown, ...a: any[]) => unknown) => void handlers.set(c, fn)),
    removeHandler: vi.fn((c: string) => void handlers.delete(c)),
  };
}

beforeEach(async () => {
  await closeMainModules();
});

describe('timeline main module', () => {
  it('has a valid manifest and is in the production table', () => {
    expect(validateBuiltinManifest(timelineMainManifest)).toEqual([]);
    expect(timelineMainManifest.flag).toBeUndefined();
    expect(MAIN_MODULES.map((m) => m.manifest.id)).toContain('timeline');
  });

  it('registers module:timeline:getDataset, answering null with no dataset installed, and removes it on close', async () => {
    const ipc = fakeIpcMain();
    await registerMainModules(ipc, deps, { packaged: false, overrideText: '' });
    expect([...ipc.handlers.keys()].filter((k) => k.startsWith('module:timeline:'))).toEqual(['module:timeline:getDataset']);
    expect(await ipc.handlers.get('module:timeline:getDataset')!({})).toEqual({ ok: true, value: null });
    await closeMainModules();
    expect(ipc.handlers.size).toBe(0);
  });

  it('registers nothing when disabled', async () => {
    const ipc = fakeIpcMain();
    await registerMainModules(ipc, deps, { packaged: false, overrideText: '-timeline' });
    expect(ipc.handle.mock.calls.filter(([c]) => String(c).startsWith('module:timeline:'))).toEqual([]);
  });
});
