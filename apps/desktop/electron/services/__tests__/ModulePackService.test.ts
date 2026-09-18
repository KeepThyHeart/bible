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
import { createHash, sign } from 'crypto';

import {
  extractModulePack,
  installModulePack,
  inspectModulePack,
  cleanupModulePack,
  isModulePackPath,
  ModulePackError,
  DEFAULT_MODULE_PACK_LIMITS,
  type ModulePackLimits,
  type ModulePackTrustOptions,
} from '../ModulePackService';
import { PACK_MANIFEST_FORMAT, packManifestDigest, type PackManifest, type PackManifestModuleEntry } from '../ModulePackSignature';
import { makeKey, type TestKey } from './catalogSigningTestHelpers';

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

/**
 * Pack trust gate: `pack.json` + `pack.json.sig` verification, and the
 * manifest/archive cross-check once a pack verifies. There is no
 * `isBiblePackPath` any more (see `ModulePackService.ts`'s module doc
 * comment) - the gate is driven entirely by `ModulePackTrustOptions`, which
 * every real caller passes for any pack archive regardless of extension.
 * These fixtures use `writeZip`'s fixed `.zip` filename throughout (there is
 * nothing `.biblepack`-specific to test at this layer any more), which is
 * itself evidence the gate no longer cares what the file is named.
 *
 * Uses real Ed25519 keys (`catalogSigningTestHelpers`) - the same helper the
 * catalog-signature tests use - and the real `buildZip` writer above, so
 * these exercise the exact code path a genuine pack archive would.
 */
describe('trust gate (pack archives, regardless of extension)', () => {
  function sha256Hex(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  function manifestFor(modules: Array<{ name: string; data: Buffer }>): PackManifest {
    return {
      format: PACK_MANIFEST_FORMAT,
      pack_id: 'test-pack',
      name: 'Test pack',
      version: '1.0.0',
      languages: ['en'],
      modules: modules.map(
        ({ name, data }): PackManifestModuleEntry => ({
          path: name,
          sha256: sha256Hex(data),
          size_bytes: data.length,
        })
      ),
    };
  }

  function signManifest(bytes: Buffer, key: TestKey): Buffer {
    const digest = packManifestDigest(bytes);
    return Buffer.from(
      JSON.stringify({
        publicKey: key.publicKeyHex,
        signature: sign(null, digest, key.privateKey).toString('hex'),
        algorithm: 'ed25519-sha256',
      })
    );
  }

  /** Build a `.biblepack`-shaped zip: the given modules, plus pack.json (and, if `key` is given, pack.json.sig). */
  function writePackArchive(
    modules: Array<{ name: string; data: Buffer }>,
    options: { key?: TestKey; manifestOverride?: PackManifest } = {}
  ): string {
    const manifest = options.manifestOverride ?? manifestFor(modules);
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const entries = [
      ...modules.map((m) => ({ name: m.name, data: m.data })),
      { name: 'pack.json', data: manifestBytes },
    ];
    if (options.key) {
      entries.push({ name: 'pack.json.sig', data: signManifest(manifestBytes, options.key) });
    }
    return writeZip(entries);
  }

  it('installs, reporting `verified`, when every file matches a manifest signed by a trusted key', async () => {
    const key = makeKey();
    const modules = [{ name: 'kjv.db', data: dbContent('kjv') }];
    const packPath = writePackArchive(modules, { key });
    const trust: ModulePackTrustOptions = { trustedKeys: [key.publicKeyHex] };

    const result = await extractModulePack(packPath, extractionRoot, DEFAULT_MODULE_PACK_LIMITS, trust);
    writtenTempDirs.push(result.tempDir);

    expect(result.packVerification?.status).toBe('verified');
    expect(result.moduleFiles.map((f) => f.entryPath)).toEqual(['kjv.db']);
  });

  it('refuses (pack_tampered) when a verified pack has a modified file, and installs nothing', async () => {
    const key = makeKey();
    const modules = [{ name: 'kjv.db', data: dbContent('kjv') }];
    const manifest = manifestFor(modules);
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const packPath = writeZip([
      { name: 'kjv.db', data: dbContent('TAMPERED') }, // does not match the manifest's hash/size
      { name: 'pack.json', data: manifestBytes },
      { name: 'pack.json.sig', data: signManifest(manifestBytes, key) },
    ]);
    const trust: ModulePackTrustOptions = { trustedKeys: [key.publicKeyHex] };
    const installOne = async (): Promise<{ moduleName?: string }> => ({ moduleName: 'should-not-install' });

    let caught: unknown;
    try {
      await installModulePack(packPath, extractionRoot, installOne, DEFAULT_MODULE_PACK_LIMITS, trust);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModulePackError);
    expect((caught as ModulePackError).code).toBe('pack_tampered');
    const leftover = fs.existsSync(extractionRoot) ? fs.readdirSync(extractionRoot) : [];
    expect(leftover).toHaveLength(0);
  });

  it('refuses (pack_tampered) an extra .db entry the verified manifest does not list', async () => {
    const key = makeKey();
    const listed = [{ name: 'kjv.db', data: dbContent('kjv') }];
    const manifest = manifestFor(listed);
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const packPath = writeZip([
      { name: 'kjv.db', data: dbContent('kjv') },
      { name: 'sneaky.db', data: dbContent('sneaky') }, // not in the manifest
      { name: 'pack.json', data: manifestBytes },
      { name: 'pack.json.sig', data: signManifest(manifestBytes, key) },
    ]);
    const trust: ModulePackTrustOptions = { trustedKeys: [key.publicKeyHex] };

    let caught: unknown;
    try {
      await extractModulePack(packPath, extractionRoot, DEFAULT_MODULE_PACK_LIMITS, trust);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModulePackError);
    expect((caught as ModulePackError).code).toBe('pack_tampered');
  });

  it('refuses (pack_tampered) when the verified manifest lists a file that never shows up', async () => {
    const key = makeKey();
    const present = [{ name: 'kjv.db', data: dbContent('kjv') }];
    const manifest = manifestFor([...present, { name: 'missing.db', data: dbContent('missing') }]);
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const packPath = writeZip([
      { name: 'kjv.db', data: dbContent('kjv') }, // missing.db never included
      { name: 'pack.json', data: manifestBytes },
      { name: 'pack.json.sig', data: signManifest(manifestBytes, key) },
    ]);
    const trust: ModulePackTrustOptions = { trustedKeys: [key.publicKeyHex] };

    let caught: unknown;
    try {
      await extractModulePack(packPath, extractionRoot, DEFAULT_MODULE_PACK_LIMITS, trust);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModulePackError);
    expect((caught as ModulePackError).code).toBe('pack_tampered');
  });

  it('refuses (pack_unverified) an unsigned pack when acceptUnverified is not set, installing nothing', async () => {
    const modules = [{ name: 'kjv.db', data: dbContent('kjv') }];
    const packPath = writePackArchive(modules); // no key -> no pack.json.sig
    const trust: ModulePackTrustOptions = { trustedKeys: [makeKey().publicKeyHex] };
    const installOne = async (): Promise<{ moduleName?: string }> => ({ moduleName: 'should-not-install' });

    let caught: unknown;
    try {
      await installModulePack(packPath, extractionRoot, installOne, DEFAULT_MODULE_PACK_LIMITS, trust);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModulePackError);
    expect((caught as ModulePackError).code).toBe('pack_unverified');
  });

  it('installs an unsigned pack when acceptUnverified is true', async () => {
    const modules = [{ name: 'kjv.db', data: dbContent('kjv') }];
    const packPath = writePackArchive(modules);
    const trust: ModulePackTrustOptions = { trustedKeys: [makeKey().publicKeyHex], acceptUnverified: true };
    const installOne = async (filePath: string): Promise<{ moduleName?: string }> => ({
      moduleName: path.basename(filePath, '.db'),
    });

    const summary = await installModulePack(packPath, extractionRoot, installOne, DEFAULT_MODULE_PACK_LIMITS, trust);

    expect(summary.installed.map((i) => i.moduleName)).toEqual(['kjv']);
    expect(summary.packVerification?.status).toBe('unsigned');
  });

  it('refuses (pack_unverified) a pack signed only by an untrusted key, unless accepted', async () => {
    const untrustedKey = makeKey();
    const modules = [{ name: 'kjv.db', data: dbContent('kjv') }];
    const packPath = writePackArchive(modules, { key: untrustedKey });
    const trust: ModulePackTrustOptions = { trustedKeys: [makeKey().publicKeyHex] };

    let caught: unknown;
    try {
      await extractModulePack(packPath, extractionRoot, DEFAULT_MODULE_PACK_LIMITS, trust);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModulePackError);
    expect((caught as ModulePackError).code).toBe('pack_unverified');
  });

  it('refuses (pack_signature_invalid) a pack.json.sig that does not verify, with no override', async () => {
    const key = makeKey();
    const modules = [{ name: 'kjv.db', data: dbContent('kjv') }];
    const manifest = manifestFor(modules);
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const sigDoc = JSON.parse(signManifest(manifestBytes, key).toString('utf-8'));
    sigDoc.signature = 'f'.repeat(128); // corrupt
    const packPath = writeZip([
      { name: 'kjv.db', data: dbContent('kjv') },
      { name: 'pack.json', data: manifestBytes },
      { name: 'pack.json.sig', data: Buffer.from(JSON.stringify(sigDoc)) },
    ]);
    // Even with acceptUnverified: true, an invalid signature has no override.
    const trust: ModulePackTrustOptions = { trustedKeys: [key.publicKeyHex], acceptUnverified: true };

    let caught: unknown;
    try {
      await extractModulePack(packPath, extractionRoot, DEFAULT_MODULE_PACK_LIMITS, trust);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModulePackError);
    expect((caught as ModulePackError).code).toBe('pack_signature_invalid');
  });

  it('is unaffected on a plain .zip with no trust options passed (unchanged behaviour)', async () => {
    const zipPath = writeZip([{ name: 'kjv.db', data: dbContent('kjv') }]);
    const result = await extractModulePack(zipPath, extractionRoot); // no `trust` argument at all
    writtenTempDirs.push(result.tempDir);
    expect(result.packVerification).toBeUndefined();
    expect(result.moduleFiles).toHaveLength(1);
  });
});

describe('inspectModulePack', () => {
  it('reports a manifest summary without installing or extracting anything', async () => {
    const key = makeKey();
    const modules = [
      { name: 'kjv.db', data: Buffer.from('a'.repeat(100)) },
      { name: 'mhc.db', data: Buffer.from('b'.repeat(50)) },
    ];
    const manifest: PackManifest = {
      format: PACK_MANIFEST_FORMAT,
      pack_id: 'test-pack',
      name: 'Test pack',
      version: '1.0.0',
      languages: ['en'],
      modules: modules.map((m) => ({ path: m.name, sha256: createHash('sha256').update(m.data).digest('hex'), size_bytes: m.data.length })),
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const digest = packManifestDigest(manifestBytes);
    const sigDoc = Buffer.from(
      JSON.stringify({ publicKey: key.publicKeyHex, signature: sign(null, digest, key.privateKey).toString('hex'), algorithm: 'ed25519-sha256' })
    );
    const packPath = writeZip([
      ...modules,
      { name: 'pack.json', data: manifestBytes },
      { name: 'pack.json.sig', data: sigDoc },
    ]);

    const result = await inspectModulePack(packPath, [key.publicKeyHex]);

    expect(result.status).toBe('verified');
    expect(result.moduleCount).toBe(2);
    expect(result.totalBytes).toBe(150);

    // Nothing was extracted anywhere - inspect never writes module files.
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
