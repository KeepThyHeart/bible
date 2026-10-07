import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateBuiltinManifest, type FeatureModuleManifest } from '@bible/core/browser';
import type { FeatureMainModule, MainModuleDeps } from './FeatureMainModule';
import { registerMainModules, closeMainModules, type MainModuleEntry } from './mainModules';
import { IpcKnownError } from '../ipc/result';

function fakeIpcMain() {
  const handlers = new Map<string, (e: unknown, ...a: any[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((c: string, fn: (e: unknown, ...a: any[]) => unknown) => {
      if (handlers.has(c)) throw new Error('dup ' + c);
      handlers.set(c, fn);
    }),
    removeHandler: vi.fn((c: string) => void handlers.delete(c)),
  };
}

const sent: Array<[string, unknown[]]> = [];
const deps: MainModuleDeps = {
  userDataPath: '/tmp/x',
  getWindows: () => [{ isDestroyed: () => false, webContents: { send: (c: string, ...a: unknown[]) => void sent.push([c, a]) } }],
  log: { info() {}, warn() {}, error() {} },
};

const manifest: FeatureModuleManifest = {
  id: 'fixture',
  activationEvents: ['onStartupFinished'],
  contributes: {},
};

const close = vi.fn();
const fixture: FeatureMainModule = {
  id: 'fixture',
  registerIpc(ipc) {
    ipc.handle('add', (a: number, b: number) => a + b);
    ipc.handle('boom', () => {
      throw new IpcKnownError('not_found', 'nope');
    });
    ipc.send('ready', 1);
  },
  close,
};

function entry(load = vi.fn(async () => ({ default: fixture }))): MainModuleEntry & { load: typeof load } {
  return { manifest, load };
}

beforeEach(async () => {
  await closeMainModules();
  close.mockClear();
  sent.length = 0;
});

describe('main feature modules', () => {
  it('manifest validates', () => {
    expect(validateBuiltinManifest(manifest)).toEqual([]);
  });

  it('registers namespaced handlers and replies with Result envelopes', async () => {
    const ipc = fakeIpcMain();
    await registerMainModules(ipc, deps, { modules: [entry()], packaged: false, overrideText: '' });
    expect([...ipc.handlers.keys()].sort()).toEqual(['module:fixture:add', 'module:fixture:boom']);
    expect(await ipc.handlers.get('module:fixture:add')!({}, 2, 3)).toEqual({ ok: true, value: 5 });
    expect(await ipc.handlers.get('module:fixture:boom')!({})).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'nope' },
    });
    expect(sent).toEqual([['module:fixture:event:ready', [1]]]);
  });

  it('never loads a disabled module', async () => {
    const ipc = fakeIpcMain();
    const e = entry();
    await registerMainModules(ipc, deps, { modules: [e], packaged: false, overrideText: '-fixture' });
    expect(e.load).not.toHaveBeenCalled();
    expect(ipc.handle).not.toHaveBeenCalled();
  });

  it('ignores KTH_MODULES in packaged builds', async () => {
    const ipc = fakeIpcMain();
    const e = entry();
    await registerMainModules(ipc, deps, { modules: [e], packaged: true, overrideText: '-fixture' });
    expect(e.load).toHaveBeenCalledTimes(1);
  });

  it('close removes channels and calls close()', async () => {
    const ipc = fakeIpcMain();
    await registerMainModules(ipc, deps, { modules: [entry()], packaged: false, overrideText: '' });
    await closeMainModules();
    expect(ipc.handlers.size).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('duplicate handler registration throws', async () => {
    const ipc = fakeIpcMain();
    const dup: FeatureMainModule = {
      id: 'fixture',
      registerIpc(i) {
        i.handle('a', () => 1);
        i.handle('a', () => 2);
      },
    };
    const warn = vi.fn();
    await registerMainModules(ipc, { ...deps, log: { ...deps.log, warn } }, {
      modules: [entry(vi.fn(async () => ({ default: dup })))],
      packaged: false,
      overrideText: '',
    });
    expect(warn).toHaveBeenCalled();
    expect(ipc.handlers.size).toBe(0);
  });
});
