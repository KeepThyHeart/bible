/**
 * `module:timeline:getDataset`: probes for an installed timeline module, opens it
 * read-only, returns the whole module as one `TimelineDataset` (cached), and
 * answers `null` when none is installed. Electron and the path helpers are
 * mocked (same posture as the other handler tests); the database is a real
 * temp SQLite file built from the canonical Timeline schema.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
  app: { getPath: vi.fn(() => '/fake/userData'), isPackaged: false },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const paths = { data: '', modules: '' };
vi.mock('../../utils/appPaths', () => ({
  getDataPath: () => paths.data,
  getUserModulesPath: () => paths.modules,
  resolveModulePath: (p: string) => join(paths.data, p),
}));

// No main.db in this test: the registry lookup finds nothing, so the file probe is exercised.
vi.mock('../../services/installedModules', () => ({ listInstalledModules: vi.fn(() => []) }));
vi.mock('../../services/sharedMainDb', () => ({ getSharedModuleMetadataRepo: vi.fn() }));

import { loadSchemaSql } from '@bible/core';
import timelineMainModule from './module';
import { createModuleIpc } from '../moduleIpc';
import type { MainModuleDeps } from '../FeatureMainModule';
import { __resetModuleDatabaseRegistryForTests } from '../../services/ModuleDatabaseRegistry';

const nativeSqliteAvailable = ((): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3-multiple-ciphers');
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
})();

const deps: MainModuleDeps = { userDataPath: '/tmp/x', getWindows: () => [], log: { info() {}, warn() {}, error() {} } };
const fakeIpcMain = {
  handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void handlers.set(channel, fn),
  removeHandler: (channel: string) => void handlers.delete(channel),
};
const closeTimelineDb = () => timelineMainModule.close?.();

const SCHEMA = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'core', 'sql', 'schemas', 'initial', 'Timeline.sql');

function buildModule(file: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3-multiple-ciphers');
  const db = new Database(file);
  db.exec(loadSchemaSql(SCHEMA));
  db.exec(`
    INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name, format, license_spdx)
      VALUES (1, '00000000-0000-4000-8000-000000000002', 'timeline', 'TL', 'Test Timeline', 'timeline-module', 'CC-BY-4.0');
    INSERT INTO timeline_chronology VALUES ('ussher', 'Ussher', 'literal', NULL, 1, 0);
    INSERT INTO timeline_lane VALUES ('judah', 'Judah', NULL, 'judah', 0);
    INSERT INTO timeline_item (item_id, slug, kind, lane_id, title, reviewed_by) VALUES (1, 'a', 'reign', 'judah', 'A', NULL);
    INSERT INTO timeline_date (item_id, chronology_id, start_day, end_day, precision) VALUES (1, 'ussher', 1000, 2000, 'year');
    INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end, link_type) VALUES ('timeline_item', 1, 11001001, 11002000, 'primary_passage');
  `);
  db.close();
}

async function getDataset(): Promise<{ ok: boolean; value?: any; error?: any }> {
  const handler = handlers.get('module:timeline:getDataset');
  if (!handler) throw new Error('module:timeline:getDataset not registered');
  return (await handler({})) as any;
}

describe.skipIf(!nativeSqliteAvailable)('module:timeline:getDataset', () => {
  let tmpDir: string;

  beforeEach(() => {
    handlers.clear();
    __resetModuleDatabaseRegistryForTests();
    closeTimelineDb();
    tmpDir = mkdtempSync(join(tmpdir(), 'timeline-handlers-'));
    paths.data = tmpDir;
    paths.modules = join(tmpDir, 'modules-not-there');
    timelineMainModule.registerIpc(createModuleIpc('timeline', fakeIpcMain, deps), deps);
  });

  afterEach(() => {
    closeTimelineDb();
    __resetModuleDatabaseRegistryForTests();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers the channel', () => {
    expect(handlers.has('module:timeline:getDataset')).toBe(true);
  });

  it('answers null when no timeline module is installed', async () => {
    expect(await getDataset()).toEqual({ ok: true, value: null });
  });

  it('serves the dataset of a timeline*.db file in the data path, cached across calls', async () => {
    buildModule(join(tmpDir, 'timeline_ussher.db'));
    const first = await getDataset();
    expect(first.ok).toBe(true);
    expect(first.value.info).toMatchObject({ name: 'Test Timeline', abbreviation: 'TL' });
    expect(first.value.items).toHaveLength(1);
    expect(first.value.items[0].passages).toEqual([{ start: 11001001, end: 11002000, primary: true }]);

    rmSync(join(tmpDir, 'timeline_ussher.db'));
    const second = await getDataset();
    expect(second.value.items).toHaveLength(1);
  });

  it('skips a timeline*.db file that is not a timeline module', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3-multiple-ciphers');
    const junk = new Database(join(tmpDir, 'timeline_broken.db'));
    junk.exec('CREATE TABLE unrelated (x INTEGER)');
    junk.close();
    expect(await getDataset()).toEqual({ ok: true, value: null });
  });
});
