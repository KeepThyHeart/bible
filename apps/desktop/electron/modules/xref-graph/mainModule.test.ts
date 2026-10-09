// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
// The module's data sources need Electron; this test only checks which channels it registers.
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/fake/userData'), isPackaged: false } }));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/sharedMainDb', () => ({ getSharedModuleMetadataRepo: () => ({ getByType: () => [] }) }));
vi.mock('../../ipc/crossReferenceHandlers', () => ({ ensureXrefRepository: async () => null }));
vi.mock('../../ipc/studyHandlers', () => ({ getUserXrefRepoForLinks: () => null }));

import { xrefGraphMainManifest } from './manifest';
import { MAIN_MODULES, registerMainModules, closeMainModules } from '../mainModules';
import type { MainModuleDeps } from '../FeatureMainModule';

const deps: MainModuleDeps = { userDataPath: '/tmp/x', getWindows: () => [], log: { info() {}, warn() {}, error() {} } };
const ipcMain = { handle: vi.fn(), removeHandler: vi.fn() };

afterEach(async () => {
  await closeMainModules();
  ipcMain.handle.mockClear();
});

describe('xref-graph main module registration', () => {
  it('has a valid manifest and is in the production table', () => {
    expect(validateBuiltinManifest(xrefGraphMainManifest)).toEqual([]);
    expect(MAIN_MODULES.some((m) => m.manifest.id === 'xref-graph')).toBe(true);
  });

  it('registers the four graph channels under module:xref-graph:*', async () => {
    const entry = MAIN_MODULES.find((m) => m.manifest.id === 'xref-graph')!;
    await registerMainModules(ipcMain, deps, { modules: [entry], packaged: false, overrideText: '', activationTimeoutMs: 120_000 });
    expect(ipcMain.handle.mock.calls.map((c) => c[0]).sort()).toEqual([
      'module:xref-graph:getBookMatrix',
      'module:xref-graph:getChapterArcs',
      'module:xref-graph:getEgoGraph',
      'module:xref-graph:getNeighbours',
    ]);
  }, 120_000);

  it('disabled by KTH_MODULES: its code is never loaded and no channel is registered', async () => {
    const entry = MAIN_MODULES.find((m) => m.manifest.id === 'xref-graph')!;
    const load = vi.fn(entry.load);
    await registerMainModules(ipcMain, deps, { modules: [{ manifest: entry.manifest, load }], packaged: false, overrideText: '-xref-graph' });
    expect(load).not.toHaveBeenCalled();
    expect(ipcMain.handle).not.toHaveBeenCalled();
  });
});
