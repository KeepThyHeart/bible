/**
 * `InstallationService.validateModuleForInstall` against the F5 module-file
 * rule table (task 0027, "Module Format v2", revision 2): the SQLite header,
 * `module_uuid`, `format_version` and `compression` checks all route through
 * the one shared `validateModuleFile()` in `@bible/core` now, rather than
 * being hand-checked here - these tests pin that routing from the outside,
 * against real module files on disk (not mocks), the same way
 * `initMainDatabase.test.ts` does.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ISql } from '@bible/core';

import { SqliteProvider } from '../../providers/SqliteProvider';
import { InstallationService } from '../InstallationService';

/**
 * These tests drive real SQLite, so they need the native binding compiled for
 * the Node.js ABI vitest runs under (see `initMainDatabase.test.ts`'s
 * identical comment). Skip rather than fail when it is not available.
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

/** A minimal but otherwise fully-conformant commentary module file. */
function makeModuleFile(
  dbPath: string,
  overrides: Partial<{
    moduleUuid: string | null;
    canon: string | null;
    versification: string | null;
    formatVersion: string | null;
    compression: string | null;
  }> = {}
): void {
  const values = {
    moduleUuid: VALID_UUID,
    canon: 'protestant-66',
    versification: 'kjv-english',
    formatVersion: '0.2',
    compression: 'none',
    ...overrides,
  };

  const db = new SqliteProvider(dbPath, { readonly: false });
  db.exec(`
    CREATE TABLE module_info (
      info_id INTEGER PRIMARY KEY,
      module_uuid TEXT,
      canon TEXT,
      versification TEXT,
      format_version TEXT,
      compression TEXT
    );
    CREATE TABLE verse_link (link_id INTEGER PRIMARY KEY);
    CREATE TABLE schema_version (version TEXT);
  `);
  db.execute(
    `INSERT INTO module_info (info_id, module_uuid, canon, versification, format_version, compression)
     VALUES (1, ?, ?, ?, ?, ?)`,
    [values.moduleUuid, values.canon, values.versification, values.formatVersion, values.compression]
  );
  db.close();
}

describe.skipIf(!nativeSqliteAvailable)('InstallationService.validateModuleForInstall', () => {
  let tmpDir: string;
  let dbPath: string;
  let service: InstallationService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bible-validate-install-'));
    dbPath = join(tmpDir, 'commentary_test.db');
    service = new InstallationService({} as unknown as ISql, join(tmpDir, 'modules'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a fully conformant module', () => {
    makeModuleFile(dbPath);

    const result = service.validateModuleForInstall(dbPath);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  describe('SQLite header (F5, new for this method to check standalone)', () => {
    it('refuses a file that does not begin with the SQLite header, before opening it as a database', () => {
      writeFileSync(dbPath, Buffer.from('not a database at all'));

      const result = service.validateModuleForInstall(dbPath);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([expect.stringMatching(/header/i)]);
      expect(result.warnings).toEqual([]);
    });

    it('refuses a truncated file shorter than the header itself', () => {
      writeFileSync(dbPath, Buffer.from('SQLite '));

      const result = service.validateModuleForInstall(dbPath);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([expect.stringMatching(/header/i)]);
    });
  });

  describe('module_uuid', () => {
    it('refuses a missing module_uuid', () => {
      makeModuleFile(dbPath, { moduleUuid: null });

      const result = service.validateModuleForInstall(dbPath);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([expect.stringMatching(/module_uuid/)]);
    });
  });

  describe('format_version (F5, new)', () => {
    it('refuses format_version 0.3 - a newer-looking but unlisted 0.x', () => {
      makeModuleFile(dbPath, { formatVersion: '0.3' });

      const result = service.validateModuleForInstall(dbPath);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([expect.stringMatching(/format_version/)]);
    });

    it('refuses format_version 1.0 - an unlisted major', () => {
      makeModuleFile(dbPath, { formatVersion: '1.0' });

      const result = service.validateModuleForInstall(dbPath);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([expect.stringMatching(/format_version/)]);
    });

    it('accepts format_version 2.0 - the legacy pre-0.x string - and installs normally', () => {
      makeModuleFile(dbPath, { formatVersion: '2.0' });

      const result = service.validateModuleForInstall(dbPath);

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts format_version 0.1, the older readable minor', () => {
      makeModuleFile(dbPath, { formatVersion: '0.1' });

      const result = service.validateModuleForInstall(dbPath);

      expect(result.ok).toBe(true);
    });
  });

  describe('compression / codec availability (F5, new - warning, not error)', () => {
    it('warns but still installs when compression names a codec this build has not got', () => {
      // 'brotli' is not a real codec this project implements at all (see
      // resolveModuleCodec.test.ts's identical choice), so this is true
      // regardless of which optional codecs (zstd) this Node build has -
      // unlike stubbing out zstd specifically, this does not depend on the
      // test machine's `node:zlib` capabilities.
      makeModuleFile(dbPath, { compression: 'brotli' });

      const result = service.validateModuleForInstall(dbPath);

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([expect.stringMatching(/compression.*brotli/)]);
    });

    it('has no compression issue at all for an uncompressed module', () => {
      makeModuleFile(dbPath, { compression: 'none' });

      const result = service.validateModuleForInstall(dbPath);

      expect(result.warnings).toEqual([]);
    });
  });

  describe('canon / versification (bespoke to this app, unchanged by F5)', () => {
    it('still refuses a wrong canon', () => {
      makeModuleFile(dbPath, { canon: 'other-canon' });

      const result = service.validateModuleForInstall(dbPath);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([expect.stringMatching(/canon/)]);
    });

    it('still refuses a wrong versification', () => {
      makeModuleFile(dbPath, { versification: 'other-scheme' });

      const result = service.validateModuleForInstall(dbPath);

      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([expect.stringMatching(/versification/)]);
    });
  });
});
