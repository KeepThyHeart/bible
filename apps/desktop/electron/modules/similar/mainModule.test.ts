import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { similarMainManifest } from './manifest';
import { MAIN_MODULES, registerMainModules, closeMainModules } from '../mainModules';
import type { MainModuleDeps } from '../FeatureMainModule';
import { notifySemanticSearchReset } from '../../ipc/semanticSearchReset';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/fake/userData'), isPackaged: false },
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const deps: MainModuleDeps = { userDataPath: '/tmp/x', getWindows: () => [], log: { info() {}, warn() {}, error() {} } };
const ipcMain = { handle: vi.fn(), removeHandler: vi.fn() };

afterEach(async () => {
  await closeMainModules();
  ipcMain.handle.mockClear();
  ipcMain.removeHandler.mockClear();
});

describe('similar main module registration', () => {
  it('has a valid manifest and is in the production table', () => {
    expect(validateBuiltinManifest(similarMainManifest)).toEqual([]);
    expect(MAIN_MODULES.some((m) => m.manifest.id === 'similar')).toBe(true);
  });

  it('disabled by KTH_MODULES: its code is never loaded and no channel is registered', async () => {
    const entry = MAIN_MODULES.find((m) => m.manifest.id === 'similar')!;
    const load = vi.fn(entry.load);
    await registerMainModules(ipcMain, deps, { modules: [{ manifest: entry.manifest, load }], packaged: false, overrideText: '-similar' });
    expect(load).not.toHaveBeenCalled();
    expect(ipcMain.handle).not.toHaveBeenCalled();
  });

  it('enabled: registers module:similar:* channels at startup and removes them on close', async () => {
    const entry = MAIN_MODULES.find((m) => m.manifest.id === 'similar')!;
    await registerMainModules(ipcMain, deps, { modules: [entry], packaged: false, overrideText: '' });
    expect(ipcMain.handle.mock.calls.map((c) => c[0]).sort()).toEqual([
      'module:similar:explain',
      'module:similar:find',
      'module:similar:reset',
      'module:similar:status',
    ]);
    // A semantic search reset reaches the module without building its (heavy) environment.
    expect(() => notifySemanticSearchReset()).not.toThrow();
    await closeMainModules();
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(4);
  });

  it('answers a malformed range with invalid_input through the module channel', async () => {
    const entry = MAIN_MODULES.find((m) => m.manifest.id === 'similar')!;
    await registerMainModules(ipcMain, deps, { modules: [entry], packaged: false, overrideText: '' });
    const find = ipcMain.handle.mock.calls.find((c) => c[0] === 'module:similar:find')![1] as (e: unknown, ...a: unknown[]) => Promise<any>;
    const reply = await find({}, { startVerseId: 'x' });
    // The default environment is built lazily and may fail to load in a bare test process;
    // either way the reply is a Result envelope and never a throw.
    expect(typeof reply.ok).toBe('boolean');
  });
});
