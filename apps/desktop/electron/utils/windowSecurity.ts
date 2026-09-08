/**
 * Navigation / window-open hardening applied to every `BrowserWindow` the app
 * creates.
 *
 * Without these guards a renderer that ends up executing attacker-controlled
 * markup - a sanitizer miss in note, commentary or dictionary HTML - can
 * navigate the window away to a remote page, or call `window.open()` to spawn a
 * child window that inherits our preload bridge. Both are game over, because
 * the preload exposes the whole IPC surface.
 *
 * The policy is:
 *   - `will-navigate`  -> allow only the app's own origin, block everything
 *                        else. `https:`/`mailto:` targets are handed to the
 *                        user's browser/mail client instead so ordinary links
 *                        in study content still do something useful.
 *   - `setWindowOpenHandler` -> always `{ action: 'deny' }`, with the same
 *                        external hand-off.
 *
 * "The app's own origin" is the Vite dev server in development
 * (`ELECTRON_RENDERER_URL`) and the built renderer directory in production.
 * Note that `will-navigate` fires for main-frame navigations only, so extension
 * panel iframes served over `ext-ui://` are unaffected.
 *
 * Main-process-initiated loads (`loadURL`, `loadFile(..., { query })`) never
 * raise `will-navigate`, so the guards cannot break window startup.
 */

import { shell, type WebContents } from 'electron';
import log from 'electron-log';
import { isAbsolute, join, relative } from 'path';
import { fileURLToPath } from 'url';

import { validateExternalUrl } from './validation';
import { isNetworkAllowed } from '../ipc/networkHandlers';

/** The locations that count as "inside the application". */
export interface AppNavigationOrigins {
  /** Vite dev-server base URL (`ELECTRON_RENDERER_URL`); unset when packaged. */
  readonly devServerUrl: string | undefined;
  /** Directory holding the built renderer HTML/JS bundles. */
  readonly rendererDir: string;
}

/**
 * Resolve the app's own origins for the current process. `__dirname` is the
 * bundled main-process output directory (`out/main`), the same base the window
 * creation code uses to locate `../renderer/index.html`.
 */
export function resolveAppNavigationOrigins(): AppNavigationOrigins {
  return {
    devServerUrl: process.env.ELECTRON_RENDERER_URL,
    rendererDir: join(__dirname, '../renderer'),
  };
}

/**
 * True when `target` points back at the application itself. Everything that
 * fails to parse, or that resolves outside the renderer directory / dev-server
 * origin, is treated as external.
 */
export function isInternalNavigation(target: string, origins: AppNavigationOrigins): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }

  if (url.protocol === 'file:') {
    // `file:` URLs have no meaningful origin, so compare resolved paths and
    // require the result to sit inside the renderer directory. `path.relative`
    // is case-insensitive on Windows, which is what we want here.
    let filePath: string;
    try {
      filePath = fileURLToPath(url);
    } catch {
      return false;
    }
    const rel = relative(origins.rendererDir, filePath);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  }

  if (origins.devServerUrl !== undefined && origins.devServerUrl !== '') {
    try {
      if (new URL(origins.devServerUrl).origin === url.origin) {
        return true;
      }
    } catch {
      // Malformed ELECTRON_RENDERER_URL - fall through and deny.
    }
  }

  return false;
}

/**
 * Open a URL in the user's browser/mail client after validating its scheme.
 *
 * Every path that can reach `shell.openExternal` funnels through here so the
 * allowlist in `validation.ts#ALLOWED_EXTERNAL_URL_SCHEMES` is enforced once,
 * and so rejections are logged with the call site that produced them.
 */
export async function openExternalUrl(
  rawUrl: unknown,
  source: string
): Promise<{ success: boolean; error?: string }> {
  let target: string;
  try {
    target = validateExternalUrl(rawUrl);
  } catch (error) {
    const message = (error as Error).message;
    log.warn(`[security] refused to open external URL from ${source}: ${message}`);
    return { success: false, error: message };
  }

  // Opening a link is egress. The browser that receives it makes a request the
  // app did not make itself, but the disclosure is identical: the destination
  // server learns the user's IP address, and the referring context tells it
  // which app sent them. So the master switch gates this too - a `mailto:` is
  // the one shape that discloses nothing on its own and stays allowed.
  if (!target.startsWith('mailto:') && !isNetworkAllowed()) {
    log.warn(`[security] refused to open external URL from ${source}: web requests are off`);
    return {
      success: false,
      error:
        'Web requests are turned off. Enable "Allow web requests" in Preferences to open links.',
    };
  }

  try {
    await shell.openExternal(target);
    return { success: true };
  } catch (error) {
    log.error(`[security] shell.openExternal failed for ${source}:`, error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Install the navigation guards on a window that hosts app UI (the main window
 * and every detached pane window).
 *
 * @param contents Window's `webContents`.
 * @param label    Short identifier used in the security log lines.
 */
export function applyWindowSecurity(contents: WebContents, label: string): void {
  const origins = resolveAppNavigationOrigins();

  contents.on('will-navigate', (event, targetUrl) => {
    if (isInternalNavigation(targetUrl, origins)) return;

    event.preventDefault();
    log.warn(`[security] blocked navigation from ${label} to: ${targetUrl}`);
    void openExternalUrl(targetUrl, `${label} will-navigate`);
  });

  contents.setWindowOpenHandler(({ url }) => {
    log.info(`[security] denied window.open from ${label}: ${url}`);
    void openExternalUrl(url, `${label} window.open`);
    return { action: 'deny' };
  });
}

/**
 * Stricter variant for windows that must never navigate anywhere and must
 * never hand a URL to the OS - currently the hidden print window, which only
 * ever renders one locally-written temp file.
 */
export function lockDownNavigation(contents: WebContents, label: string): void {
  contents.on('will-navigate', (event, targetUrl) => {
    event.preventDefault();
    log.warn(`[security] blocked navigation from ${label} to: ${targetUrl}`);
  });

  contents.setWindowOpenHandler(({ url }) => {
    log.warn(`[security] denied window.open from ${label}: ${url}`);
    return { action: 'deny' };
  });
}
