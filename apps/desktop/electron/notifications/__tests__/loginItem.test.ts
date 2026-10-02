// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const setLoginItemSettings = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({
  app: { isPackaged: true, getName: () => 'Keep Thy Heart', setLoginItemSettings, getLoginItemSettings: () => ({ openAtLogin: true }) },
}));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { setLoginItem, getLoginItem, linuxDesktopFilePath, buildDesktopEntry, isLoginItemSupported } from '../loginItem';

let tmp: string;
const savedEnv = { ...process.env };
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'login-item-'));
  process.env.XDG_CONFIG_HOME = tmp;
  delete process.env.APPIMAGE;
  setLoginItemSettings.mockClear();
});
afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('login item', () => {
  it('writes and removes the XDG autostart file on Linux', () => {
    const file = linuxDesktopFilePath('Keep Thy Heart');
    expect(file).toBe(path.join(tmp, 'autostart', 'keep-thy-heart.desktop'));
    expect(setLoginItem(true, { platform: 'linux', appName: 'Keep Thy Heart' })).toBe(true);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('[Desktop Entry]');
    expect(text).toContain('Name=Keep Thy Heart');
    expect(text).toContain(`Exec="${process.execPath}" --hidden`);
    expect(text).toContain('X-GNOME-Autostart-enabled=true');
    expect(getLoginItem('linux', 'Keep Thy Heart')).toBe(true);
    setLoginItem(false, { platform: 'linux', appName: 'Keep Thy Heart' });
    expect(fs.existsSync(file)).toBe(false);
    expect(getLoginItem('linux', 'Keep Thy Heart')).toBe(false);
  });

  it('uses the AppImage path as the command when present', () => {
    process.env.APPIMAGE = '/home/u/Apps/Bible "Reader".AppImage';
    setLoginItem(true, { platform: 'linux', appName: 'App' });
    const text = fs.readFileSync(linuxDesktopFilePath('App'), 'utf8');
    expect(text).toContain('Exec="/home/u/Apps/Bible \\"Reader\\".AppImage" --hidden');
  });

  it('uses the login-item API: --hidden on Windows, no arguments on macOS', () => {
    setLoginItem(true, { platform: 'win32' });
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true, args: ['--hidden'] });
    setLoginItem(true, { platform: 'darwin' });
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true });
    expect(isLoginItemSupported('win32')).toBe(true);
    expect(isLoginItemSupported('darwin')).toBe(true);
  });

  it('reports Linux support from a writable autostart location', () => {
    const prev = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      expect(isLoginItemSupported()).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: prev });
    }
  });

  it('builds a single-line desktop entry', () => {
    expect(buildDesktopEntry('A\nB', '/x/y', 'c\nd')).toContain('Name=A B');
  });
});
