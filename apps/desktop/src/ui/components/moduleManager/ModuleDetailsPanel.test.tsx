import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModuleDetailsPanel } from './ModuleDetailsPanel';
import DefaultExport from './ModuleDetailsPanel';
import { useModuleStore } from '../../stores/useModuleStore';
import type { CatalogModule, ModuleMetadata, DownloadProgress } from '../../stores/useModuleStore';
import { mergeAndSortModules, type ModuleRow } from '../../stores/module/moduleRows';
import { moduleAPI } from '../../stores/module/moduleAPI';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { enT } from '../../testing/enCatalog';

vi.mock('../../stores/module/moduleAPI', () => ({
  moduleAPI: {
    getModuleDetails: vi.fn(),
    reindexModule: vi.fn(),
  },
}));

const getModuleDetails = vi.mocked(moduleAPI.getModuleDetails);
const reindexModule = vi.mocked(moduleAPI.reindexModule);

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

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

const services = createMockServices();

const catalogKjv: CatalogModule = {
  module_id: 'kjv-catalog',
  module_type: 'bible',
  name: 'King James Version',
  abbreviation: 'KJV',
  description: 'The classic King James Bible translation.',
  version: '1.0',
  language_code: 'en',
  download_size_bytes: 5 * 1024 * 1024,
  installed_size_bytes: 12 * 1024 * 1024,
  recommended: true,
  author: 'Public Domain Author',
  publisher: 'Bible Society',
  year_published: 1611,
  license: 'Public Domain',
  license_url: 'https://example.com/license',
  features: ['strongs', 'morphology'],
  tags: ['classic', 'formal'],
  download_url: 'https://modules.example.com/kjv.db',
  checksum: 'abc123checksum',
  created_date: '2024-01-01',
  updated_date: '2024-04-01',
};

const installedEsv: ModuleMetadata = {
  module_id: 7,
  module_type: 'bible',
  name: 'English Standard Version',
  abbreviation: 'ESV',
  description: 'Modern English translation.',
  version: '2.0',
  language_code: 'en',
  database_path: '/path/to/esv.db',
  is_indexed: false,
  usage_count: 5,
  update_available: false,
  last_used_date: '2024-05-06T10:00:00Z',
  user_hidden: false,
};

function rowFor(catalog: CatalogModule[], installed: ModuleMetadata[], abbr: string): ModuleRow {
  const row = mergeAndSortModules(catalog, installed).find((r) => r.abbreviation === abbr);
  if (!row) throw new Error('row not found');
  return row;
}

interface Handlers {
  onClose: Mock<() => void>;
  onInstall: Mock<(row: ModuleRow) => void>;
  onUpdate: Mock<(row: ModuleRow) => void>;
  onUninstall: Mock<(row: ModuleRow, removeUserData: boolean) => void>;
}

function renderPanel(
  row: ModuleRow,
  extra: { activeDownload?: DownloadProgress; isOffline?: boolean } = {}
) {
  const handlers: Handlers = {
    onClose: vi.fn(),
    onInstall: vi.fn(),
    onUpdate: vi.fn(),
    onUninstall: vi.fn(),
  };
  const ui = (r: ModuleRow) => (
    <ContextProvider services={services}>
      <ModuleDetailsPanel
        row={r}
        activeDownload={extra.activeDownload}
        isOffline={extra.isOffline ?? false}
        {...handlers}
      />
    </ContextProvider>
  );
  const result = render(ui(row));
  return { ...result, handlers, rerenderRow: (r: ModuleRow) => result.rerender(ui(r)) };
}

describe('ModuleDetailsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModuleDetails.mockResolvedValue({ ...installedEsv });
    reindexModule.mockResolvedValue(undefined as never);
    useModuleStore.setState({
      selectedModule: null,
      selectedModuleDetails: null,
      loadingDetails: false,
    });
  });

  it('exports both named and default', () => {
    expect(DefaultExport).toBe(ModuleDetailsPanel);
  });

  describe('catalog-only module', () => {
    it('shows all available catalog metadata', () => {
      renderPanel(rowFor([catalogKjv], [], 'KJV'));

      expect(screen.getByTestId('module-details-panel')).toBeInTheDocument();
      expect(screen.getByTestId('module-details-name')).toHaveTextContent('King James Version');
      expect(screen.getByTestId('module-details-abbreviation')).toHaveTextContent('KJV');
      expect(screen.getByTestId('module-details-description')).toHaveTextContent(
        'The classic King James Bible translation.'
      );
      expect(screen.getByTestId('module-details-author')).toHaveTextContent('Public Domain Author');
      expect(screen.getByTestId('module-details-publisher')).toHaveTextContent('Bible Society');
      expect(screen.getByTestId('module-details-year')).toHaveTextContent('1611');
      expect(screen.getByTestId('module-details-license')).toHaveTextContent('Public Domain');
      expect(screen.getByTestId('module-details-license-link')).toHaveAttribute(
        'href',
        'https://example.com/license'
      );
      expect(screen.getByTestId('module-details-version')).toHaveTextContent('1.0');
      expect(screen.getByTestId('module-details-downloadSize')).toHaveTextContent('5 MB');
      expect(screen.getByTestId('module-details-installedSize')).toHaveTextContent('12 MB');
      expect(screen.getByTestId('module-details-source')).toHaveTextContent(
        'https://modules.example.com/kjv.db'
      );
      expect(screen.getByTestId('module-details-checksum')).toHaveTextContent('abc123checksum');
      expect(screen.getByTestId('module-details-features')).toHaveTextContent('strongs');
      expect(screen.getByTestId('module-details-features')).toHaveTextContent('morphology');
      expect(screen.getByTestId('module-details-tags')).toHaveTextContent('classic');
      expect(screen.getByText('Recommended')).toBeInTheDocument();
    });

    it('does not load extra details or show installed-only sections', () => {
      renderPanel(rowFor([catalogKjv], [], 'KJV'));
      expect(getModuleDetails).not.toHaveBeenCalled();
      expect(screen.queryByTestId('module-details-reindex')).not.toBeInTheDocument();
      expect(screen.queryByTestId('module-details-uninstall')).not.toBeInTheDocument();
      expect(screen.queryByTestId('module-details-indexed')).not.toBeInTheDocument();
      expect(screen.queryByTestId('module-details-usage')).not.toBeInTheDocument();
    });

    it('omits fields that do not exist', () => {
      const sparse: CatalogModule = {
        ...catalogKjv,
        author: undefined,
        publisher: undefined,
        year_published: undefined,
        license_url: undefined,
        features: [],
        tags: [],
        checksum: '',
        description: '',
      };
      renderPanel(rowFor([sparse], [], 'KJV'));
      expect(screen.queryByTestId('module-details-author')).not.toBeInTheDocument();
      expect(screen.queryByTestId('module-details-publisher')).not.toBeInTheDocument();
      expect(screen.queryByTestId('module-details-year')).not.toBeInTheDocument();
      expect(screen.queryByTestId('module-details-license-link')).not.toBeInTheDocument();
      expect(screen.getByTestId('module-details-license')).toHaveTextContent('Public Domain');
      expect(screen.queryByTestId('module-details-features')).not.toBeInTheDocument();
      expect(screen.queryByTestId('module-details-tags')).not.toBeInTheDocument();
      expect(screen.queryByTestId('module-details-checksum')).not.toBeInTheDocument();
      expect(screen.queryByTestId('module-details-description')).not.toBeInTheDocument();
    });

    it('does not render a non-http licence URL as a link', () => {
      const bad: CatalogModule = { ...catalogKjv, license_url: 'javascript:alert(1)' };
      renderPanel(rowFor([bad], [], 'KJV'));
      expect(screen.queryByTestId('module-details-license-link')).not.toBeInTheDocument();
    });

    it('calls onInstall with the row', async () => {
      const row = rowFor([catalogKjv], [], 'KJV');
      const { handlers } = renderPanel(row);
      await userEvent.click(screen.getByTestId('module-details-install'));
      expect(handlers.onInstall).toHaveBeenCalledWith(row);
    });

    it('disables install and explains when offline', () => {
      renderPanel(rowFor([catalogKjv], [], 'KJV'), { isOffline: true });
      expect(screen.getByTestId('module-details-install')).toBeDisabled();
      expect(screen.getByTestId('module-details-offline-note')).toBeInTheDocument();
    });
  });

  describe('installed module', () => {
    it('loads details through the store and shows installed-only fields', async () => {
      getModuleDetails.mockResolvedValue({ ...installedEsv, is_indexed: true, usage_count: 42 });
      renderPanel(rowFor([], [installedEsv], 'ESV'));

      expect(getModuleDetails).toHaveBeenCalledWith(7);
      await waitFor(() =>
        expect(screen.getByTestId('module-details-usage')).toHaveTextContent('42')
      );
      expect(screen.getByTestId('module-details-indexed')).toHaveTextContent('Indexed');
      expect(screen.getByTestId('module-details-lastUsed')).toBeInTheDocument();
      expect(screen.getByTestId('module-details-version')).toHaveTextContent('2.0');
      expect(screen.getByTestId('module-details-description')).toHaveTextContent(
        'Modern English translation.'
      );
    });

    it('shows a loading note while details are pending', async () => {
      let resolve!: (v: ModuleMetadata) => void;
      getModuleDetails.mockReturnValue(new Promise((r) => (resolve = r)) as never);
      renderPanel(rowFor([], [installedEsv], 'ESV'));
      expect(screen.getByTestId('module-details-loading')).toBeInTheDocument();
      await act(async () => resolve({ ...installedEsv }));
      expect(screen.queryByTestId('module-details-loading')).not.toBeInTheDocument();
    });

    it('does not show stale details from a previously selected module', async () => {
      const other: ModuleMetadata = {
        ...installedEsv,
        module_id: 9,
        abbreviation: 'NIV',
        name: 'NIV',
        usage_count: 999,
      };
      getModuleDetails.mockImplementation(async (id: number) =>
        id === 9 ? { ...other } : { ...installedEsv, usage_count: 5 }
      );
      const { rerenderRow } = renderPanel(rowFor([], [installedEsv, other], 'NIV'));
      await waitFor(() =>
        expect(screen.getByTestId('module-details-usage')).toHaveTextContent('999')
      );

      // Switch to a slow-loading module: NIV's 999 must not linger.
      let resolve!: (v: ModuleMetadata) => void;
      getModuleDetails.mockReturnValue(new Promise((r) => (resolve = r)) as never);
      rerenderRow(rowFor([], [installedEsv, other], 'ESV'));
      expect(useModuleStore.getState().selectedModuleDetails).toBeNull();
      expect(screen.getByTestId('module-details-usage')).toHaveTextContent('5');
      expect(screen.queryByText('999')).not.toBeInTheDocument();
      await act(async () => resolve({ ...installedEsv, usage_count: 6 }));
      expect(screen.getByTestId('module-details-usage')).toHaveTextContent('6');
    });

    it('clears details on unmount', async () => {
      const { unmount } = renderPanel(rowFor([], [installedEsv], 'ESV'));
      await waitFor(() => expect(useModuleStore.getState().selectedModuleDetails).not.toBeNull());
      unmount();
      expect(useModuleStore.getState().selectedModuleDetails).toBeNull();
    });

    it('passes the remove-data choice to onUninstall', async () => {
      const row = rowFor([], [installedEsv], 'ESV');
      const { handlers } = renderPanel(row);

      await userEvent.click(screen.getByTestId('module-details-uninstall'));
      expect(handlers.onUninstall).toHaveBeenLastCalledWith(row, false);

      await userEvent.click(screen.getByTestId('module-details-remove-data'));
      await userEvent.click(screen.getByTestId('module-details-uninstall'));
      expect(handlers.onUninstall).toHaveBeenLastCalledWith(row, true);
    });

    it('resets the remove-data checkbox when the row changes', async () => {
      const esv2: ModuleMetadata = { ...installedEsv, module_id: 8, abbreviation: 'NIV', name: 'NIV' };
      const { rerenderRow } = renderPanel(rowFor([], [installedEsv, esv2], 'ESV'));
      await userEvent.click(screen.getByTestId('module-details-remove-data'));
      expect(screen.getByTestId('module-details-remove-data')).toBeChecked();
      rerenderRow(rowFor([], [installedEsv, esv2], 'NIV'));
      expect(screen.getByTestId('module-details-remove-data')).not.toBeChecked();
    });

    it('shows Update (not Install) when an update is available', async () => {
      const outdated: ModuleMetadata = { ...installedEsv, abbreviation: 'KJV', update_available: true };
      const row = rowFor([catalogKjv], [outdated], 'KJV');
      const { handlers } = renderPanel(row);
      expect(screen.queryByTestId('module-details-install')).not.toBeInTheDocument();
      expect(screen.getByTestId('module-details-version')).toHaveTextContent('latest: 1.0');
      await userEvent.click(screen.getByTestId('module-details-update'));
      expect(handlers.onUpdate).toHaveBeenCalledWith(row);
    });
  });

  describe('re-index', () => {
    it('calls reindexModule with the abbreviation and shows busy then success', async () => {
      let resolve!: () => void;
      reindexModule.mockReturnValue(new Promise<void>((r) => (resolve = r)) as never);
      renderPanel(rowFor([], [installedEsv], 'ESV'));

      const btn = screen.getByTestId('module-details-reindex');
      await userEvent.click(btn);

      expect(reindexModule).toHaveBeenCalledWith('ESV', expect.any(Function));
      expect(btn).toBeDisabled();
      expect(screen.getByRole('progressbar', { name: 'Re-indexing...' })).toBeInTheDocument();

      await act(async () => resolve());
      expect(screen.getByTestId('module-details-reindex-success')).toBeInTheDocument();
      expect(screen.getByTestId('module-details-reindex')).not.toBeDisabled();
      expect(screen.getByTestId('module-details-indexed')).toHaveTextContent('Indexed');
    });

    it('reflects progress reported by the callback', async () => {
      let cb!: (p: unknown) => void;
      reindexModule.mockImplementation(((_a: string, onProgress?: (p: unknown) => void) => {
        cb = onProgress!;
        return new Promise(() => {});
      }) as never);
      renderPanel(rowFor([], [installedEsv], 'ESV'));
      await userEvent.click(screen.getByTestId('module-details-reindex'));
      act(() => cb({ current: 1, total: 4 }));
      expect(screen.getByRole('progressbar', { name: 'Re-indexing...' })).toHaveAttribute(
        'aria-valuenow',
        '25'
      );
    });

    it('shows an error when re-indexing fails', async () => {
      reindexModule.mockRejectedValue(new Error('disk full'));
      renderPanel(rowFor([], [installedEsv], 'ESV'));
      await userEvent.click(screen.getByTestId('module-details-reindex'));
      const alert = await screen.findByTestId('module-details-reindex-error');
      expect(alert).toHaveTextContent('disk full');
      expect(screen.getByTestId('module-details-reindex')).not.toBeDisabled();
    });

    it('ignores a result that arrives after switching to another module', async () => {
      const other: ModuleMetadata = { ...installedEsv, module_id: 8, abbreviation: 'NIV', name: 'NIV' };
      let resolve!: () => void;
      reindexModule.mockReturnValue(new Promise<void>((r) => (resolve = r)) as never);
      const { rerenderRow } = renderPanel(rowFor([], [installedEsv, other], 'ESV'));
      await userEvent.click(screen.getByTestId('module-details-reindex'));
      rerenderRow(rowFor([], [installedEsv, other], 'NIV'));
      await act(async () => resolve());
      expect(screen.queryByTestId('module-details-reindex-success')).not.toBeInTheDocument();
      expect(screen.getByTestId('module-details-reindex')).not.toBeDisabled();
    });
  });

  describe('active download', () => {
    const download: DownloadProgress = {
      queueId: 1,
      moduleId: 'kjv-catalog',
      moduleName: 'King James Version',
      status: 'downloading',
      progressBytes: 2048,
      totalBytes: 4096,
      progressPercentage: 50,
    };

    it('shows a ring, percent and status and disables install', () => {
      renderPanel(rowFor([catalogKjv], [], 'KJV'), { activeDownload: download });
      expect(screen.getByTestId('module-details-download')).toHaveTextContent('Downloading');
      expect(screen.getByTestId('module-details-download-percent')).toHaveTextContent('50%');
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
      expect(screen.getByTestId('module-details-install')).toBeDisabled();
    });

    it('uses an indeterminate ring when the total is unknown', () => {
      renderPanel(rowFor([catalogKjv], [], 'KJV'), {
        activeDownload: { ...download, totalBytes: undefined },
      });
      expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
      expect(screen.queryByTestId('module-details-download-percent')).not.toBeInTheDocument();
    });

    it('disables update while a download is active', () => {
      const outdated: ModuleMetadata = { ...installedEsv, abbreviation: 'KJV', update_available: true };
      renderPanel(rowFor([catalogKjv], [outdated], 'KJV'), { activeDownload: download });
      expect(screen.getByTestId('module-details-update')).toBeDisabled();
    });

    it('leaves install enabled after a failed download so it can be retried', () => {
      renderPanel(rowFor([catalogKjv], [], 'KJV'), {
        activeDownload: { ...download, status: 'failed', errorMessage: 'Network dropped' },
      });
      expect(screen.getByText('Network dropped')).toBeInTheDocument();
      expect(screen.getByTestId('module-details-install')).not.toBeDisabled();
    });
  });

  describe('closing', () => {
    it('closes via the close button', async () => {
      const { handlers } = renderPanel(rowFor([catalogKjv], [], 'KJV'));
      await userEvent.click(screen.getByTestId('module-details-close'));
      expect(handlers.onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape from inside the panel without letting it bubble', () => {
      const outer = vi.fn();
      window.addEventListener('keydown', outer);
      try {
        const { handlers } = renderPanel(rowFor([catalogKjv], [], 'KJV'));
        fireEvent.keyDown(screen.getByTestId('module-details-install'), { key: 'Escape' });
        expect(handlers.onClose).toHaveBeenCalledTimes(1);
        expect(outer).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('keydown', outer);
      }
    });
  });
});
