/**
 * Tests for the window navigation guards. `electron` is mocked so we can
 * observe `shell.openExternal` without launching a browser, and the guards are
 * exercised against a stand-in `webContents` EventEmitter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { WebContents } from 'electron';

// `vi.hoisted` so the mock function exists before the hoisted `vi.mock`
// factories (and the module-under-test import) run.
const { openExternalMock, networkState } = vi.hoisted(() => ({
  openExternalMock: vi.fn(async (_url: string) => {}),
  // Opening a link is egress, so `openExternalUrl` consults the master "Allow
  // web requests" switch. Default the mock to ON: these tests are about the
  // navigation guards, and the gate has its own cases below.
  networkState: { allowed: true },
}));

vi.mock('electron', () => ({
  shell: { openExternal: openExternalMock },
}));

vi.mock('../ipc/networkHandlers', () => ({
  isNetworkAllowed: () => networkState.allowed,
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  applyWindowSecurity,
  isInternalNavigation,
  lockDownNavigation,
  openExternalUrl,
  type AppNavigationOrigins,
} from './windowSecurity';

/** Stand-in for `BrowserWindow.webContents`. */
class FakeWebContents extends EventEmitter {
  public windowOpenHandler: ((details: { url: string }) => { action: string }) | undefined;

  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
    this.windowOpenHandler = handler;
  }

  /** Fire a renderer-initiated navigation; returns whether it was blocked. */
  navigate(url: string): boolean {
    let prevented = false;
    this.emit('will-navigate', { preventDefault: () => (prevented = true) }, url);
    return prevented;
  }
}

function makeContents(): { fake: FakeWebContents; contents: WebContents } {
  const fake = new FakeWebContents();
  return { fake, contents: fake as unknown as WebContents };
}

const DEV_ORIGINS: AppNavigationOrigins = {
  devServerUrl: 'http://localhost:5173',
  rendererDir: process.platform === 'win32' ? 'C:\\app\\out\\renderer' : '/app/out/renderer',
};

const PROD_ORIGINS: AppNavigationOrigins = {
  devServerUrl: undefined,
  rendererDir: DEV_ORIGINS.rendererDir,
};

const RENDERER_FILE_URL =
  process.platform === 'win32'
    ? 'file:///C:/app/out/renderer/index.html'
    : 'file:///app/out/renderer/index.html';

const OUTSIDE_FILE_URL =
  process.platform === 'win32'
    ? 'file:///C:/Windows/System32/calc.exe'
    : 'file:///etc/passwd';

describe('isInternalNavigation', () => {
  it('allows the built renderer files in a packaged build', () => {
    expect(isInternalNavigation(RENDERER_FILE_URL, PROD_ORIGINS)).toBe(true);
    expect(
      isInternalNavigation(`${RENDERER_FILE_URL.replace('index', 'detached')}?type=bible`, PROD_ORIGINS)
    ).toBe(true);
  });

  it('rejects file URLs outside the renderer directory', () => {
    expect(isInternalNavigation(OUTSIDE_FILE_URL, PROD_ORIGINS)).toBe(false);
  });

  it('allows the dev server origin only while it is configured', () => {
    expect(isInternalNavigation('http://localhost:5173/index.html', DEV_ORIGINS)).toBe(true);
    expect(isInternalNavigation('http://localhost:5173/index.html', PROD_ORIGINS)).toBe(false);
  });

  it('rejects a different origin on the same dev-server host', () => {
    expect(isInternalNavigation('http://localhost:9999/', DEV_ORIGINS)).toBe(false);
    expect(isInternalNavigation('https://localhost:5173/', DEV_ORIGINS)).toBe(false);
  });

  it('rejects remote pages and unparseable targets', () => {
    expect(isInternalNavigation('https://evil.example/', DEV_ORIGINS)).toBe(false);
    expect(isInternalNavigation('about:blank', DEV_ORIGINS)).toBe(false);
    expect(isInternalNavigation('not a url', DEV_ORIGINS)).toBe(false);
  });
});

describe('openExternalUrl', () => {
  beforeEach(() => {
    openExternalMock.mockClear();
    networkState.allowed = true;
  });

  it('opens an allowed scheme', async () => {
    await expect(openExternalUrl('https://example.org/docs', 'test')).resolves.toEqual({
      success: true,
    });
    expect(openExternalMock).toHaveBeenCalledWith('https://example.org/docs');
  });

  it('never reaches the shell for a disallowed scheme', async () => {
    const result = await openExternalUrl('file:///C:/Windows/System32/calc.exe', 'test');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/is not allowed/);
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('refuses to open a link while web requests are off', async () => {
    // Handing a URL to the browser discloses the user's IP to that server just
    // as a fetch does, so the master switch governs links too.
    networkState.allowed = false;

    const result = await openExternalUrl('https://example.org/docs', 'test');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Allow web requests/i);
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('still allows mailto: while web requests are off', async () => {
    // A mailto: hands a draft to a local mail client and contacts nothing on
    // its own, so gating it would cost the user something for no privacy gain.
    networkState.allowed = false;

    await expect(openExternalUrl('mailto:someone@example.org', 'test')).resolves.toEqual({
      success: true,
    });
    expect(openExternalMock).toHaveBeenCalledWith('mailto:someone@example.org');
  });
});

describe('applyWindowSecurity', () => {
  beforeEach(() => {
    openExternalMock.mockClear();
    networkState.allowed = true;
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
  });

  it('blocks navigation to a remote page and hands it to the browser instead', async () => {
    const { fake, contents } = makeContents();
    applyWindowSecurity(contents, 'test window');

    expect(fake.navigate('https://evil.example/steal')).toBe(true);
    await Promise.resolve();
    expect(openExternalMock).toHaveBeenCalledWith('https://evil.example/steal');
  });

  it('blocks navigation to a local file and does not hand it to the shell', async () => {
    const { fake, contents } = makeContents();
    applyWindowSecurity(contents, 'test window');

    expect(fake.navigate(OUTSIDE_FILE_URL)).toBe(true);
    await Promise.resolve();
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('allows navigation within the dev-server origin', () => {
    const { fake, contents } = makeContents();
    applyWindowSecurity(contents, 'test window');

    expect(fake.navigate('http://localhost:5173/detached.html?type=bible')).toBe(false);
  });

  it('denies every window.open and routes allowed schemes externally', async () => {
    const { fake, contents } = makeContents();
    applyWindowSecurity(contents, 'test window');

    expect(fake.windowOpenHandler?.({ url: 'https://example.org/' })).toEqual({ action: 'deny' });
    expect(fake.windowOpenHandler?.({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    await Promise.resolve();
    expect(openExternalMock).toHaveBeenCalledTimes(1);
    expect(openExternalMock).toHaveBeenCalledWith('https://example.org/');
  });
});

describe('lockDownNavigation', () => {
  beforeEach(() => {
    openExternalMock.mockClear();
  });

  it('blocks everything, including otherwise-allowed schemes', async () => {
    const { fake, contents } = makeContents();
    lockDownNavigation(contents, 'print window');

    expect(fake.navigate('https://example.org/')).toBe(true);
    expect(fake.windowOpenHandler?.({ url: 'https://example.org/' })).toEqual({ action: 'deny' });
    await Promise.resolve();
    expect(openExternalMock).not.toHaveBeenCalled();
  });
});
