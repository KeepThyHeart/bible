import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { quizMainManifest } from './manifest';
import { MAIN_MODULES, registerMainModules, closeMainModules } from '../mainModules';
import type { MainModuleDeps } from '../FeatureMainModule';

const deps: MainModuleDeps = { userDataPath: '/tmp/x', getWindows: () => [], log: { info() {}, warn() {}, error() {} } };
const ipcMain = { handle: vi.fn(), removeHandler: vi.fn() };

afterEach(async () => {
  await closeMainModules();
  ipcMain.handle.mockClear();
});

describe('quiz main module registration', () => {
  it('has a valid manifest and is in the production table', () => {
    expect(validateBuiltinManifest(quizMainManifest)).toEqual([]);
    expect(MAIN_MODULES.some((m) => m.manifest.id === 'quiz')).toBe(true);
  });

  it('disabled by KTH_MODULES: its code is never loaded and no channel is registered', async () => {
    const entry = MAIN_MODULES.find((m) => m.manifest.id === 'quiz')!;
    const load = vi.fn(entry.load);
    await registerMainModules(ipcMain, deps, { modules: [{ manifest: entry.manifest, load }], packaged: false, overrideText: '-quiz' });
    expect(load).not.toHaveBeenCalled();
    expect(ipcMain.handle).not.toHaveBeenCalled();
  });
});
