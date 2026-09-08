/**
 * Unit tests for `ModulePackService` - the study add-on pack importer that
 * unpacks a `.zip`/`.biblepack` archive of many `.db`/`.db.gz` module files
 * and installs each through a caller-supplied callback (normally the
 * existing conformance-gated `installModuleFromPath`).
 *
 * No Electron mocking is needed: `extractModulePack`/`installModulePack`
 * only touch `fs`, `path`, `crypto`, and `unzipper`. Fixture archives are
 * built by hand with a minimal STORE-method (uncompressed) ZIP writer -
 * `unzipper` is already a project dependency for *reading* archives, but
 * nothing in the repo writes them, and the task calls for not adding a
 * dependency just to generate test fixtures. STORE method sidesteps needing
 * a DEFLATE implementation while still exercising the exact code path
 * `unzipper` uses for real archives (verified directly against `unzipper`
 * before this suite was written).
 *
 * Threats exercised:
 *  - a multi-module archive installs every module
 *  - a mixed archive installs the good modules and reports the bad ones
 *    individually, without aborting the rest
 *  - zip-slip (`../` escape) entries are rejected, never written
 *  - non-module entries (readme, license) are skipped, never written
 *  - archive entry-count, per-file size, module-file-count, and total-size
 *    ceilings all trip as designed
 *  - the temp extraction directory is removed on both the success path and
 *    every failure path
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  extractModulePack,
  installModulePack,
  cleanupModulePack,
  isModulePackPath,
  ModulePackError,
  DEFAULT_MODULE_PACK_LIMITS,
  type ModulePackLimits,
} from '../ModulePackService';

// --- Minimal STORE-method ZIP writer (test-only) ---------------------------

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] as number;
    for (let j = 0; j < 8; j++) {
      // eslint-disable-next-line no-bitwise
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

interface ZipEntryInput {
  name: string;
  data: Buffer;
}

/** Build a valid, uncompressed (STORE method) ZIP archive from raw entries. */
function buildZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // method = store
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18); // compressed size
    localHeader.writeUInt32LE(size, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    const localRecord = Buffer.concat([localHeader, nameBuf, entry.data]);
    localParts.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // method
    centralHeader.writeUInt16LE(0, 12); // time
    centralHeader.writeUInt16LE(0x21, 14); // date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20); // compressed
    centralHeader.writeUInt32LE(size, 24); // uncompressed
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // offset of local header

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localSection = Buffer.concat(localParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirectory.length, 12); // size of central dir
  eocd.writeUInt32LE(localSection.length, 16); // offset of central dir
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localSection, centralDirectory, eocd]);
}

// --- Test fixtures ------------------------------------------------------

const dbContent = (label: string): Buffer => Buffer.from(`SQLite format 3\0-- fake module: ${label}`);

let tmpRoot: string;
let extractionRoot: string;
const writtenTempDirs: string[] = [];

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mps-'));
}

function writeZip(entries: ZipEntryInput[]): string {
  const dir = scratchDir();
  writtenTempDirs.push(dir);
  const zipPath = path.join(dir, 'pack.zip');
  fs.writeFileSync(zipPath, buildZip(entries));
  return zipPath;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-root-'));
  extractionRoot = path.join(tmpRoot, 'extraction-root');
});

afterEach(() => {
  for (const dir of writtenTempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (tmpRoot) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('isModulePackPath', () => {
  it('recognizes .zip and .biblepack, case-insensitively', () => {
    expect(isModulePackPath('foo.zip')).toBe(true);
    expect(isModulePackPath('FOO.ZIP')).toBe(true);
    expect(isModulePackPath('foo.biblepack')).toBe(true);
    expect(isModulePackPath('foo.db')).toBe(false);
    expect(isModulePackPath('foo.db.gz')).toBe(false);
  });
});

describe('extractModulePack', () => {
  it('extracts every .db/.db.gz entry, including nested folders', async () => {
    const zipPath = writeZip([
      { name: 'bible_kjv.db', data: dbContent('kjv') },
      { name: 'commentaries/commentary_mhc.db', data: dbContent('mhc') },
      { name: 'dictionaries/dictionary_strongs.db.gz', data: dbContent('strongs-gz') },
    ]);

    const result = await extractModulePack(zipPath, extractionRoot);
    writtenTempDirs.push(result.tempDir);

    expect(result.moduleFiles).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    const entryPaths = result.moduleFiles.map(f => f.entryPath).sort();
    expect(entryPaths).toEqual([
      'bible_kjv.db',
      'commentaries/commentary_mhc.db',
      'dictionaries/dictionary_strongs.db.gz',
    ]);
    for (const file of result.moduleFiles) {
      expect(fs.existsSync(file.extractedPath)).toBe(true);
      expect(fs.readFileSync(file.extractedPath).length).toBe(file.sizeBytes);
    }
  });

  it('skips non-module entries without writing them anywhere', async () => {
    const zipPath = writeZip([
      { name: 'bible_kjv.db', data: dbContent('kjv') },
      { name: 'README.txt', data: Buffer.from('read me') },
      { name: 'LICENSE.md', data: Buffer.from('license text') },
    ]);

    const result = await extractModulePack(zipPath, extractionRoot);
    writtenTempDirs.push(result.tempDir);

    expect(result.moduleFiles).toHaveLength(1);
    expect(result.skipped.map(s => s.entryPath).sort()).toEqual(['LICENSE.md', 'README.txt']);
    for (const skip of result.skipped) {
      expect(skip.reason).toMatch(/not a module file/i);
    }
    // Nothing was written to disk for the skipped entries.
    const walked: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else walked.push(entry.name);
      }
    };
    walk(result.tempDir);
    expect(walked).toEqual(['bible_kjv.db']);
  });

  it('rejects a zip-slip entry (path escaping the extraction root)', async () => {
    const zipPath = writeZip([
      { name: 'bible_kjv.db', data: dbContent('kjv') },
      { name: '../../evil.db', data: Buffer.from('malicious payload') },
    ]);

    const result = await extractModulePack(zipPath, extractionRoot);
    writtenTempDirs.push(result.tempDir);

    expect(result.moduleFiles).toHaveLength(1);
    expect(result.moduleFiles[0]!.entryPath).toBe('bible_kjv.db');
    const slipSkip = result.skipped.find(s => s.entryPath === '../../evil.db');
    expect(slipSkip).toBeDefined();
    expect(slipSkip!.reason).toMatch(/escapes the archive root/i);

    // Confirm nothing was written outside the extraction root.
    expect(fs.existsSync(path.join(tmpRoot, 'evil.db'))).toBe(false);
    expect(fs.existsSync(path.join(os.tmpdir(), 'evil.db'))).toBe(false);
  });

  it('throws not_found for a missing archive path', async () => {
    await expect(
      extractModulePack(path.join(tmpRoot, 'does-not-exist.zip'), extractionRoot)
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  describe('ceilings', () => {
    it('rejects the whole archive when the entry count exceeds the limit', async () => {
      const zipPath = writeZip([
        { name: 'a.db', data: dbContent('a') },
        { name: 'b.db', data: dbContent('b') },
        { name: 'c.db', data: dbContent('c') },
      ]);
      const limits: ModulePackLimits = { ...DEFAULT_MODULE_PACK_LIMITS, maxArchiveEntries: 2 };

      let caught: unknown;
      try {
        await extractModulePack(zipPath, extractionRoot, limits);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ModulePackError);
      expect((caught as ModulePackError).code).toBe('too_many_entries');

      // Nothing left behind: the tempDir this attempt created must be gone.
      const leftoverDirs = fs.existsSync(extractionRoot) ? fs.readdirSync(extractionRoot) : [];
      expect(leftoverDirs).toHaveLength(0);
    });

    it('skips (but does not abort) entries beyond the per-file size limit', async () => {
      const zipPath = writeZip([
        { name: 'small.db', data: Buffer.from('x'.repeat(5)) },
        { name: 'big.db', data: Buffer.from('y'.repeat(50)) },
      ]);
      const limits: ModulePackLimits = { ...DEFAULT_MODULE_PACK_LIMITS, maxEntryBytes: 10 };

      const result = await extractModulePack(zipPath, extractionRoot, limits);
      writtenTempDirs.push(result.tempDir);

      expect(result.moduleFiles.map(f => f.entryPath)).toEqual(['small.db']);
      const bigSkip = result.skipped.find(s => s.entryPath === 'big.db');
      expect(bigSkip).toBeDefined();
      expect(bigSkip!.reason).toMatch(/per-file size limit/i);
    });

    it('skips (but does not abort) module files beyond the module-file-count limit', async () => {
      const zipPath = writeZip([
        { name: 'a.db', data: dbContent('a') },
        { name: 'b.db', data: dbContent('b') },
        { name: 'c.db', data: dbContent('c') },
      ]);
      const limits: ModulePackLimits = { ...DEFAULT_MODULE_PACK_LIMITS, maxModuleFiles: 1 };

      const result = await extractModulePack(zipPath, extractionRoot, limits);
      writtenTempDirs.push(result.tempDir);

      expect(result.moduleFiles).toHaveLength(1);
      expect(result.skipped).toHaveLength(2);
      for (const skip of result.skipped) {
        expect(skip.reason).toMatch(/module-file limit/i);
      }
    });

    it('rejects the whole archive when the cumulative declared size exceeds the total limit', async () => {
      const zipPath = writeZip([
        { name: 'a.db', data: Buffer.from('x'.repeat(10)) },
        { name: 'b.db', data: Buffer.from('y'.repeat(10)) },
      ]);
      const limits: ModulePackLimits = { ...DEFAULT_MODULE_PACK_LIMITS, maxTotalBytes: 15 };

      let caught: unknown;
      try {
        await extractModulePack(zipPath, extractionRoot, limits);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ModulePackError);
      expect((caught as ModulePackError).code).toBe('archive_too_large');

      const leftoverDirs = fs.existsSync(extractionRoot) ? fs.readdirSync(extractionRoot) : [];
      expect(leftoverDirs).toHaveLength(0);
    });
  });
});

describe('installModulePack', () => {
  it('installs every module file in a clean multi-module archive', async () => {
    const zipPath = writeZip([
      { name: 'bible_kjv.db', data: dbContent('kjv') },
      { name: 'commentary_mhc.db', data: dbContent('mhc') },
      { name: 'dictionary_strongs.db', data: dbContent('strongs') },
    ]);

    const installOne = async (filePath: string): Promise<{ moduleName?: string; overwritten?: boolean }> => {
      return { moduleName: path.basename(filePath, '.db'), overwritten: false };
    };

    const summary = await installModulePack(zipPath, extractionRoot, installOne);

    expect(summary.found).toBe(3);
    expect(summary.installed).toHaveLength(3);
    expect(summary.failed).toHaveLength(0);
    expect(summary.installed.map(i => i.moduleName).sort()).toEqual([
      'bible_kjv',
      'commentary_mhc',
      'dictionary_strongs',
    ]);
  });

  it('installs the good modules and reports the bad ones individually — does not abort the batch', async () => {
    const zipPath = writeZip([
      { name: 'good_one.db', data: dbContent('good1') },
      { name: 'bad_conformance.db', data: dbContent('bad1') },
      { name: 'good_two.db', data: dbContent('good2') },
      { name: 'bad_duplicate.db', data: dbContent('bad2') },
    ]);

    const installOne = async (filePath: string): Promise<{ moduleName?: string; overwritten?: boolean }> => {
      if (filePath.includes('bad_conformance')) {
        throw new Error('Module failed conformance validation: canon mismatch');
      }
      if (filePath.includes('bad_duplicate')) {
        throw new Error('Module "X" (X) is already installed');
      }
      return { moduleName: path.basename(filePath, '.db'), overwritten: false };
    };

    const summary = await installModulePack(zipPath, extractionRoot, installOne);

    expect(summary.found).toBe(4);
    expect(summary.installed).toHaveLength(2);
    expect(summary.failed).toHaveLength(2);
    expect(summary.installed.map(i => i.moduleName).sort()).toEqual(['good_one', 'good_two']);
    const failedEntries = summary.failed.map(f => f.entryPath).sort();
    expect(failedEntries).toEqual(['bad_conformance.db', 'bad_duplicate.db']);
    const conformanceFailure = summary.failed.find(f => f.entryPath === 'bad_conformance.db');
    expect(conformanceFailure!.reason).toMatch(/conformance validation/i);
  });

  it('reports skipped entries (non-module, zip-slip) alongside install outcomes', async () => {
    const zipPath = writeZip([
      { name: 'good.db', data: dbContent('good') },
      { name: 'readme.txt', data: Buffer.from('hi') },
      { name: '../escape.db', data: Buffer.from('nope') },
    ]);

    const installOne = async (filePath: string): Promise<{ moduleName?: string; overwritten?: boolean }> => {
      return { moduleName: path.basename(filePath, '.db'), overwritten: false };
    };

    const summary = await installModulePack(zipPath, extractionRoot, installOne);

    expect(summary.installed).toHaveLength(1);
    expect(summary.skipped.map(s => s.entryPath).sort()).toEqual(['../escape.db', 'readme.txt']);
  });

  it('cleans up the temp extraction directory on success', async () => {
    const zipPath = writeZip([{ name: 'a.db', data: dbContent('a') }]);
    const installOne = async (): Promise<{ moduleName?: string }> => ({ moduleName: 'a' });

    await installModulePack(zipPath, extractionRoot, installOne);

    const leftover = fs.existsSync(extractionRoot) ? fs.readdirSync(extractionRoot) : [];
    expect(leftover).toHaveLength(0);
  });

  it('cleans up the temp extraction directory when every module fails to install', async () => {
    const zipPath = writeZip([{ name: 'a.db', data: dbContent('a') }]);
    const installOne = async (): Promise<{ moduleName?: string }> => {
      throw new Error('boom');
    };

    const summary = await installModulePack(zipPath, extractionRoot, installOne);
    expect(summary.failed).toHaveLength(1);

    const leftover = fs.existsSync(extractionRoot) ? fs.readdirSync(extractionRoot) : [];
    expect(leftover).toHaveLength(0);
  });

  it('cleans up the temp extraction directory when extraction itself fails (ceiling violation)', async () => {
    const zipPath = writeZip([
      { name: 'a.db', data: Buffer.from('x'.repeat(10)) },
      { name: 'b.db', data: Buffer.from('y'.repeat(10)) },
    ]);
    const limits: ModulePackLimits = { ...DEFAULT_MODULE_PACK_LIMITS, maxTotalBytes: 15 };
    const installOne = async (): Promise<{ moduleName?: string }> => ({ moduleName: 'unused' });

    await expect(installModulePack(zipPath, extractionRoot, installOne, limits)).rejects.toBeInstanceOf(ModulePackError);

    const leftover = fs.existsSync(extractionRoot) ? fs.readdirSync(extractionRoot) : [];
    expect(leftover).toHaveLength(0);
  });
});

describe('cleanupModulePack', () => {
  it('removes an existing temp directory', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'cleanup-'));
    fs.writeFileSync(path.join(dir, 'file.db'), 'content');
    expect(fs.existsSync(dir)).toBe(true);

    cleanupModulePack(dir);

    expect(fs.existsSync(dir)).toBe(false);
  });

  it('is a no-op (does not throw) for a directory that does not exist', () => {
    const dir = path.join(tmpRoot, 'never-existed');
    expect(() => cleanupModulePack(dir)).not.toThrow();
  });
});
