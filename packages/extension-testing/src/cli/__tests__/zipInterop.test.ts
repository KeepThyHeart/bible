/**
 * The property that actually matters about `bible-ext package`: the archive it
 * writes can be read by the library the *installer* uses.
 *
 * `createZip` has its own unit tests, but those parse the output with a reader
 * written alongside it — a symmetrical misreading of the ZIP spec would pass
 * both. `ExtensionInstaller.ts` opens archives with `unzipper`, so this drives
 * the same library over a real `bible-ext package` output. A format bug here
 * would otherwise surface as "install silently fails" on a user's machine,
 * against an extension whose author did everything right.
 *
 * `unzipper` is a devDependency of this package only. It never reaches an
 * extension author, who installs this package for its runtime exports.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Open } from 'unzipper';

import { runPackageCommand } from '../packageCommand';
import type { SmokeCommandContext } from '../smokeCommand';

function makeCtx(cwd: string): SmokeCommandContext {
  return {
    cwd,
    stdout: () => undefined,
    stderr: () => undefined,
    writeFile: () => undefined,
  };
}

describe('bible-ext package output, read back through unzipper', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'zip-interop-'));
    const manifest = {
      id: 'ext.test.interop',
      name: { key: 'ext.test.interop' },
      version: '1.0.0',
      publisher: 'test',
      engines: { bibleApp: '^1.0.0' },
      main: 'dist/main.js',
    };
    writeFileSync(join(workDir, 'extension.json'), JSON.stringify(manifest, null, 2), 'utf8');
    mkdirSync(join(workDir, 'dist'), { recursive: true });
    // Large and repetitive, so the entry is genuinely deflated rather than
    // small enough for a stored-vs-deflate mistake to go unnoticed.
    writeFileSync(join(workDir, 'dist', 'main.js'), 'exports.activate=()=>{};\n'.repeat(400), 'utf8');
    mkdirSync(join(workDir, 'ui'), { recursive: true });
    writeFileSync(join(workDir, 'ui', 'index.html'), '<!DOCTYPE html><p>hi</p>', 'utf8');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('unzipper reads every entry back byte-for-byte', async () => {
    expect(runPackageCommand([workDir], makeCtx(workDir))).toBe(0);

    const archivePath = join(workDir, 'build', 'ext.test.interop-1.0.0.zip');
    const directory = await Open.file(archivePath);

    const byPath = new Map(directory.files.map((f) => [f.path, f]));
    expect([...byPath.keys()].sort()).toEqual([
      'dist/main.js',
      'extension.json',
      'ui/index.html',
    ]);

    for (const relative of ['extension.json', 'dist/main.js', 'ui/index.html']) {
      const entry = byPath.get(relative);
      expect(entry, `${relative} missing from archive`).toBeDefined();
      const unpacked = await entry!.buffer();
      expect(unpacked.equals(readFileSync(join(workDir, relative)))).toBe(true);
    }
  });

  it('puts the manifest where the installer looks for it, parseable as JSON', async () => {
    runPackageCommand([workDir], makeCtx(workDir));

    const directory = await Open.file(join(workDir, 'build', 'ext.test.interop-1.0.0.zip'));
    // ExtensionInstaller checks for `extension.json` at the archive root before
    // falling back to a single wrapper directory. `package` must hit the first
    // case — the fallback exists for archives made by hand.
    const manifestEntry = directory.files.find((f) => f.path === 'extension.json');
    expect(manifestEntry).toBeDefined();

    const parsed = JSON.parse((await manifestEntry!.buffer()).toString('utf8')) as { id: string };
    expect(parsed.id).toBe('ext.test.interop');
  });

  it('marks entries as files, not directories', async () => {
    runPackageCommand([workDir], makeCtx(workDir));

    const directory = await Open.file(join(workDir, 'build', 'ext.test.interop-1.0.0.zip'));
    // The installer skips anything that is not a File, so a nested path
    // mistakenly typed as a Directory would be dropped without an error.
    expect(directory.files.every((f) => f.type === 'File')).toBe(true);
  });
});
