/**
 * `InstallationService.installModule` checking a download against its catalog
 * before anything opens it.
 *
 * The catalog's checksum covers the unpacked module, so the file is unpacked
 * (with the catalog's size as a ceiling), hashed, and only then handed to the
 * module checks - which is where SQLite first touches it. `verifyModule` is
 * spied on, so none of this needs a real module or the native SQLite binding.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import type { ISql } from '@bible/core';

import { InstallationService } from '../InstallationService';

const MODULE_INFO = { moduleType: 'commentary' as const, moduleName: 'Test', abbreviation: 'TEST' };

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('InstallationService - verifying a download before opening it', () => {
  let root: string;
  let gzPath: string;
  let dbPath: string;
  let service: InstallationService;
  let verifyModule: MockInstance<(dbPath: string) => Promise<boolean>>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-install-'));
    fs.mkdirSync(path.join(root, 'downloads'));
    gzPath = path.join(root, 'downloads', 'commentary_test_v1.0.db.gz');
    dbPath = gzPath.replace(/\.gz$/, '');
    service = new InstallationService({} as unknown as ISql, path.join(root, 'modules'));
    verifyModule = vi.spyOn(service, 'verifyModule').mockResolvedValue(false);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('discards a download that does not match the catalog, without opening it', async () => {
    fs.writeFileSync(gzPath, gzipSync(Buffer.from('not the module the catalog signed')));

    const result = await service.installModule(gzPath, MODULE_INFO, { sha256: 'ab'.repeat(32), maxBytes: 1_000 });

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Checksum verification failed/) });
    expect(verifyModule).not.toHaveBeenCalled();
    expect(fs.existsSync(gzPath)).toBe(false);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('stops unpacking at the size the catalog declares', async () => {
    const inflated = Buffer.alloc(100_000);
    fs.writeFileSync(gzPath, gzipSync(inflated));

    const result = await service.installModule(gzPath, MODULE_INFO, { sha256: sha256(inflated), maxBytes: 1_000 });

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/more than the 1000 bytes/) });
    expect(verifyModule).not.toHaveBeenCalled();
    expect(fs.existsSync(gzPath)).toBe(false);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('hands a matching download on to the module checks', async () => {
    const module = Buffer.from('bytes the catalog signed');
    fs.writeFileSync(gzPath, gzipSync(module));

    const result = await service.installModule(gzPath, MODULE_INFO, { sha256: sha256(module), maxBytes: 1_000 });

    // The stubbed format check refuses it - what matters is that it got that far.
    expect(result).toMatchObject({ success: false, error: 'Module verification failed' });
    expect(verifyModule).toHaveBeenCalledWith(dbPath);
  });

  it('never deletes a file the user supplied, even one that will not unpack', async () => {
    fs.writeFileSync(gzPath, 'this is not gzip');

    const result = await service.installModule(gzPath, MODULE_INFO);

    expect(result.success).toBe(false);
    expect(fs.existsSync(gzPath)).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});
