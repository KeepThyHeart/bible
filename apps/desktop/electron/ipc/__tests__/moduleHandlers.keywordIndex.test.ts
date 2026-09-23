/**
 * The three keyword-index IPC handlers (F8, task 0027 revision 2, design doc
 * §5.3): `module:get-keyword-index-status`, `module:rebuild-keyword-index`,
 * `module:delete-keyword-index`. Every heavy service `initializeModuleManager()`
 * would otherwise construct is mocked (same posture as
 * `moduleHandlers.installFromFile.test.ts`), so this exercises only the IPC
 * handlers' own orchestration: argument validation, delegating to
 * `KeywordIndexService`, and the `not_found` mapping when a handler's own
 * service method reports "no such module" by returning `undefined`.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn(), showErrorBox: vi.fn() },
  app: { getPath: vi.fn(() => '/fake/userData'), isPackaged: false },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/appPaths', () => ({
  getBundledMainDbPath: () => '/fake/bundled.db',
  getUserDataPath: () => '/fake/userData',
  getUserModulesPath: () => '/fake/modules',
  resolveMainDbPath: () => '/fake/main.db',
}));

vi.mock('../../utils/initMainDatabase', () => ({
  initializeMainDatabase: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock('../../services/DownloadService', () => ({
  DownloadService: vi.fn().mockImplementation(function () { return {
    onProgress: vi.fn(),
    onError: vi.fn(),
  }; }),
}));

vi.mock('../../services/InstallationService', () => ({
  InstallationService: vi.fn().mockImplementation(function () { return {}; }),
}));

vi.mock('../../services/ModuleCatalogService', () => ({
  ModuleCatalogService: vi.fn().mockImplementation(function () { return {}; }),
}));

vi.mock('../../services/ApprovedCatalogKeys', () => ({
  FileApprovedCatalogKeyStore: vi.fn().mockImplementation(function () { return { list: () => [] }; }),
}));

// The service under test: a mock instance recorded here so each test can set
// its return values and assert on its calls.
const keywordIndexServiceInstance = {
  getStatusForModule: vi.fn(),
  rebuildForModule: vi.fn(),
  deleteIndexForModule: vi.fn(),
};
vi.mock('../../services/KeywordIndexService', () => ({
  KeywordIndexService: vi.fn().mockImplementation(function () { return keywordIndexServiceInstance; }),
}));

vi.mock('@bible/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bible/core')>();
  return {
    ...actual,
    ModuleController: vi.fn().mockImplementation(function () { return {
      getInstalledModules: () => [],
    }; }),
    ModuleCatalogController: vi.fn().mockImplementation(function () { return {}; }),
    ModuleMetadataRepository: vi.fn().mockImplementation(function () { return {}; }),
    DownloadQueueRepository: vi.fn().mockImplementation(function () { return {}; }),
  };
});

async function invoke<T>(channel: string, ...args: unknown[]): Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return (await fn({}, ...args)) as { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
}

describe('keyword-index IPC handlers', () => {
  beforeAll(async () => {
    const { registerModuleHandlers } = await import('../moduleHandlers');
    registerModuleHandlers({} as never);
  });

  beforeEach(() => {
    keywordIndexServiceInstance.getStatusForModule.mockReset();
    keywordIndexServiceInstance.rebuildForModule.mockReset();
    keywordIndexServiceInstance.deleteIndexForModule.mockReset();
  });

  describe('module:get-keyword-index-status', () => {
    it('returns the status the service reports', async () => {
      keywordIndexServiceInstance.getStatusForModule.mockReturnValue({
        moduleUuid: 'uuid-1', providerId: 'sidecar-fts5', state: 'ready', docCount: 42,
      });

      const result = await invoke<{ state: string; docCount: number }>('module:get-keyword-index-status', 7);

      expect(keywordIndexServiceInstance.getStatusForModule).toHaveBeenCalledWith(7);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('ready');
        expect(result.value.docCount).toBe(42);
      }
    });

    it('reports not_found when the service returns undefined (no such module)', async () => {
      keywordIndexServiceInstance.getStatusForModule.mockReturnValue(undefined);

      const result = await invoke('module:get-keyword-index-status', 999);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('not_found');
    });

    it('rejects a non-positive-integer moduleId before ever calling the service', async () => {
      const result = await invoke('module:get-keyword-index-status', -1);

      expect(result.ok).toBe(false);
      expect(keywordIndexServiceInstance.getStatusForModule).not.toHaveBeenCalled();
    });
  });

  describe('module:rebuild-keyword-index', () => {
    it('awaits the service and returns its resulting status, even for a failed build', async () => {
      keywordIndexServiceInstance.rebuildForModule.mockResolvedValue({
        moduleUuid: 'uuid-1', providerId: 'sidecar-fts5', state: 'failed', error: 'disk full',
      });

      const result = await invoke<{ state: string; error: string }>('module:rebuild-keyword-index', 7);

      expect(keywordIndexServiceInstance.rebuildForModule).toHaveBeenCalledWith(7);
      // A failed build is not an IPC-level failure - it is a normal, successful
      // read of the (failed) status, matching the "failures are reported, not
      // thrown" posture `KeywordIndexService.rebuildForModule` documents.
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('failed');
        expect(result.value.error).toBe('disk full');
      }
    });

    it('reports not_found when the module does not exist', async () => {
      keywordIndexServiceInstance.rebuildForModule.mockResolvedValue(undefined);

      const result = await invoke('module:rebuild-keyword-index', 999);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('not_found');
    });
  });

  describe('module:delete-keyword-index', () => {
    it('awaits the service and returns the resulting (unbuilt) status', async () => {
      keywordIndexServiceInstance.deleteIndexForModule.mockResolvedValue({
        moduleUuid: 'uuid-1', providerId: 'sidecar-fts5', state: 'unbuilt',
      });

      const result = await invoke<{ state: string }>('module:delete-keyword-index', 7);

      expect(keywordIndexServiceInstance.deleteIndexForModule).toHaveBeenCalledWith(7);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.state).toBe('unbuilt');
    });

    it('reports not_found when the module does not exist', async () => {
      keywordIndexServiceInstance.deleteIndexForModule.mockResolvedValue(undefined);

      const result = await invoke('module:delete-keyword-index', 999);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('not_found');
    });
  });
});
