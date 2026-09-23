/**
 * `detectAndRegisterModules`'s boot-time filesystem scan against the F5
 * module-file rule table (task 0027, "Module Format v2", revision 2): before
 * this pass, the scan never checked the SQLite header at all, and never
 * checked `format_version` - a corrupt file or an unreadable format used to
 * either crash the scan or silently mis-register. These tests build real
 * module files on disk (not mocks of `getModuleInfoFromDatabase`) and drive
 * the whole scan end to end, the same way `initMainDatabase.test.ts` and
 * `StudyCacheService.test.ts` drive real SQLite rather than stubbing it.
 *
 * `./appPaths` is mocked (not `electron` itself) so the scan's three path
 * functions point at a throwaway temp directory instead of the real
 * `apps/desktop/data/` - mocking the whole module means `appPaths.ts`'s own
 * `import { app } from 'electron'` is never evaluated, so `electron` needs no
 * mock of its own here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const state = vi.hoisted(() => ({ dataPath: '', userModulesPath: '', mainDbPath: '' }));

vi.mock('./appPaths', () => ({
  getDataPath: () => state.dataPath,
  getUserModulesPath: () => state.userModulesPath,
  resolveMainDbPath: () => state.mainDbPath,
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SqliteProvider } from '../providers/SqliteProvider';
import { initializeMainDatabase } from './initMainDatabase';
import { detectAndRegisterModules } from './moduleDetector';

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

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

/**
 * A `book_*.db` module file. `book` is the module type whose
 * `getModuleInfoFromDatabase` branch reads `module_info` directly with no
 * repository or additional tables required - the simplest fixture that still
 * exercises the real scan, not a stub of it.
 */
function makeBookModuleFile(dbPath: string, opts: { moduleUuid?: string | null; formatVersion?: string | null } = {}): void {
  const { moduleUuid = VALID_UUID, formatVersion = '0.2' } = opts;
  const db = new SqliteProvider(dbPath, { readonly: false });
  db.exec(`
    CREATE TABLE module_info (
      info_id INTEGER PRIMARY KEY,
      module_uuid TEXT,
      full_name TEXT,
      abbreviation TEXT,
      content_version TEXT,
      language_code TEXT,
      format_version TEXT
    );
  `);
  db.execute(
    `INSERT INTO module_info (info_id, module_uuid, full_name, abbreviation, content_version, language_code, format_version)
     VALUES (1, ?, 'Test Book', 'TESTBOOK', '1', 'en', ?)`,
    [moduleUuid, formatVersion]
  );
  db.close();
}

function registeredAbbreviations(): string[] {
  const db = new SqliteProvider(state.mainDbPath, { readonly: true });
  try {
    return db
      .queryAll<{ abbreviation: string }>('SELECT abbreviation FROM module_metadata ORDER BY abbreviation')
      .map((r) => r.abbreviation);
  } finally {
    db.close();
  }
}

describe.skipIf(!nativeSqliteAvailable)('detectAndRegisterModules - F5 rule table', () => {
  let tmpRoot: string;
  let modulesDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'bible-moduleDetector-'));
    modulesDir = join(tmpRoot, 'modules');
    mkdirSync(modulesDir, { recursive: true });

    state.dataPath = tmpRoot;
    // Same path as bundled -> the scan treats this as "dev mode", scanning
    // the one directory once rather than bundled + user separately.
    state.userModulesPath = modulesDir;
    state.mainDbPath = join(tmpRoot, 'main.db');

    initializeMainDatabase(state.mainDbPath).close();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('registers a fully conformant module normally', () => {
    makeBookModuleFile(join(modulesDir, 'book_valid.db'), { formatVersion: '0.2' });

    const result = detectAndRegisterModules();

    expect(result.registered).toBe(1);
    expect(result.errors).toEqual([]);
    expect(registeredAbbreviations()).toEqual(['TESTBOOK']);
  });

  describe('SQLite header (new)', () => {
    it('skips a file that does not begin with the SQLite header, without crashing the scan', () => {
      writeFileSync(join(modulesDir, 'book_corrupt.db'), Buffer.from('not a database at all'));
      makeBookModuleFile(join(modulesDir, 'book_valid.db'));

      const result = detectAndRegisterModules();

      expect(result.registered).toBe(1); // only the valid one
      expect(result.errors).toEqual([expect.stringMatching(/header/i)]);
      expect(registeredAbbreviations()).toEqual(['TESTBOOK']);
    });

    it('does not throw for a zero-byte file', () => {
      writeFileSync(join(modulesDir, 'book_empty.db'), Buffer.alloc(0));

      expect(() => detectAndRegisterModules()).not.toThrow();
      const result = detectAndRegisterModules();
      expect(result.registered).toBe(0);
    });
  });

  describe('format_version (new)', () => {
    it('skips and reports an unsupported format_version, without registering it', () => {
      makeBookModuleFile(join(modulesDir, 'book_future.db'), { formatVersion: '0.5' });

      const result = detectAndRegisterModules();

      expect(result.registered).toBe(0);
      expect(result.errors).toEqual([expect.stringMatching(/format_version/)]);
      expect(registeredAbbreviations()).toEqual([]);
    });

    it('still registers a legacy 2.0 module normally, not as unsupported', () => {
      makeBookModuleFile(join(modulesDir, 'book_legacy.db'), { formatVersion: '2.0' });

      const result = detectAndRegisterModules();

      expect(result.registered).toBe(1);
      expect(result.errors).toEqual([]);
      expect(registeredAbbreviations()).toEqual(['TESTBOOK']);
    });

    it('still registers the older readable minor 0.1', () => {
      makeBookModuleFile(join(modulesDir, 'book_older.db'), { formatVersion: '0.1' });

      const result = detectAndRegisterModules();

      expect(result.registered).toBe(1);
      expect(result.errors).toEqual([]);
    });
  });

  describe('module_uuid (unchanged, pre-existing check)', () => {
    it('still skips a module with no module_uuid', () => {
      makeBookModuleFile(join(modulesDir, 'book_nouuid.db'), { moduleUuid: null });

      const result = detectAndRegisterModules();

      expect(result.registered).toBe(0);
      expect(result.errors).toEqual([expect.stringMatching(/module_uuid/)]);
    });
  });
});
