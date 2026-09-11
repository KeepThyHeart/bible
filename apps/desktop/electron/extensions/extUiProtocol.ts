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
 *   4. Reserves ONE hostname, `host`, for the app itself: `ext-ui://host/`
 *      serves host-owned resources that every panel may read, currently just
 *      `theme.css`. See `EXT_UI_HOST_HOSTNAME` below.
 *
 * The protocol must be registered as "privileged" via
 * `protocol.registerSchemesAsPrivileged` BEFORE `app.whenReady()` so that
 * the renderer treats `ext-ui://` URLs as a real origin (CSP, fetch,
 * cookies, etc.). The actual file handler is wired after the host exists.
 *
 * The CSP for the iframe lives at the iframe boundary (`sandbox` attribute
 * on the `<iframe>` in `ExtensionPanelHost.tsx`); this file is otherwise about
 * URL -> response resolution. It was "URL -> FILE resolution" until the
 * reserved `host` origin arrived: that one hostname answers from memory rather
 * than from disk, which is exactly why it is handled in its own branch before
 * any path arithmetic happens.
 */

import { protocol, type Session } from 'electron';
import { existsSync, realpathSync, statSync } from 'fs';
import { join, normalize, sep } from 'path';
import log from 'electron-log';

import type { ExtensionHost } from './ExtensionHost';
import { getActiveHostThemeCss } from './hostThemeCss';

export const EXT_UI_SCHEME = 'ext-ui';

/**
 * The one `ext-ui://` hostname that is NOT an extension id.
 *
 * `ext-ui://host/...` serves resources the app itself owns and every panel is
 * allowed to read. It is matched BEFORE the registry lookup, which is what
 * makes it un-shadowable: even if an extension called `host` somehow existed,
 * the reserved branch answers first and the extension is simply unreachable
 * over `ext-ui://`. Failing closed like that is the point - the alternative
 * ordering would let a hostile extension serve its own `theme.css` to every
 * other extension's panel.
 *
 * As it happens no such extension can exist. `ExtensionManifestValidator`'s
 * `ID_PATTERN` is
 *   `/^ext\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/`
 * so every valid id begins with the literal `ext.` and carries at least two
 * dots; the bare string `host` cannot match it, and neither can anything else
 * that is not itself dotted. `ExtUiProtocolHost.test.ts` pins that, because the
 * safety of this reservation rests on it staying true - if the id grammar is
 * ever loosened, that test fails and points here.
 */
export const EXT_UI_HOST_HOSTNAME = 'host';

/**
 * The complete set of paths served under `ext-ui://host/`, as an allowlist.
 *
 * An allowlist rather than a directory walk, because there is no directory:
 * these responses are synthesized, not read off disk. That also means the
 * `..`-escape and symlink-escape machinery the extension branch needs has
 * nothing to escape from here - a path either is one of these exact strings or
 * it is a 404, so `ext-ui://host/../../etc/passwd`, `%2e%2e%2ftheme.css` and
 * `subdir/theme.css` all fall out the same way without any path arithmetic.
 */
const HOST_RESOURCES = new Set<string>(['theme.css']);

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
 * ## `ext-ui://host` in `style-src` and `script-src`
 *
 * `style-src` and `script-src` name one origin beyond `'self'`:
 * `ext-ui://host`, the reserved host origin (`EXT_UI_HOST_HOSTNAME`). This is a
 * deliberate, reviewed loosening of a policy that was tightened on purpose, and
 * the reasoning is written down in `ExtUiCsp.test.ts` next to the assertions
 * that pin it - read that before touching either directive.
 *
 * In short: `ext-ui://host` is not a remote origin and not an extension. It is
 * served by `registerExtUiProtocol` in this same process from content this
 * process synthesizes; nothing an extension controls can reach it, and it can
 * carry no third-party code. Without it a panel cannot `<link>` the host token
 * sheet, which is the entire point of serving one. `connect-src` is NOT
 * widened - the egress lockdown above is untouched, and `fetch()` of the token
 * sheet is neither needed nor allowed.
 *
 * Exported so the invariant is directly testable.
 */
export function buildExtensionPanelCsp(): string {
  return [
    "default-src 'none'",
    `script-src 'self' ${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME}`,
    `style-src 'self' ${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME} 'unsafe-inline'`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'none'",
    frameAncestorsDirective(),
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Only the app's own renderer may frame a panel. The previous value, `'none'`,
 * refused the host as well, so Chromium blocked every panel iframe and no
 * extension panel could render at all.
 *
 * A built app loads its renderer from `file:`; under `electron-vite dev` it is
 * the dev server, the same `ELECTRON_RENDERER_URL` that `main.ts` loads.
 */
function frameAncestorsDirective(): string {
  const sources = ['file:'];
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    try {
      sources.push(new URL(devUrl).origin);
    } catch {
      // Malformed dev URL: stay file:-only rather than widen the policy.
    }
  }
  return `frame-ancestors ${sources.join(' ')}`;
}

/**
 * Serve one resource from the reserved `ext-ui://host/` origin.
 *
 * Synthesized in-process: no filesystem, no extension input, no per-request
 * branching beyond the allowlist. `relPath` has already had its leading slashes
 * stripped and been percent-decoded by the caller, so an attempt to dress a
 * traversal up as `%2e%2e%2ftheme.css` arrives here as `../theme.css` and misses
 * the allowlist like any other unknown name.
 *
 * Headers match what the extension branch sends, for the same reasons:
 *
 *   - the panel CSP, so a host-served document is governed by exactly the
 *     policy an extension-served one is;
 *   - `nosniff`, so the declared `text/css` is the only interpretation the
 *     renderer will entertain (a stylesheet that a sniffer decided was
 *     something else is a bug waiting to happen, and CSP is enforced per
 *     resource TYPE, so the type must not be negotiable);
 *   - `no-store`. This is the one place the two branches differ, and
 *     deliberately: an extension's files are immutable on disk for the life of
 *     an install and Electron's file responses carry their own validators,
 *     whereas THIS url's body changes under the user's feet every time they
 *     switch theme. A cached copy would pin an already-open panel to the old
 *     palette until it was reloaded, which is precisely the staleness this
 *     workstream exists to remove.
 */
function serveHostResource(relPath: string): Response {
  if (!HOST_RESOURCES.has(relPath)) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(getActiveHostThemeCss(), {
    status: 200,
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Content-Security-Policy': buildExtensionPanelCsp(),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Build the `ext-ui://` request handler.
 *
 * Split out of `registerExtUiProtocol` so the URL -> response decisions
 * (reserved hostname, unknown extension, path escape) are exercisable in unit
 * tests without an Electron session to register against. `registerExtUiProtocol`
 * is then a two-line wiring function, which is all it should have been.
 */
export function createExtUiHandler(
  host: ExtensionHost,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
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

    // The reserved hostname is matched BEFORE `host.getExtension`, so no
    // registry entry can ever shadow it. See `EXT_UI_HOST_HOSTNAME` for why an
    // extension with this id cannot exist in the first place.
    //
    // Compared case-insensitively. Chromium lowercases the host of a
    // `standard:` scheme (which `ext-ui` is - see
    // `registerExtUiSchemePrivileged`), so at runtime `extensionId` is already
    // lowercase and this fold is a no-op. It is not a no-op everywhere else:
    // WHATWG `URL` treats an unregistered scheme as non-special and keeps the
    // host verbatim, so `ext-ui://HOST/theme.css` arrives with `HOST` in Node,
    // in the tests, and in any tool that parses these URLs outside Chromium.
    // Folding here means the reservation holds in all of them rather than
    // depending on which parser saw the URL first.
    if (extensionId.toLowerCase() === EXT_UI_HOST_HOSTNAME) {
      return serveHostResource(relPath);
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
    // Electron's file protocol guesses the content type from the extension.
    // `nosniff` stops the renderer second-guessing that guess, which matters
    // more now than it did: CSP is enforced per resource TYPE, so a panel
    // asset that the sniffer promoted from `text/plain` to a script would be
    // judged against `script-src` rather than being inert. The caching
    // validators Electron supplies are left as they are - an extension's files
    // do not change for the life of an install.
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  };
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
  const handler = createExtUiHandler(host);

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
