// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { presentMainManifest } from './manifest';
import { MAIN_MODULES, registerMainModules, closeMainModules } from '../mainModules';
import type { MainModuleDeps } from '../FeatureMainModule';

vi.mock('../../ipc/bibleHandlers', () => ({ ensureBibleRepository: vi.fn() }));
vi.mock('../../services/sharedMainDb', () => ({ getSharedBookRepo: vi.fn() }));
vi.mock('../../utils/windowSecurity', () => ({ lockDownNavigation: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {}, shell: { openExternal: vi.fn() } }));

const deps: MainModuleDeps = { userDataPath: '/tmp/x', getWindows: () => [], log: { info() {}, warn() {}, error() {} } };
const ipcMain = { handle: vi.fn(), removeHandler: vi.fn() };

afterEach(async () => {
  await closeMainModules();
  ipcMain.handle.mockClear();
});

describe('present main module registration', () => {
  it('has a valid manifest and is in the production table', () => {
    expect(validateBuiltinManifest(presentMainManifest)).toEqual([]);
    expect(MAIN_MODULES.some((m) => m.manifest.id === 'present')).toBe(true);
  });

  it('disabled by KTH_MODULES: its code is never loaded and no channel is registered', async () => {
    const entry = MAIN_MODULES.find((m) => m.manifest.id === 'present')!;
    const load = vi.fn(entry.load);
    await registerMainModules(ipcMain, deps, { modules: [{ manifest: entry.manifest, load }], packaged: false, overrideText: '-present' });
    expect(load).not.toHaveBeenCalled();
    expect(ipcMain.handle).not.toHaveBeenCalled();
  });

  it('registers its channels, none of which starts a server by itself', async () => {
    const entry = MAIN_MODULES.find((m) => m.manifest.id === 'present')!;
    await registerMainModules(ipcMain, deps, { modules: [entry], packaged: false, overrideText: '' });
    const channels = ipcMain.handle.mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining(['module:present:status', 'module:present:start', 'module:present:stop', 'module:present:setPassage', 'module:present:step']),
    );
    const statusHandler = ipcMain.handle.mock.calls.find((c) => c[0] === 'module:present:status')![1];
    const reply = await statusHandler({});
    expect(reply.value.running).toBe(false);
  });
});
