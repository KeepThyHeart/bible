import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installFromDirectory, uninstallDirectory } from '../ExtensionInstaller';

let tmpRoot: string;
let extensionsRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ext-installer-'));
  extensionsRoot = join(tmpRoot, 'extensions');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeSourceDir(name: string, manifest: unknown, extras: Record<string, string> = {}): string {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'extension.json'), JSON.stringify(manifest), 'utf8');
  for (const [path, content] of Object.entries(extras)) {
    const fullPath = join(dir, path);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }
  return dir;
}

const validManifest = {
  id: 'ext.example.tools',
  name: { key: 'extension.name' },
  version: '1.0.0',
  publisher: 'example',
  engines: { bibleApp: '^1.0.0' },
};

describe('installFromDirectory', () => {
  it('copies a valid source into <extensionsRoot>/<id>/', () => {
    const source = makeSourceDir('source', validManifest, {
      'dist/extension.js': 'export function activate() {}',
    });
    const result = installFromDirectory({ sourcePath: source, extensionsRoot });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.installPath).toBe(join(extensionsRoot, 'ext.example.tools'));
      expect(existsSync(join(result.installPath, 'extension.json'))).toBe(true);
      expect(existsSync(join(result.installPath, 'dist/extension.js'))).toBe(true);
      expect(readFileSync(join(result.installPath, 'dist/extension.js'), 'utf8'))
        .toContain('activate');
    }
  });

  it('refuses to overwrite an existing install without overwrite=true', () => {
    const source = makeSourceDir('source-1', validManifest);
    expect(installFromDirectory({ sourcePath: source, extensionsRoot }).ok).toBe(true);

    const second = makeSourceDir('source-2', validManifest);
    const result = installFromDirectory({ sourcePath: second, extensionsRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('install.already-exists');
    }
  });

  it('overwrites in place when overwrite=true', () => {
    const source1 = makeSourceDir('source-1', validManifest, { 'old-only.txt': 'v1' });
    expect(installFromDirectory({ sourcePath: source1, extensionsRoot }).ok).toBe(true);

    const source2 = makeSourceDir('source-2', { ...validManifest, version: '2.0.0' }, {
      'new-only.txt': 'v2',
    });
    const result = installFromDirectory({
      sourcePath: source2,
      extensionsRoot,
      overwrite: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifestResult.manifest.version).toBe('2.0.0');
      // The old file should be gone (rmSync before copy).
      expect(existsSync(join(result.installPath, 'old-only.txt'))).toBe(false);
      expect(existsSync(join(result.installPath, 'new-only.txt'))).toBe(true);
    }
  });

  it('rejects an invalid source manifest with manifest.invalid', () => {
    const source = makeSourceDir('bad', { id: 'no-prefix', version: 'no-semver' });
    const result = installFromDirectory({ sourcePath: source, extensionsRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('manifest.invalid');
      expect(Array.isArray(result.detail)).toBe(true);
    }
    // No partial install should be left behind.
    expect(existsSync(extensionsRoot)).toBe(false);
  });

  it('rejects when source path is not a directory', () => {
    const file = join(tmpRoot, 'not-a-dir.txt');
    writeFileSync(file, 'hi', 'utf8');
    const result = installFromDirectory({ sourcePath: file, extensionsRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('source.not-directory');
    }
  });
});

describe('uninstallDirectory', () => {
  it('removes the install directory', () => {
    const source = makeSourceDir('source', validManifest);
    const installed = installFromDirectory({ sourcePath: source, extensionsRoot });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;

    uninstallDirectory(installed.installPath, extensionsRoot);
    expect(existsSync(installed.installPath)).toBe(false);
  });

  it('is a no-op when the directory does not exist', () => {
    // Inside the root: the realistic case is an install whose directory was
    // already removed out from under the registry.
    expect(() =>
      uninstallDirectory(join(extensionsRoot, 'ext.gone.already'), extensionsRoot),
    ).not.toThrow();
  });

  it('refuses to delete a directory outside the extensions root', () => {
    // The Developer Mode case: `install_path` points at a developer's working
    // copy that the host never owned. A recursive delete there destroys source.
    const outside = makeSourceDir('not-an-install', validManifest);
    expect(() => uninstallDirectory(outside, extensionsRoot)).toThrow(/outside the extensions root/);
    expect(existsSync(outside)).toBe(true);
  });

  it('refuses to delete the extensions root itself', () => {
    mkdirSync(extensionsRoot, { recursive: true });
    expect(() => uninstallDirectory(extensionsRoot, extensionsRoot)).toThrow(
      /outside the extensions root/,
    );
    expect(existsSync(extensionsRoot)).toBe(true);
  });
});
