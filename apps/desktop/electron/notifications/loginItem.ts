/**
 * Start at login, per OS.
 *
 * Windows and macOS use Electron's login-item API; the app is launched with
 * `--hidden` so it starts in the tray with no window (main.ts honours the flag
 * only when the tray is on). Linux has no such API: an XDG autostart
 * `.desktop` file is written to (or removed from) `$XDG_CONFIG_HOME/autostart`
 * (default `~/.config/autostart`).
 */
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import log from 'electron-log';

export const HIDDEN_ARG = '--hidden';

export function linuxAutostartDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const base = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  return path.join(base, 'autostart');
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bible-app';
}

export function linuxDesktopFilePath(appName: string, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return path.join(linuxAutostartDir(env, home), `${slug(appName)}.desktop`);
}

/** The executable to autostart: the AppImage file itself when running from one. */
export function linuxExecPath(env: NodeJS.ProcessEnv = process.env, execPath = process.execPath): string {
  return env.APPIMAGE || execPath;
}

function quoteExec(p: string): string {
  // Desktop Entry spec: quote and escape ", `, $ and \ inside a quoted argument.
  return `"${p.replace(/(["`$\\])/g, '\\$1')}"`;
}

export function buildDesktopEntry(appName: string, execPath: string, comment: string): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${clean(appName)}`,
    `Comment=${clean(comment)}`,
    `Exec=${quoteExec(execPath)} ${HIDDEN_ARG}`,
    'X-GNOME-Autostart-enabled=true',
    'Terminal=false',
    '',
  ].join('\n');
}

/** Can this OS start the app at login, and can we write what that needs? */
export function isLoginItemSupported(platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32' || platform === 'darwin') return true;
  if (platform !== 'linux') return false;
  const dir = linuxAutostartDir();
  try {
    fs.accessSync(fs.existsSync(dir) ? dir : path.dirname(dir), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function getLoginItem(platform: NodeJS.Platform = process.platform, appName = app.getName()): boolean {
  try {
    if (platform === 'linux') return fs.existsSync(linuxDesktopFilePath(appName));
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

/** Turn start-at-login on or off. Returns whether it is now on. Never throws. */
export function setLoginItem(
  enabled: boolean,
  opts: { platform?: NodeJS.Platform; appName?: string; comment?: string } = {},
): boolean {
  const platform = opts.platform ?? process.platform;
  const appName = opts.appName ?? app.getName();
  try {
    if (platform === 'win32' || platform === 'darwin') {
      if (!app.isPackaged) log.info('[notifications] setting the login item in an unpackaged build');
      // `openAsHidden` (macOS) is deprecated and missing from newer typings; `--hidden` is what we honour.
      app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG], openAsHidden: true } as Electron.Settings);
      return enabled;
    }
    if (platform === 'linux') {
      const file = linuxDesktopFilePath(appName);
      if (enabled) {
        if (!app.isPackaged) log.info('[notifications] writing an autostart entry for an unpackaged build');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buildDesktopEntry(appName, linuxExecPath(), opts.comment ?? appName), 'utf8');
      } else {
        fs.rmSync(file, { force: true });
      }
      return enabled;
    }
  } catch (err) {
    log.warn('[notifications] could not change the login item:', err);
  }
  return false;
}
