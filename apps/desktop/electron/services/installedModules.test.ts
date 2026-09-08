import { describe, it, expect, vi, beforeEach } from 'vitest';

// `module_metadata` is a registry, not an inventory: a row survives its file
// being deleted or never arriving. These tests pin the rule that only rows
// backed by a real file are offered to a picker.

const existsSync = vi.fn<(path: string) => boolean>();
vi.mock('fs', () => {
  const existsSyncStub = (path: string): boolean => existsSync(path);
  return { existsSync: existsSyncStub, default: { existsSync: existsSyncStub } };
});

const warn = vi.fn();
vi.mock('electron-log', () => ({ default: { warn: (...args: unknown[]) => warn(...args) } }));

const getByType = vi.fn();
vi.mock('./sharedMainDb', () => ({
  getSharedModuleMetadataRepo: () => ({ getByType }),
}));

vi.mock('../utils/appPaths', () => ({
  resolveModulePath: (relative: string) => `/data/${relative}`,
}));

import { listInstalledModules } from './installedModules';

interface FakeModule {
  abbreviation: string;
  moduleName: string;
  databasePath: string;
  getAbbreviation: () => string;
}

function fakeModule(abbreviation: string, file: string): FakeModule {
  return {
    abbreviation,
    moduleName: abbreviation,
    databasePath: `modules/${file}`,
    getAbbreviation: () => abbreviation,
  };
}

describe('listInstalledModules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers only the modules whose database file is actually on disk', () => {
    getByType.mockReturnValue([
      fakeModule('Easton', 'dictionary_easton.db'),
      // The reported case: registered on this machine, never installed.
      fakeModule('Webster 1828', 'dictionary_webster1828.db'),
    ]);
    existsSync.mockImplementation((path: string) => path === '/data/modules/dictionary_easton.db');

    const result = listInstalledModules('dictionary');

    expect(result.map((m) => m.abbreviation)).toEqual(['Easton']);
  });

  // Each case below uses its own abbreviation: the "log it once" set is
  // module-level state, so reusing a name would suppress the very line the
  // next test is asserting on.
  it('names the missing module in the log so the registry can be repaired', () => {
    getByType.mockReturnValue([fakeModule('Never Installed', 'dictionary_never.db')]);
    existsSync.mockReturnValue(false);

    listInstalledModules('dictionary');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Never Installed'));
  });

  it('logs a given missing module once, not once per list request', () => {
    getByType.mockReturnValue([fakeModule('GoneAway', 'dictionary_goneaway.db')]);
    existsSync.mockReturnValue(false);

    listInstalledModules('dictionary');
    listInstalledModules('dictionary');
    listInstalledModules('dictionary');

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('picks a module back up once its file appears, without a restart', () => {
    getByType.mockReturnValue([fakeModule('Installed Later', 'dictionary_later.db')]);
    existsSync.mockReturnValue(false);
    expect(listInstalledModules('dictionary')).toHaveLength(0);

    existsSync.mockReturnValue(true);
    expect(listInstalledModules('dictionary')).toHaveLength(1);
  });
});
