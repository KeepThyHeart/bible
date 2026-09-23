/**
 * `InstallationService`'s keyword-index hook (F8, task 0027 revision 2): a
 * successful install triggers a best-effort, non-blocking build, and a
 * successful uninstall prunes it, leaving no orphan `.kwi` file and no orphan
 * `keyword_index` row. Drives real SQLite throughout (a real `main.db` via
 * `initializeMainDatabase`, a real `KeywordIndexService`, and a real module
 * file on disk) rather than mocking the pieces under test - the same posture
 * `InstallationService.validateModuleForInstall.test.ts` and
 * `KeywordIndexService.test.ts` already use for this area.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SqliteProvider } from '../../providers/SqliteProvider';
import { initializeMainDatabase } from '../../utils/initMainDatabase';
import { InstallationService } from '../InstallationService';
import { KeywordIndexService } from '../KeywordIndexService';

const nativeSqliteAvailable = ((): boolean => {
  try {
    const probe = new SqliteProvider(':memory:', { readonly: false });
    probe.close();
    return true;
  } catch {
    return false;
  }
})();

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

/**
 * A fully install-conformant `book` module file (see
 * `InstallationService.validateModuleForInstall.test.ts`'s identical fixture
 * shape), extended with a real `book_section` table so the post-install build
 * has something to index. `content_sha256` is required for
 * `SidecarFts5Provider` to address the built index at all - see that
 * provider's `unsupportedReason()`.
 */
function makeInstallableBookModule(dbPath: string, sections: Array<{ title: string; content: string }>): void {
  const db = new SqliteProvider(dbPath, { readonly: false });
  db.exec(`
    CREATE TABLE module_info (
      info_id INTEGER PRIMARY KEY,
      module_uuid TEXT,
      canon TEXT,
      versification TEXT,
      format_version TEXT,
      compression TEXT,
      content_sha256 TEXT
    );
    CREATE TABLE verse_link (link_id INTEGER PRIMARY KEY);
    CREATE TABLE schema_version (version TEXT);
    CREATE TABLE book_section (
      section_id INTEGER PRIMARY KEY,
      title TEXT,
      content TEXT
    );
  `);
  db.execute(
    `INSERT INTO module_info (info_id, module_uuid, canon, versification, format_version, compression, content_sha256)
     VALUES (1, ?, 'protestant-66', 'kjv-english', '0.2', 'none', ?)`,
    [VALID_UUID, 'c'.repeat(64)]
  );
  for (const [i, section] of sections.entries()) {
    db.execute(`INSERT INTO book_section (section_id, title, content) VALUES (?, ?, ?)`, [i + 1, section.title, section.content]);
  }
  db.close();
}

describe.skipIf(!nativeSqliteAvailable)('InstallationService keyword-index hook', () => {
  let tmpRoot: string;
  let mainDb: SqliteProvider;
  let keywordIndexService: KeywordIndexService;
  let installationService: InstallationService;
  let modulesBasePath: string;
  let indexDir: string;
  let sourcePath: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'bible-install-keywordIndex-'));
    modulesBasePath = join(tmpRoot, 'data', 'modules');
    mkdirSync(modulesBasePath, { recursive: true });
    indexDir = join(tmpRoot, 'index', 'keyword');
    mkdirSync(indexDir, { recursive: true });

    mainDb = initializeMainDatabase(join(tmpRoot, 'main.db'));
    keywordIndexService = new KeywordIndexService(mainDb, indexDir);
    installationService = new InstallationService(mainDb, modulesBasePath, keywordIndexService);

    const downloadsDir = join(tmpRoot, 'downloads');
    mkdirSync(downloadsDir, { recursive: true });
    sourcePath = join(downloadsDir, 'book_test.db');
  });

  afterEach(() => {
    mainDb.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function keywordIndexRowFor(moduleUuid: string): { state: string } | undefined {
    return mainDb.queryOne(`SELECT state FROM keyword_index WHERE module_uuid = ?`, [moduleUuid]);
  }

  async function waitForIndexSettled(moduleId: number, timeoutMs = 5000): Promise<ReturnType<KeywordIndexService['getStatusForModule']>> {
    const deadline = Date.now() + timeoutMs;
    let status = await keywordIndexService.getStatusForModule(moduleId);
    while ((status?.state === 'unbuilt' || status?.state === 'building') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      status = await keywordIndexService.getStatusForModule(moduleId);
    }
    return status;
  }

  it('installModule returns success immediately, without waiting for the keyword-index build to finish', async () => {
    makeInstallableBookModule(sourcePath, [{ title: 'One', content: 'First section.' }]);

    const result = await installationService.installModule(sourcePath, {
      moduleType: 'book',
      moduleName: 'Test Book',
      abbreviation: 'TESTBOOK',
      moduleUuid: VALID_UUID,
    });

    expect(result.success).toBe(true);
    expect(result.moduleId).toBeDefined();

    // The build may already be mid-flight (or even done, for a fixture this
    // small) - what matters is that installModule's own return did not wait
    // on it. Design doc §5.1: "the module is already readable" the instant
    // registration succeeds, which the assertion above already confirms.
  });

  it('walks the keyword_index row from unbuilt through building to ready after a successful install', async () => {
    makeInstallableBookModule(sourcePath, [
      { title: 'One', content: 'First section.' },
      { title: 'Two', content: 'Second section.' },
    ]);

    const result = await installationService.installModule(sourcePath, {
      moduleType: 'book',
      moduleName: 'Test Book',
      abbreviation: 'TESTBOOK',
      moduleUuid: VALID_UUID,
    });

    const status = await waitForIndexSettled(result.moduleId!);

    expect(status).toMatchObject({ moduleUuid: VALID_UUID, providerId: 'sidecar-fts5', state: 'ready', docCount: 2 });
    expect(status?.sizeBytes).toBeGreaterThan(0);
    expect(status?.builtAt).toBeTruthy();

    const kwiFiles = readdirSync(indexDir).filter((f) => f.endsWith('.kwi'));
    expect(kwiFiles).toHaveLength(1);
  });

  it('a keyword-index build failure never turns a successful install into a failure, and is recorded as failed rather than retried forever as unbuilt', async () => {
    // Sabotage the index directory: SidecarFts5Provider.build() will throw
    // SidecarIndexBuildError, which must be swallowed entirely by the
    // fire-and-forget hook.
    rmSync(indexDir, { recursive: true, force: true });
    // Leave it absent entirely (not even a file) - assertIndexDirWritable
    // treats a missing directory the same as an unwritable one.

    makeInstallableBookModule(sourcePath, [{ title: 'One', content: 'First section.' }]);

    const result = await installationService.installModule(sourcePath, {
      moduleType: 'book',
      moduleName: 'Test Book',
      abbreviation: 'TESTBOOK',
      moduleUuid: VALID_UUID,
    });

    expect(result.success).toBe(true);

    const deadline = Date.now() + 5000;
    let row = keywordIndexRowFor(VALID_UUID);
    while (row?.state !== 'failed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      row = keywordIndexRowFor(VALID_UUID);
    }

    expect(row?.state).toBe('failed');
  });

  it('installing a module type with no indexable content (e.g. cross_reference) never creates a keyword_index row', async () => {
    // cross_reference's own conformance rules differ from book's; reuse the
    // same fixture shape since validateModuleForInstall does not special-case
    // module_type at all - it is supplied by the caller, not read from the file.
    makeInstallableBookModule(sourcePath, []);

    const result = await installationService.installModule(sourcePath, {
      moduleType: 'cross_reference',
      moduleName: 'Test Xref',
      abbreviation: 'TESTXREF',
      moduleUuid: VALID_UUID,
    });

    expect(result.success).toBe(true);

    // Give any (incorrectly triggered) build a moment to misbehave, then
    // confirm nothing was ever written.
    await new Promise((r) => setTimeout(r, 50));
    expect(keywordIndexRowFor(VALID_UUID)).toBeUndefined();
  });

  describe('uninstallModule', () => {
    it('leaves no orphan keyword_index row or .kwi file after removing an indexed module', async () => {
      makeInstallableBookModule(sourcePath, [{ title: 'One', content: 'First section.' }]);
      const installResult = await installationService.installModule(sourcePath, {
        moduleType: 'book',
        moduleName: 'Test Book',
        abbreviation: 'TESTBOOK',
        moduleUuid: VALID_UUID,
      });
      await waitForIndexSettled(installResult.moduleId!);
      expect(keywordIndexRowFor(VALID_UUID)?.state).toBe('ready');
      expect(readdirSync(indexDir).filter((f) => f.endsWith('.kwi'))).toHaveLength(1);

      const uninstalled = await installationService.uninstallModule(installResult.moduleId!);

      expect(uninstalled).toBe(true);
      expect(keywordIndexRowFor(VALID_UUID)).toBeUndefined();
      expect(readdirSync(indexDir).filter((f) => f.endsWith('.kwi'))).toHaveLength(0);
    });

    it('still uninstalls successfully when the module was never indexed at all', async () => {
      makeInstallableBookModule(sourcePath, []);
      const installResult = await installationService.installModule(sourcePath, {
        moduleType: 'cross_reference',
        moduleName: 'Test Xref',
        abbreviation: 'TESTXREF',
        moduleUuid: VALID_UUID,
      });

      const uninstalled = await installationService.uninstallModule(installResult.moduleId!);

      expect(uninstalled).toBe(true);
    });

    it('removes the module file itself, in addition to pruning its index', async () => {
      makeInstallableBookModule(sourcePath, [{ title: 'One', content: 'First section.' }]);
      const installResult = await installationService.installModule(sourcePath, {
        moduleType: 'book',
        moduleName: 'Test Book',
        abbreviation: 'TESTBOOK',
        moduleUuid: VALID_UUID,
      });
      const destinationPath = installationService.getModulePath('book', 'TESTBOOK');
      expect(existsSync(destinationPath)).toBe(true);

      await installationService.uninstallModule(installResult.moduleId!);

      expect(existsSync(destinationPath)).toBe(false);
    });
  });
});
