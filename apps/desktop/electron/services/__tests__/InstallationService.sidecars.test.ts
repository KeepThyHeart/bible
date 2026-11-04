/**
 * Installing a module must not leave the downloads folder's SQLite sidecar
 * files (-wal/-shm/-journal) behind: the validation step opens the file at its
 * download path, and the rename into the modules folder moves only the .db.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ISql } from '@bible/core';

vi.mock('../runValidationInWorker', () => ({
  runValidationInWorker: vi.fn().mockResolvedValue({ ok: true, errors: [], warnings: [] }),
}));

import { InstallationService } from '../InstallationService';

describe('InstallationService - sidecar files after install (new minor bug)', () => {
  let root: string;
  let service: InstallationService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-sidecar-'));
    fs.mkdirSync(path.join(root, 'downloads'));
    service = new InstallationService({} as unknown as ISql, path.join(root, 'modules'));
    vi.spyOn(service, 'verifyModule').mockResolvedValue(true);
    vi.spyOn(service, 'registerModule').mockResolvedValue(7);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes -wal, -shm and -journal left next to the downloaded file', async () => {
    const dbPath = path.join(root, 'downloads', 'bible_test_v1.0.db');
    fs.writeFileSync(dbPath, 'module bytes');
    for (const ext of ['-wal', '-shm', '-journal']) fs.writeFileSync(dbPath + ext, 'x');

    const result = await service.installModule(dbPath, {
      moduleType: 'bible' as const,
      moduleName: 'Test',
      abbreviation: 'TEST',
      moduleUuid: '00000000-0000-0000-0000-000000000001',
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(false);
    for (const ext of ['-wal', '-shm', '-journal']) expect(fs.existsSync(dbPath + ext)).toBe(false);
  });
});
