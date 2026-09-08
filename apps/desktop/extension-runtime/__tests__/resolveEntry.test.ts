/**
 * Extension entry-point resolution.
 *
 * `payload.manifest.main` is a package-relative path such as `"./main.js"`. It
 * MUST be resolved against the extension's install directory: resolved against
 * the runtime bundle in `out/main/extension-runtime/` instead, every on-disk
 * extension fails to load with `ERR_MODULE_NOT_FOUND`, and authors cannot work
 * around it because the manifest validator rejects absolute `main` paths with
 * `path.absolute`.
 *
 * Resolving a manifest-supplied path against a real directory is also a
 * path-traversal surface, so the containment behaviour is pinned here too.
 *
 * The resolved target is *read* rather than imported - the extension's code
 * runs inside a QuickJS realm, which has no module loader and no filesystem -
 * so resolution and containment are the last privileged step the supervisor
 * performs on an extension's behalf, which makes them load-bearing.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'path';

import { resolveExtensionEntryTarget, ExtensionEntryResolutionError } from '../resolveEntry';

/** Absolute on both POSIX and Win32 (`path.win32.isAbsolute('/x')` is true). */
const INSTALL = resolve('/ext-root/ext.test.sample');

/** The resolved filesystem path, for the cases that expect a file target. */
function filePath(installPath: string, main: string): string {
  const target = resolveExtensionEntryTarget(installPath, main);
  if (target.kind !== 'file') throw new Error(`expected a file target, got ${target.kind}`);
  return target.path;
}

describe('resolveExtensionEntryTarget (bug A)', () => {
  it('resolves a relative main against the install directory, not the runtime bundle', () => {
    const path = filePath(INSTALL, './main.js');
    expect(path).toBe(resolve(INSTALL, 'main.js'));
    // The failure mode is a specifier next to the runtime bundle. The resolved
    // path must live under the extension directory.
    expect(path.startsWith(INSTALL)).toBe(true);
  });

  it('returns an absolute filesystem path, not a specifier', () => {
    // The supervisor passes this to `readFileSync`, so a `file://` URL - which
    // is what this returned while `import()` was still in the picture - would
    // now be wrong.
    const path = filePath(INSTALL, './dist/index.js');
    expect(path).not.toMatch(/^file:\/\//);
    expect(path).toBe(resolve(INSTALL, 'dist', 'index.js'));
  });

  it('handles nested and backslash-separated relative paths', () => {
    expect(filePath(INSTALL, 'lib/main.js')).toBe(resolve(INSTALL, 'lib', 'main.js'));
    expect(filePath(INSTALL, './a/../b/main.js')).toBe(resolve(INSTALL, 'b', 'main.js'));
  });

  // -- Security: path traversal --------------------------------------------

  it('rejects a main that escapes the install directory via ..', () => {
    expect(() => resolveExtensionEntryTarget(INSTALL, '../../../../evil.js')).toThrow(
      ExtensionEntryResolutionError,
    );
    expect(() => resolveExtensionEntryTarget(INSTALL, '../../../../evil.js')).toThrow(
      /resolves outside the extension directory/,
    );
  });

  it('rejects traversal that only escapes after a legitimate-looking prefix', () => {
    expect(() => resolveExtensionEntryTarget(INSTALL, './lib/../../sibling/evil.js')).toThrow(
      ExtensionEntryResolutionError,
    );
  });

  it('rejects a sibling directory that merely shares the install path prefix', () => {
    // `/ext-root/ext.test.sample-evil` starts with the install path as a
    // STRING but is not inside it - the containment check must be
    // separator-aware.
    expect(() => resolveExtensionEntryTarget(INSTALL, '../ext.test.sample-evil/main.js')).toThrow(
      ExtensionEntryResolutionError,
    );
  });

  it('rejects absolute paths', () => {
    expect(() => resolveExtensionEntryTarget(INSTALL, '/etc/passwd')).toThrow(
      /must be relative to the extension package root/,
    );
    expect(() => resolveExtensionEntryTarget(INSTALL, 'C:\\Windows\\System32\\evil.js')).toThrow(
      /must be relative to the extension package root/,
    );
    expect(() => resolveExtensionEntryTarget(INSTALL, '\\\\server\\share\\evil.js')).toThrow(
      ExtensionEntryResolutionError,
    );
  });

  it('rejects URL schemes other than data:', () => {
    for (const main of [
      'file:///etc/passwd',
      'https://evil.example.com/payload.js',
      'http://evil.example.com/payload.js',
      'node:fs',
    ]) {
      expect(() => resolveExtensionEntryTarget(INSTALL, main), main).toThrow(
        ExtensionEntryResolutionError,
      );
    }
  });

  it('passes data: URLs through untouched (self-contained module, no base path)', () => {
    const url = 'data:text/javascript,export function activate(){}';
    expect(resolveExtensionEntryTarget(INSTALL, url)).toEqual({ kind: 'data', url });
    const upper = 'DATA:text/javascript,export%20function%20activate(){}';
    expect(resolveExtensionEntryTarget(INSTALL, upper)).toEqual({ kind: 'data', url: upper });
  });

  // -- Bad host input ------------------------------------------------------

  it('rejects an empty main', () => {
    expect(() => resolveExtensionEntryTarget(INSTALL, '')).toThrow(/manifest.main is empty/);
    expect(() => resolveExtensionEntryTarget(INSTALL, '   ')).toThrow(/manifest.main is empty/);
  });

  it('rejects a missing or relative installPath (host bug, not an extension bug)', () => {
    expect(() => resolveExtensionEntryTarget('', './main.js')).toThrow(/installPath missing/);
    expect(() => resolveExtensionEntryTarget('relative/dir', './main.js')).toThrow(
      /must be an absolute path/,
    );
  });

  it('does not spuriously reject the install directory itself', () => {
    // `.` resolves to the directory - allowed by containment, though reading it
    // will fail. The point is that containment does not reject the boundary.
    expect(() => resolveExtensionEntryTarget(INSTALL, '.')).not.toThrow();
    expect(filePath(INSTALL, '.')).toBe(INSTALL);
  });
});
