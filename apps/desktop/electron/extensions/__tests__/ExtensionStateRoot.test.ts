/**
 * Extension state must not be written into the read-only half of a packaged
 * install.
 *
 * The extensions root has always been `join(getDataPath(), 'extensions')`.
 * `getDataPath()` is `process.resourcesPath/data` once packaged, which is
 * root-owned under `/opt/<Name>` for a .deb/.rpm, inside the signed bundle on
 * macOS (writing there also invalidates the signature), and a read-only
 * squashfs mount for an AppImage. Windows with `perMachine: false` installs
 * somewhere writable, which is exactly why this went unnoticed: the only
 * platform where the writes succeed is the one most of the development happens
 * on.
 *
 * Two components write under that root - `ExtensionDatabaseRegistry`
 * (`<id>/db/<name>.db`) and `ExtensionLifecycleLogger`
 * (`<id>/extension.log`, `<id>/crash.log`) - and neither fails loudly. The
 * logger swallows its own errors by design, so the symptom is an Extensions UI
 * that shows no activity at all and a crash-detection loop that can never
 * observe a crash.
 *
 * These tests pin the split that fixes it:
 *
 *   - the two writers resolve under the writable root they are given;
 *   - discovery keeps resolving under the bundled root, because moving
 *     discovery and installs is a separate, larger change;
 *   - handing both roots the same directory - which is what development and
 *     e2e do, since `getDataPath()` and `getUserDataPath()` return the
 *     identical path when `app.isPackaged` is false - changes nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { ISql } from '@bible/core';

import { ExtensionHost } from '../ExtensionHost';
import { ExtensionDatabaseRegistry } from '../ExtensionDatabaseRegistry';
import { FakeSql } from './fakeSql';

const EXT_ID = 'ext.test.state-root';

/** Stage a minimal, discoverable extension under `root`. */
function writeFixtureExtension(root: string): void {
  const dir = join(root, EXT_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'extension.json'),
    JSON.stringify({
      id: EXT_ID,
      name: { key: 'extension.name' },
      version: '1.0.0',
      publisher: 'test',
      engines: { bibleApp: '^1.0.0' },
      main: './main.js',
      permissions: ['bible:read'],
    }),
    'utf8',
  );
  writeFileSync(join(dir, 'main.js'), 'module.exports = { activate: () => {} };', 'utf8');
}

describe('extension state root', () => {
  let tmp: string;
  /** Stands in for `join(getDataPath(), 'extensions')` - bundled, read-only. */
  let bundledRoot: string;
  /** Stands in for `join(getUserDataPath(), 'extensions')` - user-writable. */
  let writableRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ext-state-root-'));
    bundledRoot = join(tmp, 'resources', 'data', 'extensions');
    writableRoot = join(tmp, 'userData', 'data', 'extensions');
    mkdirSync(bundledRoot, { recursive: true });
    writeFixtureExtension(bundledRoot);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('ExtensionHost logRoot', () => {
    it('writes lifecycle logs under logRoot, not under the bundled root', async () => {
      const host = new ExtensionHost({
        db: new FakeSql(),
        extensionsRoot: bundledRoot,
        logRoot: writableRoot,
      });
      await host.loadAll();

      // `getContextForMarketplace()` is the host's own accessor for the shared
      // context; using it here keeps the assertion on the wiring rather than on
      // a private field.
      const ctx = host.getContextForMarketplace();
      ctx.logger.appendLog(EXT_ID, {
        ts: Date.now(),
        level: 'info',
        message: 'hello from a packaged Linux install',
      });

      expect(existsSync(join(writableRoot, EXT_ID, 'extension.log'))).toBe(true);
      expect(existsSync(join(bundledRoot, EXT_ID, 'extension.log'))).toBe(false);

      // And the host reads back what it wrote - the log surface the
      // Extensions UI calls resolves against the same root.
      const readBack = await host.getLog(EXT_ID);
      expect(readBack.map((e) => e.message)).toContain('hello from a packaged Linux install');
    });

    it('creates the log root eagerly when it differs from the extensions root', () => {
      expect(existsSync(writableRoot)).toBe(false);

      new ExtensionHost({
        db: new FakeSql(),
        extensionsRoot: bundledRoot,
        logRoot: writableRoot,
      });

      // The logger creates per-extension directories lazily and reports
      // nothing when it cannot, so the root itself is created up front: a
      // permissions problem then surfaces as one warning at boot rather than
      // as silently missing logs forever.
      expect(existsSync(writableRoot)).toBe(true);
    });

    it('still discovers extensions from the bundled root', async () => {
      const host = new ExtensionHost({
        db: new FakeSql(),
        extensionsRoot: bundledRoot,
        logRoot: writableRoot,
      });
      await host.loadAll();

      const listed = await host.listExtensions();
      expect(listed.map((e) => e.manifest.id)).toContain(EXT_ID);
      // The install path is the proof: it names the bundled tree, not the
      // writable one.
      expect(listed.find((e) => e.manifest.id === EXT_ID)?.installPath).toBe(
        join(bundledRoot, EXT_ID),
      );

      // Nothing was copied or migrated into the writable root. Discovery and
      // installs are deliberately out of scope; only state moved.
      expect(existsSync(join(writableRoot, EXT_ID, 'extension.json'))).toBe(false);
    });

    it('defaults logRoot to extensionsRoot, so existing callers are unaffected', async () => {
      const host = new ExtensionHost({
        db: new FakeSql(),
        extensionsRoot: bundledRoot,
      });
      await host.loadAll();

      const ctx = host.getContextForMarketplace();
      expect(ctx.logRoot).toBe(bundledRoot);

      ctx.logger.appendLog(EXT_ID, { ts: Date.now(), level: 'info', message: 'legacy' });
      expect(existsSync(join(bundledRoot, EXT_ID, 'extension.log'))).toBe(true);
    });

    it('is a no-op when both roots are the same directory (dev and e2e)', async () => {
      // `getDataPath()` and `getUserDataPath()` both return
      // `apps/desktop/data` when `app.isPackaged` is false, so this is the
      // configuration every developer and every CI run actually gets.
      const host = new ExtensionHost({
        db: new FakeSql(),
        extensionsRoot: bundledRoot,
        logRoot: bundledRoot,
      });
      await host.loadAll();

      const ctx = host.getContextForMarketplace();
      ctx.logger.appendLog(EXT_ID, { ts: Date.now(), level: 'info', message: 'dev' });

      expect(existsSync(join(bundledRoot, EXT_ID, 'extension.log'))).toBe(true);
      expect(existsSync(writableRoot)).toBe(false);
    });
  });

  describe('ExtensionDatabaseRegistry', () => {
    /** Records the paths the registry asks for without touching sqlite. */
    function makeRegistry(root: string): { registry: ExtensionDatabaseRegistry; opened: string[] } {
      const opened: string[] = [];
      const registry = new ExtensionDatabaseRegistry({
        extensionsRoot: root,
        factory: {
          open: (filePath) => {
            opened.push(filePath);
            return new FakeSql() as unknown as ISql;
          },
        },
      });
      return { registry, opened };
    }

    it('opens per-extension databases under the writable root', () => {
      const { registry, opened } = makeRegistry(writableRoot);

      registry.open(EXT_ID, 'notes');

      expect(opened).toEqual([join(writableRoot, EXT_ID, 'db', 'notes.db')]);
      expect(existsSync(join(writableRoot, EXT_ID, 'db'))).toBe(true);
      // The bundled tree is untouched - which is the whole point, since on a
      // .deb install the process cannot write there at all.
      expect(existsSync(join(bundledRoot, EXT_ID, 'db'))).toBe(false);
    });

    it('still puts them beside the extension when both roots are the same', () => {
      const { registry, opened } = makeRegistry(bundledRoot);

      registry.open(EXT_ID, 'notes');

      expect(opened).toEqual([join(bundledRoot, EXT_ID, 'db', 'notes.db')]);
    });
  });
});
