/**
 * `module:install-from-file`'s native-dialog trust gate.
 *
 * The "Install from File" flow picks and installs in one main-process round
 * trip (`dialog.showOpenDialog` -> install, no renderer turn in between), so
 * an unsigned/untrusted pack archive can only be confirmed with a NATIVE
 * dialog raised right here - there is no later point at which a renderer
 * confirmation could run. This is also a stronger guarantee than a renderer
 * confirm: a compromised renderer cannot suppress or fake the answer to a
 * dialog it never gets to render.
 *
 * `electron` and every heavy service `initializeModuleManager()` would
 * otherwise construct are mocked so this can run with no real database, no
 * real network gateway, and no real Electron runtime - only
 * `module:install-from-file`'s own orchestration is under test.
 *
 * The gate applies identically to `.zip` and `.biblepack` (`isModulePackPath`),
 * per design-pack-trust.md's decision that the archive's extension must not
 * decide trust.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const showOpenDialog = vi.fn();
const showMessageBox = vi.fn();
const showErrorBox = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
  dialog: { showOpenDialog, showMessageBox, showErrorBox },
  app: { getPath: vi.fn(() => 'C:\\fake\\userData'), isPackaged: false },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/appPaths', () => ({
  getBundledMainDbPath: () => 'C:\\fake\\bundled.db',
  getUserDataPath: () => 'C:\\fake\\userData',
  getUserModulesPath: () => 'C:\\fake\\modules',
  resolveMainDbPath: () => 'C:\\fake\\main.db',
}));

vi.mock('../../utils/initMainDatabase', () => ({
  initializeMainDatabase: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock('../../services/DownloadService', () => ({
  DownloadService: vi.fn().mockImplementation(() => ({
    onProgress: vi.fn(),
    onError: vi.fn(),
  })),
}));

vi.mock('../../services/InstallationService', () => ({
  InstallationService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../services/ModuleCatalogService', () => ({
  ModuleCatalogService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../services/ApprovedCatalogKeys', () => ({
  FileApprovedCatalogKeyStore: vi.fn().mockImplementation(() => ({ list: () => [] })),
}));

vi.mock('../blessedPaths', () => ({
  blessPath: vi.fn(),
  isPathBlessed: vi.fn(() => true),
}));

vi.mock('../../services/MainI18n', () => ({ t: (key: string) => key }));

vi.mock('@bible/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bible/core')>();
  return {
    ...actual,
    ModuleController: vi.fn().mockImplementation(() => ({
      getInstalledModules: () => [],
    })),
    ModuleCatalogController: vi.fn().mockImplementation(() => ({})),
    ModuleMetadataRepository: vi.fn().mockImplementation(() => ({})),
    DownloadQueueRepository: vi.fn().mockImplementation(() => ({})),
  };
});

const inspectModulePack = vi.fn();
const installModulePack = vi.fn();
vi.mock('../../services/ModulePackService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ModulePackService')>();
  return { ...actual, inspectModulePack, installModulePack };
});

async function invoke<T>(channel: string, ...args: unknown[]): Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return (await fn({}, ...args)) as { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
}

describe("module:install-from-file's native trust-gate dialog", () => {
  beforeAll(async () => {
    const { registerModuleHandlers } = await import('../moduleHandlers');
    registerModuleHandlers({} as never);
  });

  beforeEach(() => {
    inspectModulePack.mockReset();
    installModulePack.mockReset();
    showOpenDialog.mockReset();
    showMessageBox.mockReset();
    showErrorBox.mockReset();
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\fake\\starter.biblepack'] });
  });

  it('unsigned: raises a native confirm; "Install anyway" installs with acceptUnverified: true', async () => {
    inspectModulePack.mockResolvedValue({ status: 'unsigned', message: 'This pack is not signed.' });
    installModulePack.mockResolvedValue({
      found: 1,
      installed: [{ entryPath: 'kjv.db', moduleName: 'KJV' }],
      failed: [],
      skipped: [],
    });
    showMessageBox.mockResolvedValue({ response: 1 }); // "Install anyway"

    const result = await invoke<{ kind: string }>('module:install-from-file');

    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "This pack isn't verified",
        buttons: ['Cancel', 'Install anyway'],
        defaultId: 0,
        cancelId: 0,
      })
    );
    expect(installModulePack).toHaveBeenCalled();
    // 5th positional arg to installModulePack is the trust options.
    expect(installModulePack.mock.calls[0][4]).toMatchObject({ acceptUnverified: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe('batch');
  });

  it('unsigned: "Cancel" installs nothing and reports a clean (null) no-op, not an error', async () => {
    inspectModulePack.mockResolvedValue({ status: 'untrusted', message: 'Signed by an untrusted key.' });
    showMessageBox.mockResolvedValue({ response: 0 }); // Cancel (defaultId/cancelId)

    const result = await invoke<null>('module:install-from-file');

    expect(installModulePack).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it('invalid: raises a native error box, never installs, and is reported as a failure', async () => {
    inspectModulePack.mockResolvedValue({ status: 'invalid', message: 'pack.json.sig does not match pack.json.' });

    const result = await invoke<{ kind: string; summary: { failed: Array<{ entryPath: string; reason: string }> } }>(
      'module:install-from-file'
    );

    expect(showErrorBox).toHaveBeenCalledWith(
      "This pack can't be installed",
      expect.stringContaining('pack.json.sig does not match pack.json.')
    );
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(installModulePack).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('batch');
      expect(result.value.summary.failed).toHaveLength(1);
    }
  });

  it('verified: installs directly with no dialog at all', async () => {
    inspectModulePack.mockResolvedValue({ status: 'verified', message: 'Verified: signed by Keep Thy Heart.' });
    installModulePack.mockResolvedValue({
      found: 1,
      installed: [{ entryPath: 'kjv.db', moduleName: 'KJV' }],
      failed: [],
      skipped: [],
    });

    const result = await invoke<{ kind: string }>('module:install-from-file');

    expect(showMessageBox).not.toHaveBeenCalled();
    expect(showErrorBox).not.toHaveBeenCalled();
    expect(installModulePack).toHaveBeenCalled();
    expect(installModulePack.mock.calls[0][4]).toMatchObject({ acceptUnverified: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe('batch');
  });

  it('applies the same gate to a plain .zip - the extension decides nothing', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\fake\\bundle.zip'] });
    inspectModulePack.mockResolvedValue({ status: 'unsigned', message: 'This pack is not signed.' });
    showMessageBox.mockResolvedValue({ response: 0 }); // Cancel

    await invoke('module:install-from-file');

    expect(inspectModulePack).toHaveBeenCalledWith('C:\\fake\\bundle.zip', expect.anything());
    expect(showMessageBox).toHaveBeenCalled();
    expect(installModulePack).not.toHaveBeenCalled();
  });

  it('the user cancelling the file picker itself still returns null, unaffected by the trust gate', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await invoke<null>('module:install-from-file');

    expect(inspectModulePack).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });
});
