import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModuleManagerDialog from '../ModuleManagerDialog';
import { useModuleStore } from '../../stores/useModuleStore';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { enT } from '../../testing/enCatalog';
import type { CatalogModule, ModuleMetadata } from '../../stores/module/types';
import type { InstallJob } from '../../stores/module/moduleAPI';

const freeSpace = vi.hoisted(() => ({ value: null as number | null }));

vi.mock('../../stores/module/moduleAPI', () => ({
  moduleAPI: {
    installFromFile: vi.fn().mockResolvedValue(null),
    inspectPack: vi.fn(),
    installPackFromPath: vi.fn(),
    getModuleDetails: vi.fn().mockResolvedValue(null),
    getKeywordIndexStatus: vi.fn().mockResolvedValue({ moduleUuid: 'u', providerId: 'sidecar-fts5', state: 'unbuilt' }),
    rebuildKeywordIndex: vi.fn(),
    deleteKeywordIndex: vi.fn(),
    getInstallJobs: vi.fn().mockResolvedValue([]),
    getFreeSpace: vi.fn(async () => freeSpace.value),
  },
}));

function services(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

const MB = 1024 * 1024;
const cat = (abbreviation: string, name: string, size = MB, type: CatalogModule['module_type'] = 'bible'): CatalogModule => ({
  module_id: `cat-${abbreviation}`, module_type: type, name, abbreviation, language_code: 'en', version: '2.0',
  description: '', license: 'PD', download_url: 'https://example.test/x', download_size_bytes: size,
  installed_size_bytes: 0, checksum: 'x', features: [], tags: [], recommended: false, created_date: '', updated_date: '',
});
const inst = (abbreviation: string, name: string, module_id: number, update = false): ModuleMetadata => ({
  module_id, module_type: 'bible', abbreviation, name, language_code: 'en', version: '1.0', database_path: 'x.db',
  is_indexed: true, update_available: update, usage_count: 0, user_hidden: false,
});
const job = (abbreviation: string, stage: InstallJob['stage'], jobId: number): InstallJob => ({
  jobId, moduleId: `cat-${abbreviation}`, name: abbreviation, abbreviation, stage, bytesDone: 0, updatedAt: 0,
});

function setJobs(...jobs: InstallJob[]) {
  useModuleStore.setState({ installJobs: jobs });
}

describe('ModuleManagerDialog batch install', () => {
  const started: string[] = [];
  const startInstall = vi.fn(async (id: string) => {
    started.push(id);
    const abbr = id.replace('cat-', '');
    useModuleStore.setState((s) => ({ installJobs: [...s.installJobs, job(abbr, 'queued', started.length)] }));
  });
  const updateModule = vi.fn().mockResolvedValue(true);
  const cancelInstall = vi.fn().mockResolvedValue(undefined);

  function setup(available: CatalogModule[], installed: ModuleMetadata[], filter: 'all' | 'installed' | 'updates' = 'all') {
    useModuleStore.setState({
      isInitialized: true, initError: null, activeTypeTab: 'bible', installFilter: filter,
      loadingAvailable: false, loadingInstalled: false, error: null, errorCode: null, activeDownloads: [], repositories: [],
      availableModules: available, installedModules: installed,
      initialize: vi.fn().mockResolvedValue(undefined), refreshAllCatalogs: vi.fn().mockResolvedValue(undefined),
      startDownloadPolling: vi.fn(), stopDownloadPolling: vi.fn(), loadInstalledModules: vi.fn().mockResolvedValue(undefined),
      installJobs: [], startInstall, updateModule, cancelInstall,
      refreshInstallJobs: vi.fn().mockResolvedValue(undefined),
    });
    return render(
      <ContextProvider services={services()}>
        <ModuleManagerDialog onClose={vi.fn()} />
      </ContextProvider>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    started.length = 0;
    freeSpace.value = null;
    useNetworkStore.setState({ allowWebRequests: true, loaded: true });
  });

  const ABC = [cat('AAA', 'Alpha', 1 * MB), cat('BBB', 'Beta', 2 * MB), cat('CCC', 'Gamma', 4 * MB), cat('DDD', 'Comm', 8 * MB, 'commentary')];

  it('has labelled checkboxes only on rows that can be installed or updated', () => {
    setup(ABC, [inst('AAA', 'Alpha', 1)]);
    expect(screen.queryByTestId('module-row-check-AAA')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Beta' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Gamma' })).toBeInTheDocument();
    expect(screen.getByTestId('module-table-check-all-bible')).toHaveAccessibleName(/select all/i);
  });

  it('disables the button with a reason until something is ticked, then shows count and size', async () => {
    const user = userEvent.setup();
    setup(ABC, []);
    const button = screen.getByTestId('module-batch-install');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(/tick at least one/i));
    await user.click(screen.getByRole('checkbox', { name: 'Select Beta' }));
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('Install selected (1, 2 MB)');
  });

  it('header checkbox selects all visible rows, is indeterminate when partly selected, and rows can be unticked', async () => {
    const user = userEvent.setup();
    setup(ABC, []);
    const header = screen.getByTestId('module-table-check-all-bible') as HTMLInputElement;
    await user.click(header);
    expect(screen.getByTestId('module-batch-install')).toHaveTextContent('Install selected (3, 7 MB)');
    expect(header.checked).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Select Beta' }));
    expect(screen.getByTestId('module-batch-install')).toHaveTextContent('Install selected (2, 5 MB)');
    expect(header.indeterminate).toBe(true);
    expect(header.checked).toBe(false);
  });

  it('select-all respects the type tab, the install filter and the text filter', async () => {
    const user = userEvent.setup();
    setup(ABC, [inst('AAA', 'Alpha', 1)]);
    // text filter
    await user.type(screen.getByPlaceholderText(/search/i), 'gamma');
    await user.click(screen.getByTestId('module-table-check-all-bible'));
    expect(screen.getByTestId('module-batch-install')).toHaveTextContent('Install selected (1, 4 MB)');
    // Installed filter hides every selectable row (AAA is installed without an update)
    await user.clear(screen.getByPlaceholderText(/search/i));
    await user.click(screen.getByTestId('module-manager-filter-installed'));
    expect(screen.getByTestId('module-batch-install')).toHaveTextContent('Install selected (0, ');
    expect(screen.getByTestId('module-table-check-all-bible')).toBeDisabled();
    // Other tab: its own rows only
    await user.click(screen.getByTestId('module-manager-filter-all'));
    await user.click(screen.getByTestId('module-manager-type-tab-commentary'));
    await user.click(screen.getByTestId('module-table-check-all-commentary'));
    expect(screen.getByTestId('module-batch-install')).toHaveTextContent('Install selected (1, 8 MB)');
  });

  it('Install selected queues each module in table order and clears the selection', async () => {
    const user = userEvent.setup();
    setup(ABC, []);
    await user.click(screen.getByTestId('module-table-check-all-bible'));
    await user.click(screen.getByTestId('module-batch-install'));
    await waitFor(() => expect(startInstall).toHaveBeenCalledTimes(3));
    expect(started).toEqual(['cat-AAA', 'cat-BBB', 'cat-CCC']);
    expect(screen.getByTestId('module-batch-progress')).toHaveTextContent('0 of 3 done');
  });

  it('reports overall progress as jobs finish, with failed rows counted', async () => {
    const user = userEvent.setup();
    setup(ABC, []);
    await user.click(screen.getByTestId('module-table-check-all-bible'));
    await user.click(screen.getByTestId('module-batch-install'));
    await waitFor(() => expect(startInstall).toHaveBeenCalledTimes(3));
    setJobs(job('AAA', 'done', 1), job('BBB', 'failed', 2), job('CCC', 'downloading', 3));
    await waitFor(() => expect(screen.getByTestId('module-batch-progress')).toHaveTextContent('1 of 3 done, 1 failed'));
    expect(screen.getByTestId('module-batch-progress')).toHaveAttribute('aria-live', 'polite');
    // The failed row keeps its Retry
    expect(screen.getByTestId('module-row-retry-BBB')).toBeInTheDocument();
  });

  it('Cancel stops the remaining queue', async () => {
    const user = userEvent.setup();
    setup(ABC, []);
    await user.click(screen.getByTestId('module-table-check-all-bible'));
    await user.click(screen.getByTestId('module-batch-install'));
    await waitFor(() => expect(startInstall).toHaveBeenCalledTimes(3));
    await user.click(await screen.findByTestId('module-batch-cancel'));
    expect(cancelInstall.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2, 3]);
  });

  it('Update all shows under the Updates filter and updates one after another', async () => {
    const user = userEvent.setup();
    const order: number[] = [];
    updateModule.mockImplementation(async (id: number) => {
      order.push(id);
      return true;
    });
    setup(ABC, [inst('AAA', 'Alpha', 1, true), inst('BBB', 'Beta', 2, true), inst('CCC', 'Gamma', 3)], 'updates');
    const all = screen.getByTestId('module-batch-update-all');
    expect(all).toHaveTextContent('Update all (2, 3 MB)');
    await user.click(all);
    await waitFor(() => expect(updateModule).toHaveBeenCalledTimes(2));
    expect(order).toEqual([1, 2]);
    expect(startInstall).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('module-batch-progress')).toHaveTextContent('Finished. 2 of 2 done'));
  });

  it('no Update all button outside the Updates filter', () => {
    setup(ABC, [inst('AAA', 'Alpha', 1, true)]);
    expect(screen.queryByTestId('module-batch-update-all')).not.toBeInTheDocument();
  });

  it('warns before a batch larger than 1 GB, and starts only after confirming', async () => {
    const user = userEvent.setup();
    setup([cat('AAA', 'Alpha', 2 * 1024 * MB), cat('BBB', 'Beta', MB)], []);
    await user.click(screen.getByTestId('module-table-check-all-bible'));
    await user.click(screen.getByTestId('module-batch-install'));
    const dialog = await screen.findByRole('dialog', { name: /start these downloads/i });
    expect(dialog).toHaveTextContent('2 GB');
    expect(startInstall).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /start downloads/i }));
    await waitFor(() => expect(startInstall).toHaveBeenCalledTimes(2));
  });

  it('warns when the batch exceeds free disk space and Cancel starts nothing', async () => {
    const user = userEvent.setup();
    freeSpace.value = 2 * MB;
    setup(ABC, []);
    await user.click(screen.getByTestId('module-table-check-all-bible'));
    await user.click(screen.getByTestId('module-batch-install'));
    const dialog = await screen.findByRole('dialog', { name: /start these downloads/i });
    expect(dialog).toHaveTextContent(/only 2 MB of disk space is free/i);
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(startInstall).not.toHaveBeenCalled();
  });

  it('with the network off the selection controls and buttons are disabled, under the offline banner', () => {
    useNetworkStore.setState({ allowWebRequests: false, loaded: true });
    setup(ABC, []);
    expect(screen.getByTestId('module-manager-offline-banner')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Beta' })).toBeDisabled();
    expect(screen.getByTestId('module-table-check-all-bible')).toBeDisabled();
    expect(screen.getByTestId('module-batch-install')).toBeDisabled();
  });
});
