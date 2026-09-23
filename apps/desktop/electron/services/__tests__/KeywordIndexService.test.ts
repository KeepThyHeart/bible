/**
 * `KeywordIndexService` end to end (F8, task 0027 revision 2): the
 * composition root that wires `SidecarFts5Provider` (F6) to a real module
 * file and mirrors every build outcome into `main.db`'s `keyword_index`
 * table. Drives real SQLite throughout - a real `main.db` (via
 * `initializeMainDatabase`), a real `book_*.db` module fixture, and a real
 * `.kwi` sidecar on disk - the same posture `moduleDetector.test.ts` and
 * `initMainDatabase.test.ts` already use for this area of the app.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * `KeywordIndexService.rebuildForModule` resolves `module_metadata
 * .database_path` through `resolveModulePath()`, which reads Electron's
 * `app.isPackaged` - unavailable outside a real Electron main process, the
 * same reason `moduleDetector.test.ts` mocks this module rather than
 * `electron` itself. Every fixture in this file stores an already-absolute
 * `database_path`, so the mock is the identity function; `getKeywordIndexRoot`
 * is never exercised because every test passes `indexDir` to the
 * `KeywordIndexService` constructor explicitly.
 */
vi.mock('../../utils/appPaths', () => ({
  resolveModulePath: (path: string) => path,
  getKeywordIndexRoot: () => {
    throw new Error('getKeywordIndexRoot() should not be called - every test passes indexDir explicitly');
  },
}));

import { SqliteProvider } from '../../providers/SqliteProvider';
import { initializeMainDatabase } from '../../utils/initMainDatabase';
import { KeywordIndexService, moduleTypeSupportsKeywordIndex } from '../KeywordIndexService';

/**
 * These tests drive real SQLite, so they need the native binding compiled for
 * the Node.js ABI vitest runs under. See `initMainDatabase.test.ts` for the
 * identical guard and why.
 */
const nativeSqliteAvailable = ((): boolean => {
  try {
    const probe = new SqliteProvider(':memory:', { readonly: false });
    probe.close();
    return true;
  } catch {
    return false;
  }
})();

const MODULE_UUID = '123e4567-e89b-12d3-a456-426614174000';
const CONTENT_SHA256 = 'b'.repeat(64);

/**
 * A minimal `book_*.db` module file - `book` is the simplest module type with
 * a `getIndexSource()` (see `KeywordIndexService`'s own `repositoryForIndexing`):
 * one table, no compression, no range columns.
 */
function makeBookModuleFile(dbPath: string, sections: Array<{ title: string; content: string }>): void {
  const db = new SqliteProvider(dbPath, { readonly: false });
  db.exec(`
    CREATE TABLE module_info (
      info_id INTEGER PRIMARY KEY,
      module_uuid TEXT,
      content_sha256 TEXT,
      full_name TEXT,
      abbreviation TEXT,
      language_code TEXT,
      format_version TEXT
    );
    CREATE TABLE book_section (
      section_id INTEGER PRIMARY KEY,
      parent_section_id INTEGER,
      title TEXT,
      content TEXT
    );
  `);
  db.execute(
    `INSERT INTO module_info (info_id, module_uuid, content_sha256, full_name, abbreviation, language_code, format_version)
     VALUES (1, ?, ?, 'Test Book', 'TESTBOOK', 'en', '0.2')`,
    [MODULE_UUID, CONTENT_SHA256]
  );
  for (const [i, section] of sections.entries()) {
    db.execute(
      `INSERT INTO book_section (section_id, title, content) VALUES (?, ?, ?)`,
      [i + 1, section.title, section.content]
    );
  }
  db.close();
}

describe.skipIf(!nativeSqliteAvailable)('KeywordIndexService', () => {
  let tmpRoot: string;
  let mainDbPath: string;
  let indexDir: string;
  let modulePath: string;
  let mainDb: SqliteProvider;
  let service: KeywordIndexService;
  let moduleId: number;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'bible-keywordIndexService-'));
    mainDbPath = join(tmpRoot, 'main.db');
    indexDir = join(tmpRoot, 'index', 'keyword');
    mkdirSync(indexDir, { recursive: true });
    modulePath = join(tmpRoot, 'modules', 'book_test.db');
    mkdirSync(join(tmpRoot, 'modules'), { recursive: true });

    makeBookModuleFile(modulePath, [
      { title: 'Chapter One', content: 'In the beginning of the test fixture.' },
      { title: 'Chapter Two', content: 'The fixture continued, uneventfully.' },
      { title: 'Chapter Three', content: 'And so the fixture ended.' },
    ]);

    mainDb = initializeMainDatabase(mainDbPath);
    const result = mainDb.execute(
      `INSERT INTO module_metadata (module_uuid, module_type, module_name, abbreviation, database_path, language_code)
       VALUES (?, 'book', 'Test Book', 'TESTBOOK', ?, 'en')`,
      [MODULE_UUID, modulePath]
    );
    moduleId = result.lastInsertRowId!;

    service = new KeywordIndexService(mainDb, indexDir);
  });

  afterEach(() => {
    mainDb.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function keywordIndexRow(): { state: string; doc_count: number | null; size_bytes: number | null; built_at: string | null; error: string | null } | undefined {
    return mainDb.queryOne(
      `SELECT state, doc_count, size_bytes, built_at, error FROM keyword_index WHERE module_uuid = ?`,
      [MODULE_UUID]
    );
  }

  it('reports unbuilt for a module that has never been indexed', async () => {
    const status = await service.getStatusForModule(moduleId);
    expect(status).toEqual({ moduleUuid: MODULE_UUID, providerId: 'sidecar-fts5', state: 'unbuilt' });
  });

  it('returns undefined for a moduleId that does not exist', async () => {
    expect(await service.getStatusForModule(999999)).toBeUndefined();
    expect(await service.rebuildForModule(999999)).toBeUndefined();
    expect(await service.deleteIndexForModule(999999)).toBeUndefined();
  });

  describe('post-install build (triggerBuildAfterInstall)', () => {
    it('builds to ready, fire-and-forget, and the caller does not need to await anything itself', async () => {
      service.triggerBuildAfterInstall({ moduleType: 'book', absoluteDatabasePath: modulePath });

      // Fire-and-forget: poll for completion rather than awaiting a promise
      // this method deliberately does not return (see its own doc comment on
      // why installModule's latency must not depend on build time).
      const deadline = Date.now() + 5000;
      let status = await service.getStatusForModule(moduleId);
      while ((status?.state === 'unbuilt' || status?.state === 'building') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
        status = await service.getStatusForModule(moduleId);
      }

      expect(status).toMatchObject({ moduleUuid: MODULE_UUID, providerId: 'sidecar-fts5', state: 'ready' });
      expect(status?.docCount).toBe(3);
      expect(status?.sizeBytes).toBeGreaterThan(0);
      expect(status?.builtAt).toBeTruthy();
      expect(status?.error).toBeNull();

      // The .kwi artifact is actually on disk.
      const kwiFiles = readdirSync(indexDir).filter((f) => f.endsWith('.kwi'));
      expect(kwiFiles).toHaveLength(1);
    });
  });

  describe('rebuildForModule (manual rebuild)', () => {
    it('walks the state machine unbuilt -> building -> ready, persisting each transition', async () => {
      expect(keywordIndexRow()).toBeUndefined();

      const status = await service.rebuildForModule(moduleId);

      expect(status).toMatchObject({ state: 'ready', docCount: 3 });
      const row = keywordIndexRow();
      expect(row?.state).toBe('ready');
      expect(row?.doc_count).toBe(3);
      expect(row?.size_bytes).toBeGreaterThan(0);
      expect(row?.built_at).toBeTruthy();
      expect(row?.error).toBeNull();
    });

    it('is idempotent: rebuilding an already-ready index still reports ready', async () => {
      await service.rebuildForModule(moduleId);
      const second = await service.rebuildForModule(moduleId);

      expect(second?.state).toBe('ready');
      expect(second?.docCount).toBe(3);
    });

    it('records a failed build with its reason when the index directory cannot be written to, and the module remains fully readable', async () => {
      // Replace the writable directory with a plain file, so
      // SidecarFts5Provider.assertIndexDirWritable's `stat.isDirectory()`
      // check fails and build() throws SidecarIndexBuildError.
      rmSync(indexDir, { recursive: true, force: true });
      writeFileSync(indexDir, 'not a directory');
      const brokenService = new KeywordIndexService(mainDb, indexDir);

      const status = await brokenService.rebuildForModule(moduleId);

      expect(status?.state).toBe('failed');
      expect(status?.error).toMatch(/not a directory/);
      expect(status?.docCount).toBeNull();
      expect(status?.sizeBytes).toBeNull();
      expect(status?.builtAt).toBeNull();

      const row = keywordIndexRow();
      expect(row?.state).toBe('failed');

      // The module's own content is completely unaffected by the index
      // failure - the central point of design doc §5.1.
      const module = new SqliteProvider(modulePath, { readonly: true });
      try {
        const rows = module.queryAll<{ title: string }>('SELECT title FROM book_section ORDER BY section_id');
        expect(rows.map((r) => r.title)).toEqual(['Chapter One', 'Chapter Two', 'Chapter Three']);
      } finally {
        module.close();
      }
    });

    it('an aborted build leaves the module unbuilt (not failed), and leaves the module fully usable', async () => {
      const controller = new AbortController();
      controller.abort();

      const status = await service.rebuildForModule(moduleId, controller.signal);

      expect(status).toEqual({ moduleUuid: MODULE_UUID, providerId: 'sidecar-fts5', state: 'unbuilt' });
      expect(keywordIndexRow()).toBeUndefined();

      // No stray .kwi or .kwi.part left behind.
      expect(existsSync(indexDir) ? readdirSync(indexDir) : []).toEqual([]);

      // The module's own content is still fully readable - "an interrupted
      // index leaves the module usable" (F8's own acceptance criterion).
      const module = new SqliteProvider(modulePath, { readonly: true });
      try {
        expect(module.queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM book_section')?.c).toBe(3);
      } finally {
        module.close();
      }
    });

    it('a build that failed once can be rebuilt successfully afterward', async () => {
      rmSync(indexDir, { recursive: true, force: true });
      writeFileSync(indexDir, 'not a directory');
      const brokenService = new KeywordIndexService(mainDb, indexDir);
      const failed = await brokenService.rebuildForModule(moduleId);
      expect(failed?.state).toBe('failed');

      // Repair the index directory and rebuild through a service pointed at
      // the now-valid path.
      rmSync(indexDir, { force: true });
      mkdirSync(indexDir, { recursive: true });
      const healthyService = new KeywordIndexService(mainDb, indexDir);
      const recovered = await healthyService.rebuildForModule(moduleId);

      expect(recovered?.state).toBe('ready');
      expect(recovered?.error).toBeNull();
    });

    it('reports unavailable, and never builds anything, for a module type with no indexable content', async () => {
      mainDb.execute(
        `INSERT INTO module_metadata (module_uuid, module_type, module_name, abbreviation, database_path, language_code)
         VALUES ('xref-uuid', 'cross_reference', 'Test Xref', 'XREF', 'modules/xref_test.db', 'en')`
      );
      const xrefId = mainDb.queryOne<{ module_id: number }>(
        `SELECT module_id FROM module_metadata WHERE abbreviation = 'XREF'`
      )!.module_id;

      const status = await service.rebuildForModule(xrefId);

      expect(status).toEqual({
        moduleUuid: 'xref-uuid',
        providerId: 'sidecar-fts5',
        state: 'unavailable',
        reason: 'nothing-to-index',
      });
      expect(mainDb.queryOne(`SELECT 1 FROM keyword_index WHERE module_uuid = 'xref-uuid'`)).toBeUndefined();
    });
  });

  describe('deleteIndexForModule / pruneIndex', () => {
    it('deletes both the .kwi artifact and the keyword_index row, leaving the module itself untouched', async () => {
      await service.rebuildForModule(moduleId);
      expect(readdirSync(indexDir).filter((f) => f.endsWith('.kwi'))).toHaveLength(1);
      expect(keywordIndexRow()).toBeDefined();

      const status = await service.deleteIndexForModule(moduleId);

      expect(status).toEqual({ moduleUuid: MODULE_UUID, providerId: 'sidecar-fts5', state: 'unbuilt' });
      expect(keywordIndexRow()).toBeUndefined();
      expect(readdirSync(indexDir).filter((f) => f.endsWith('.kwi'))).toHaveLength(0);
      expect(existsSync(modulePath)).toBe(true);
    });

    it('is a no-op (not an error) when the module has never been indexed', async () => {
      const status = await service.deleteIndexForModule(moduleId);
      expect(status?.state).toBe('unbuilt');
    });

    it('pruneIndex (used directly by InstallationService.uninstallModule) leaves no orphan index and no open handle', async () => {
      await service.rebuildForModule(moduleId);
      const kwiPath = join(indexDir, readdirSync(indexDir).find((f) => f.endsWith('.kwi'))!);
      expect(existsSync(kwiPath)).toBe(true);

      await service.pruneIndex(MODULE_UUID, 'book');

      expect(existsSync(kwiPath)).toBe(false);
      expect(keywordIndexRow()).toBeUndefined();
      // The file handle SidecarFts5Provider.prune() would have needed is not
      // held open afterward - deleting the module's own directory must not
      // fail with EBUSY/locked-file style errors on any platform.
      expect(() => rmSync(indexDir, { recursive: true, force: true })).not.toThrow();
    });
  });
});

describe('moduleTypeSupportsKeywordIndex', () => {
  it('is true for every module type with a getIndexSource() implementation', () => {
    expect(moduleTypeSupportsKeywordIndex('bible')).toBe(true);
    expect(moduleTypeSupportsKeywordIndex('commentary')).toBe(true);
    expect(moduleTypeSupportsKeywordIndex('dictionary')).toBe(true);
    expect(moduleTypeSupportsKeywordIndex('lexicon')).toBe(true);
    expect(moduleTypeSupportsKeywordIndex('book')).toBe(true);
    expect(moduleTypeSupportsKeywordIndex('topical_index')).toBe(true);
  });

  it('is false for module types with no indexable content or no repository yet', () => {
    expect(moduleTypeSupportsKeywordIndex('cross_reference')).toBe(false);
    expect(moduleTypeSupportsKeywordIndex('tag_graph')).toBe(false);
    expect(moduleTypeSupportsKeywordIndex('devotional')).toBe(false);
  });
});
