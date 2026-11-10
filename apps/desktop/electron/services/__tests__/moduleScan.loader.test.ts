/**
 * The startup module scan and the module loaders.
 *
 * Regression: a reader that asked for its Bible (the restored KJV tab) before
 * the startup scan had registered `bible_kjv.db` got "Bible not found", and
 * the loader remembered that miss for 30 s. The desktop loader now waits out a
 * running scan before reporting a miss, and a module the scan (or an install)
 * registers is evicted from every loader so an older miss is forgotten.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const registry = new Map<string, { moduleType: string; databasePath: string; abbreviation: string }>();

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../sharedMainDb', () => ({
  getSharedModuleMetadataRepo: () => ({
    getByAbbreviation: (abbreviation: string) => registry.get(abbreviation),
  }),
}));
// Every module path resolves to one real (empty) file, so the loader's
// "file exists" check passes; the connection itself is a fake below.
const moduleFile = vi.hoisted(() => {
  const { mkdtempSync, writeFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const { tmpdir } = require('os') as typeof import('os');
  const file = join(mkdtempSync(join(tmpdir(), 'module-scan-')), 'book_kjv.db');
  writeFileSync(file, '');
  return file;
});
vi.mock('../../utils/appPaths', () => ({ resolveModulePath: () => moduleFile }));

const fakeSql = {
  queryOne: vi.fn(() => undefined),
  queryAll: vi.fn(() => []),
  execute: vi.fn(() => ({ changes: 0, lastInsertRowId: 0 })),
  exec: vi.fn(),
  transaction: (cb: () => unknown) => cb(),
  close: vi.fn(),
  isOpen: () => true,
};
vi.mock('../ModuleDatabaseRegistry', () => ({
  createRegistrySqlFactory: () => ({ create: () => fakeSql }),
  getModuleDatabaseRegistry: () => ({ close: vi.fn() }),
}));

import { ModuleLoader } from '../ModuleLoader';
import { runModuleScan, whenModuleScanSettled, isModuleScanRunning, resetModuleScanForTests } from '../moduleScan';

const KJV = { moduleType: 'book', databasePath: 'modules/book_kjv.db', abbreviation: 'KJV' };

describe('module loaders and the startup scan', () => {
  beforeEach(() => {
    registry.clear();
    resetModuleScanForTests();
  });

  it('a lookup during the scan waits for it, instead of reporting a module the scan has not reached yet', async () => {
    const loader = new ModuleLoader('book', 'book');
    let finishScan!: () => void;
    const scanned = new Promise<void>((resolve) => { finishScan = resolve; });

    void runModuleScan(async () => {
      await scanned;
      registry.set('KJV', KJV); // the scan reaches bible_kjv.db and registers it
      return { registeredModules: [{ abbreviation: 'KJV', moduleType: 'book' }] };
    }, () => undefined);
    expect(isModuleScanRunning()).toBe(true);

    const lookup = loader.ensure('KJV');
    finishScan();

    await expect(lookup).resolves.not.toBeNull();
    expect(isModuleScanRunning()).toBe(false);
  });

  it('without a scan, a miss is still a miss (and is remembered)', async () => {
    const loader = new ModuleLoader('book', 'book');
    await expect(loader.ensure('KJV')).resolves.toBeNull();
    registry.set('KJV', KJV);
    // The core loader's negative cache still answers for 30 s ...
    await expect(loader.ensure('KJV')).resolves.toBeNull();
    // ... until the module is announced as registered, which is what the scan
    // and InstallationService now do.
    ModuleLoader.evictEverywhere('KJV');
    await expect(loader.ensure('KJV')).resolves.not.toBeNull();
  });

  it('runs the finish hook before anything awaiting the scan resumes, and never rejects', async () => {
    const order: string[] = [];
    void runModuleScan(async () => ({ registeredModules: [] }), () => order.push('finished'));
    await whenModuleScanSettled().then(() => order.push('awaiter'));
    expect(order).toEqual(['finished', 'awaiter']);

    void runModuleScan(async () => { throw new Error('disk gone'); }, () => order.push('not called'));
    await expect(whenModuleScanSettled()).resolves.toBeUndefined();
    expect(order).toEqual(['finished', 'awaiter']);
  });
});
