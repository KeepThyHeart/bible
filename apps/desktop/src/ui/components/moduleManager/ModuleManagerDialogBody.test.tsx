import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModuleManagerDialog from '../ModuleManagerDialog';
import { useModuleStore } from '../../stores/useModuleStore';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { enT } from '../../testing/enCatalog';
import type { CatalogModule, ModuleMetadata } from '../../stores/module/types';

vi.mock('../../stores/module/moduleAPI', () => ({
  moduleAPI: {
    installFromFile: vi.fn().mockResolvedValue(null),
    inspectPack: vi.fn(),
    installPackFromPath: vi.fn(),
    getModuleDetails: vi.fn().mockResolvedValue(null),
    getKeywordIndexStatus: vi.fn().mockResolvedValue({
      moduleUuid: 'mock-uuid',
      providerId: 'sidecar-fts5',
      state: 'unbuilt',
    }),
    rebuildKeywordIndex: vi.fn(),
    deleteKeywordIndex: vi.fn(),
  },
}));

function createMockServices(): AppServices {
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

const cat = (abbreviation: string, name: string, module_type: CatalogModule['module_type'] = 'bible'): CatalogModule => ({
  module_id: `cat-${abbreviation}`,
  module_type,
  name,
  abbreviation,
  language_code: 'en',
  version: '1.0',
  description: `${name} description`,
  license: 'PD',
  download_url: 'https://example.test/x',
  download_size_bytes: 1024,
  installed_size_bytes: 2048,
  checksum: 'x',
  features: [],
  tags: [],
  recommended: false,
  created_date: '2020-01-01',
  updated_date: '2020-01-01',
});

const inst = (abbreviation: string, name: string, module_id: number): ModuleMetadata => ({
  module_id,
  module_type: 'bible',
  abbreviation,
  name,
  language_code: 'en',
  version: '1.0',
  database_path: 'x.db',
  is_indexed: true,
  update_available: false,
  usage_count: 0,
  user_hidden: false,
});

function renderDialog(initialModuleType?: CatalogModule['module_type'] | null) {
  return render(
    <ContextProvider services={createMockServices()}>
      <ModuleManagerDialog onClose={vi.fn()} initialModuleType={initialModuleType} />
    </ContextProvider>
  );
}

describe('ModuleManagerDialog body (tabs, filter chips, table, details)', () => {
  const installModule = vi.fn().mockResolvedValue(true);
  const uninstallModule = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    useNetworkStore.setState({ allowWebRequests: true, loaded: true });
    useModuleStore.setState({
      isInitialized: true,
      initError: null,
      activeTypeTab: 'bible',
      installFilter: 'all',
      loadingAvailable: false,
      loadingInstalled: false,
      error: null,
      errorCode: null,
      activeDownloads: [],
      repositories: [],
      availableModules: [cat('AAA', 'Alpha Bible'), cat('BBB', 'Beta Bible'), cat('CCC', 'Comm One', 'commentary')],
      installedModules: [inst('AAA', 'Alpha Bible', 1)],
      initialize: vi.fn().mockResolvedValue(undefined),
      refreshAllCatalogs: vi.fn().mockResolvedValue(undefined),
      startDownloadPolling: vi.fn(),
      stopDownloadPolling: vi.fn(),
      loadInstalledModules: vi.fn().mockResolvedValue(undefined),
      installModule,
      uninstallModule,
    });
  });

  it('renders one tab per module type that has modules, plus Feature packs and Sources', () => {
    renderDialog();
    expect(screen.getByTestId('module-manager-type-tab-bible')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('module-manager-type-tab-commentary')).toBeInTheDocument();
    expect(screen.queryByTestId('module-manager-type-tab-lexicon')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-manager-features-tab')).toHaveTextContent('Feature packs');
    expect(screen.getByTestId('module-manager-repositories-tab')).toHaveTextContent('Sources');
    expect(screen.getByTestId('module-table-bible')).toBeInTheDocument();
  });

  it('opens on the tab for initialModuleType', async () => {
    renderDialog('commentary');
    expect(await screen.findByTestId('module-table-commentary')).toBeInTheDocument();
    expect(screen.getByTestId('module-manager-type-tab-commentary')).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps a requested type as a tab even when it has no modules', async () => {
    renderDialog('lexicon');
    expect(await screen.findByTestId('module-manager-type-tab-lexicon')).toHaveAttribute('aria-selected', 'true');
  });

  it('switches tabs and filters with the chip group', async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(screen.getByTestId('module-row-BBB')).toBeInTheDocument();

    await user.click(screen.getByTestId('module-manager-filter-installed'));
    expect(screen.queryByTestId('module-row-BBB')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-row-AAA')).toBeInTheDocument();

    await user.click(screen.getByTestId('module-manager-type-tab-commentary'));
    expect(useModuleStore.getState().activeTypeTab).toBe('commentary');
    expect(screen.queryByTestId('module-row-CCC')).not.toBeInTheDocument(); // installed filter still on
  });

  it('search narrows the table', async () => {
    const user = userEvent.setup();
    renderDialog();
    // The focus trap moves focus to the first control on the next animation frame; let it settle
    // first or it steals focus from the search box mid-typing.
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await user.type(screen.getByPlaceholderText(/search/i), 'beta');
    expect(screen.getByTestId('module-row-BBB')).toBeInTheDocument();
    expect(screen.queryByTestId('module-row-AAA')).not.toBeInTheDocument();
  });

  it('clicking a row opens the details panel inside the dialog; closing hides it', async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(screen.queryByTestId('module-details-panel')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('module-row-AAA'));
    const panel = screen.getByTestId('module-details-panel');
    expect(panel).toBeInTheDocument();
    expect(screen.getByTestId('module-manager-dialog')).toContainElement(panel);
  });

  it('the row Install button installs the catalog module without opening the panel', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByTestId('module-row-install-BBB'));
    expect(installModule).toHaveBeenCalledWith('cat-BBB');
    expect(screen.queryByTestId('module-details-panel')).not.toBeInTheDocument();
  });

  it('shows the offline banner on the module tabs but not under the Installed filter', async () => {
    const user = userEvent.setup();
    useNetworkStore.setState({ allowWebRequests: false, loaded: true });
    renderDialog();
    expect(screen.getByTestId('module-manager-offline-banner')).toBeInTheDocument();
    await user.click(screen.getByTestId('module-manager-filter-installed'));
    expect(screen.queryByTestId('module-manager-offline-banner')).not.toBeInTheDocument();
  });

  it('hides the toolbar on the Feature packs tab', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByTestId('module-manager-features-tab'));
    expect(screen.queryByTestId('module-manager-install-filter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('module-table-bible')).not.toBeInTheDocument();
  });
});
