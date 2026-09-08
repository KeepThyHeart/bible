/**
 * `ext-ui://` custom protocol registration.
 *
 * Extension panels load their content from
 * `ext-ui://<extensionId>/<uiEntry>`. This protocol:
 *
 *   1. Gives every extension its own origin (the host string is the
 *      extension ID), so the browser-level same-origin policy already
 *      isolates one extension's iframe from another's.
 *   2. Restricts the served file tree to the extension's install directory,
 *      with a strict `..`-prevention check so a malicious `uiEntry` cannot
 *      escape into the rest of the filesystem.
 *   3. Refuses to serve any extension that is not registered with the host
 *      (so an iframe pointing at `ext-ui://made-up.id/...` is a dead end).
 *
 * The protocol must be registered as "privileged" via
 * `protocol.registerSchemesAsPrivileged` BEFORE `app.whenReady()` so that
 * the renderer treats `ext-ui://` URLs as a real origin (CSP, fetch,
 * cookies, etc.). The actual file handler is wired after the host exists.
 *
 * The CSP for the iframe lives at the iframe boundary (`sandbox` attribute
 * on the `<iframe>` in `ExtensionPanelHost.tsx`); this file is purely about
 * URL -> file resolution.
 */

import { protocol, type Session } from 'electron';
import { existsSync, realpathSync, statSync } from 'fs';
import { join, normalize, sep } from 'path';
import log from 'electron-log';

import type { ExtensionHost } from './ExtensionHost';

export const EXT_UI_SCHEME = 'ext-ui';

/**
 * Call ONCE before `app.whenReady()`. Marks the scheme as standard +
 * secure + supportsFetchAPI so the renderer treats it like https://.
 */
export function registerExtUiSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: EXT_UI_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Content-Security-Policy served with every extension panel document.
 *
 * `connect-src` deliberately lists **no remote host**, and the policy takes
 * no per-extension input at all - it is a constant, which is the
 * point.
 *
 * Deriving `connect-src` from the extension's `network.allowedHosts` would let
 * panel UI code call `fetch()` straight out to those hosts. Matching the
 * allowlist sounds equivalent to the host-side gateway, but it isn't close:
 * the direct path skips the per-extension request throttle, the bandwidth cap,
 * private-IP rejection, redirect re-validation, and - most importantly - the
 * master offline switch, so turning the app offline would leave iframe egress
 * running. It would also emit an `http://` origin alongside every `https://`
 * one, inviting plaintext.
 *
 * Panel code reaches the network through the `network.fetch` bridge op
 * (`extensions:uiFetch` -> `ExtensionHost.uiFetch` -> the extension's own
 * `NetworkApiImpl`) instead. `'self'` still lets the iframe load its own
 * bundled assets.
 *
 * Exported so the invariant is directly testable.
 */
export function buildExtensionPanelCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Wire the file handler for `ext-ui://`. Call after `app.whenReady()` and
 * after the `ExtensionHost` has been constructed (so we can resolve
 * `<extensionId>` to its install path).
 *
 * Pass an explicit `Session` (e.g. `session.defaultSession`) to register
 * the handler on a specific session. Omit the argument to register on the
 * global protocol - fine for single-window apps.
 */
export function registerExtUiProtocol(host: ExtensionHost, targetSession?: Session): void {
  const handler = async (
    request: Request,
  ): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (url.protocol !== `${EXT_UI_SCHEME}:`) {
      return new Response('Bad request', { status: 400 });
    }
    const extensionId = url.hostname;
    if (!extensionId) {
      return new Response('Missing extension id', { status: 400 });
    }

    // Path is relative to the extension's install directory. URL.pathname
    // begins with '/', so strip it before joining. We don't decodeURI here
    // because Electron's `Request` already normalizes the URL.
    const relPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (relPath.length === 0) {
      return new Response('Missing path', { status: 400 });
    }

    // Refuse anything that contains `..` segments after normalization. We
    // join + normalize + check the result still starts with the install
    // directory; this is the canonical safe-path-resolve pattern.
    const state = await host.getExtension(extensionId);
    if (!state) {
      return new Response('Extension not installed', { status: 404 });
    }
    const installPath = normalize(state.installPath);
    const resolved = normalize(join(installPath, relPath));
    if (!resolved.startsWith(installPath + sep) && resolved !== installPath) {
      log.warn(
        `[ext-ui] path-escape rejected: ${request.url} → ${resolved} (install=${installPath})`,
      );
      return new Response('Forbidden', { status: 403 });
    }
    if (!existsSync(resolved)) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const st = statSync(resolved);
      if (!st.isFile()) {
        return new Response('Not a file', { status: 404 });
      }
    } catch {
      return new Response('Not found', { status: 404 });
    }

    // Defense-in-depth: resolve symlinks and re-check the boundary. The
    // normalize+startsWith check above catches `..` segments, but a
    // symlink inside the install directory could still point outside it.
    try {
      const realResolved = realpathSync(resolved);
      const realInstall = realpathSync(installPath);
      if (!realResolved.startsWith(realInstall + sep) && realResolved !== realInstall) {
        log.warn(
          `[ext-ui] symlink-escape rejected: ${request.url} → real=${realResolved} (install=${realInstall})`,
        );
        return new Response('Forbidden', { status: 403 });
      }
    } catch {
      return new Response('Forbidden', { status: 403 });
    }

    // We use `net.fetch` against a `file://` URL to take advantage of
    // Electron's built-in static file streaming, content-type detection,
    // and ranges support. Direct fs.createReadStream would also work but
    // would require us to maintain our own MIME map.
    const { net } = await import('electron');
    const fileUrl = pathToFileUrl(resolved);
    const upstream = await net.fetch(fileUrl);

    const headers = new Headers(upstream.headers);
    headers.set('Content-Security-Policy', buildExtensionPanelCsp());

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  };

  const target = targetSession ?? undefined;
  if (target) {
    target.protocol.handle(EXT_UI_SCHEME, handler);
  } else {
    protocol.handle(EXT_UI_SCHEME, handler);
  }
  log.info(`[ext-ui] protocol handler registered for scheme '${EXT_UI_SCHEME}'`);
}

function pathToFileUrl(p: string): string {
  // Minimal cross-platform file:// URL builder. We avoid `url.pathToFileURL`
  // here so this module is unit-testable without importing electron's
  // node:url stub.
  const normalized = p.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return `file://${normalized}`;
  return `file:///${normalized}`;
}
