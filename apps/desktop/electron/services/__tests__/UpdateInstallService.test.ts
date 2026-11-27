/**
 * UpdateInstallService / updaterLoader: the electron-updater interop bug.
 *
 * Regression for 1.0.0-beta.1/beta.2: "Cannot set properties of undefined
 * (setting 'autoDownload')". A real `import('electron-updater')` from the CJS
 * main bundle yields a namespace WITHOUT a named `autoUpdater` (it lives on
 * `default`), so `namespace.autoUpdater` was undefined. The fakes below have the
 * real namespace's shape; the old code (`(await import(..)).autoUpdater`) fails
 * every one of them. The real package, loaded as the built app loads it, is
 * checked by `scripts/check-lazy-imports.mjs`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import type { AppUpdater } from 'electron-updater';

const appState = vi.hoisted(() => ({ packaged: true, version: '1.0.0-beta.2' }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.packaged;
    },
    getVersion: () => appState.version,
  },
}));
vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../ipc/networkHandlers', () => ({ isNetworkAllowed: () => true }));

import { UpdateInstallService } from '../UpdateInstallService';
import { pickAutoUpdater, pickExport } from '../updaterLoader';

function fakeUpdater() {
  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    logger: null as unknown,
    forceDevUpdateConfig: false,
    updateConfigPath: '' as string,
    on: vi.fn(),
    off: vi.fn(),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      updateInfo: { version: '1.0.0-beta.3' },
      cancellationToken: {},
    })),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  };
}

/** The namespace Node builds for `import('electron-updater')` from CJS: no named autoUpdater. */
function esmNamespaceOverCjs(updater: unknown) {
  return { AppUpdater: class {}, NsisUpdater: class {}, default: { autoUpdater: updater } };
}

beforeEach(() => {
  appState.packaged = true;
  delete process.env.APPIMAGE;
  process.env.APPIMAGE = '/tmp/x.AppImage';
  delete process.env.BIBLE_E2E_UPDATE_FEED_URL;
});

describe('pickAutoUpdater', () => {
  it('finds autoUpdater on default when the namespace has no named export (the beta.2 bug)', () => {
    const updater = fakeUpdater();
    const ns = esmNamespaceOverCjs(updater);
    expect((ns as Record<string, unknown>).autoUpdater).toBeUndefined(); // what broke the old code
    expect(pickAutoUpdater(ns)).toBe(updater);
  });

  it('finds a named autoUpdater too (CommonJS require)', () => {
    const updater = fakeUpdater();
    expect(pickAutoUpdater({ autoUpdater: updater })).toBe(updater);
  });

  it('throws a clear error rather than returning undefined', () => {
    expect(() => pickAutoUpdater({ default: {} })).toThrow(/no autoUpdater/);
    expect(() => pickAutoUpdater(undefined)).toThrow(/no autoUpdater/);
  });

  it('pickExport reads direct, then default', () => {
    expect(pickExport({ a: 1 }, 'a')).toBe(1);
    expect(pickExport({ default: { a: 2 } }, 'a')).toBe(2);
    expect(pickExport({ default: 'str' }, 'a')).toBeUndefined();
  });
});

describe('UpdateInstallService with a namespace-shaped module', () => {
  it('configures and downloads without "setting autoDownload" errors', async () => {
    const updater = fakeUpdater();
    const ns = esmNamespaceOverCjs(updater);
    const service = new UpdateInstallService(() => pickAutoUpdater(ns));

    const outcome = await service.download();

    expect(outcome).toEqual({ status: 'downloaded', version: '1.0.0-beta.3' });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('documents the old bug: reading namespace.autoUpdater breaks configure()', async () => {
    const ns = esmNamespaceOverCjs(fakeUpdater()) as { autoUpdater?: AppUpdater };
    const oldLoader = () => ns.autoUpdater as AppUpdater; // beta.1/beta.2 behaviour
    const outcome = await new UpdateInstallService(oldLoader).download();
    expect(outcome).toEqual({
      status: 'error',
      message: expect.stringContaining("Cannot set properties of undefined (setting 'autoDownload')"),
    });
  });

  it('reports a load failure as an error outcome instead of throwing', async () => {
    const service = new UpdateInstallService(() => pickAutoUpdater({ default: {} }));
    const outcome = await service.download();
    expect(outcome.status).toBe('error');
  });

  it('install() quits through the loaded updater', async () => {
    const updater = fakeUpdater();
    const service = new UpdateInstallService(() => updater as unknown as AppUpdater);
    await service.download();
    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('points electron-updater at the test feed only in an unpackaged build', async () => {
    process.env.BIBLE_E2E_UPDATE_FEED_URL = 'http://127.0.0.1:1234';
    appState.packaged = false;
    const dev = fakeUpdater();
    expect((await new UpdateInstallService(() => dev as unknown as AppUpdater).download()).status).toBe('downloaded');
    expect(dev.forceDevUpdateConfig).toBe(true);
    expect(fs.readFileSync(dev.updateConfigPath, 'utf8')).toContain('url: "http://127.0.0.1:1234"');

    appState.packaged = true; // a shipped app ignores the variable
    const shipped = fakeUpdater();
    await new UpdateInstallService(() => shipped as unknown as AppUpdater).download();
    expect(shipped.forceDevUpdateConfig).toBe(false);
  });
});
