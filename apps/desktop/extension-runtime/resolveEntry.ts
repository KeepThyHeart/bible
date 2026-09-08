/**
 * Extension entry-point resolution (supervisor side).
 *
 * `manifest.main` is a package-relative path (`"./main.js"`) - the manifest
 * validator rejects absolute paths outright, so an extension author has no way
 * to spell an absolute one. The runtime bundle, however, lives in
 * `out/main/extension-runtime/`, nowhere near the extension, so a relative
 * specifier resolved against *it* pointed at nothing and every on-disk
 * extension failed to load.
 *
 * This module turns `(installPath, manifest.main)` into a validated target the
 * supervisor can read, and enforces the security property that comes with
 * resolving an untrusted, manifest-supplied path against a real directory:
 *
 *   - The resolved path MUST stay inside `installPath`. A `main` of
 *     `../../../../evil.js` resolves cleanly on every OS, so relative-path
 *     validation at manifest-parse time is not sufficient on its own - the
 *     check has to happen on the *resolved* path, at the point of use.
 *   - Absolute paths and URL schemes other than `data:` are rejected. In
 *     particular `file:` (arbitrary absolute location) and `http(s):` (remote
 *     code load) are never opened.
 *
 * The target is read into a QuickJS realm rather than passed to `import()`.
 * That makes this check *more* important, not less: it is the
 * only privileged filesystem operation performed on an extension's behalf, and
 * the realm on the other side has no filesystem of its own to abuse.
 *
 * `data:` URLs are passed through untouched: they are self-contained sources
 * with no base path to resolve against, they cannot reference the filesystem,
 * and they are the form the packaged-build E2E fixture uses.
 *
 * Containment is checked on the lexically-resolved path, not on `realpath`.
 * Resolving symlinks would reject perfectly ordinary installs on macOS (where
 * `/var` and `/tmp` are themselves symlinks) and buys little: a symlink inside
 * the extension package is authored by the same party as `main.js` itself, and
 * its code runs regardless.
 */

import { isAbsolute, resolve, sep } from 'path';

/**
 * Thrown when `manifest.main` cannot be turned into a safe module specifier.
 * The runtime reports it through the error boundary as a `module-load`
 * failure, so the host sees it in `extension.log` like any other load error.
 */
export class ExtensionEntryResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtensionEntryResolutionError';
  }
}

/**
 * A URL scheme prefix - at least two characters before the colon, so a
 * Windows drive letter (`C:\ext\main.js`) is NOT mistaken for a scheme. Drive
 * letters are handled by the absolute-path check instead.
 */
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

/** Windows drive-absolute path, e.g. `C:\foo` or `c:/foo`. */
const WINDOWS_DRIVE_ABSOLUTE = /^[a-zA-Z]:[\\/]/;

/**
 * What `manifest.main` points at, once validated.
 *
 * The resolved *path* is what is needed, rather than a module specifier: the
 * realm supervisor reads the entry file and loads its source into the QuickJS realm
 * instead of handing a specifier to `import()`. The validation is identical
 * either way, so both forms share this one resolver - the containment check
 * that stops `../../../../evil.js` is the whole point and must not fork.
 */
export type ExtensionEntryTarget =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'data'; readonly url: string };

/**
 * Validate `manifest.main` and resolve it against the extension's install
 * directory.
 *
 * @param installPath Absolute path to the extension's install directory.
 * @param main        `manifest.main` exactly as authored.
 * @throws ExtensionEntryResolutionError when `main` is absolute, uses a
 *         disallowed URL scheme, or escapes `installPath`.
 */
export function resolveExtensionEntryTarget(
  installPath: string,
  main: string,
): ExtensionEntryTarget {
  if (typeof main !== 'string' || main.trim().length === 0) {
    throw new ExtensionEntryResolutionError('manifest.main is empty');
  }

  // Self-contained module source. No base path applies and no filesystem is
  // reachable from it, so there is nothing to contain.
  if (/^data:/i.test(main)) return { kind: 'data', url: main };

  if (URL_SCHEME_PATTERN.test(main)) {
    throw new ExtensionEntryResolutionError(
      `manifest.main "${main}" uses an unsupported URL scheme; only a package-relative path or a data: URL is allowed`,
    );
  }

  if (isAbsolute(main) || WINDOWS_DRIVE_ABSOLUTE.test(main) || main.startsWith('\\')) {
    throw new ExtensionEntryResolutionError(
      `manifest.main "${main}" must be relative to the extension package root`,
    );
  }

  if (typeof installPath !== 'string' || installPath.length === 0) {
    throw new ExtensionEntryResolutionError(
      'installPath missing from the init payload — the host must send the extension install directory',
    );
  }
  if (!isAbsolute(installPath) && !WINDOWS_DRIVE_ABSOLUTE.test(installPath)) {
    throw new ExtensionEntryResolutionError(
      `installPath "${installPath}" must be an absolute path`,
    );
  }

  const base = resolve(installPath);
  const resolved = resolve(base, main);

  // Containment: the resolved path must be `base` itself or live beneath it.
  // The `+ sep` guard stops `/ext/foo-evil` from passing as a child of
  // `/ext/foo`.
  if (resolved !== base && !resolved.startsWith(base.endsWith(sep) ? base : base + sep)) {
    throw new ExtensionEntryResolutionError(
      `manifest.main "${main}" resolves outside the extension directory (${resolved})`,
    );
  }

  return { kind: 'file', path: resolved };
}
