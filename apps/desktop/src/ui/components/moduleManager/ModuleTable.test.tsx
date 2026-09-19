import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ModuleTable, { filterModuleRows } from './ModuleTable';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { enT } from '../../testing/enCatalog';
import { mergeAndSortModules } from '../../stores/module/moduleRows';
import type { CatalogModule, ModuleMetadata } from '../../stores/module/types';

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

function catalog(overrides: Partial<CatalogModule> & Pick<CatalogModule, 'abbreviation' | 'name'>): CatalogModule {
  return {
    module_id: `cat-${overrides.abbreviation}`,
    module_type: 'bible',
    language_code: 'en',
    version: '1.0',
    description: `${overrides.name} description`,
    license: 'Public Domain',
    download_url: 'https://example.test/x.db.gz',
    download_size_bytes: 2 * 1024 * 1024,
    installed_size_bytes: 5 * 1024 * 1024,
    checksum: 'abc',
    features: [],
    tags: [],
    recommended: false,
    created_date: '2020-01-01',
    updated_date: '2020-01-01',
    ...overrides,
  };
}

function installed(
  overrides: Partial<ModuleMetadata> & Pick<ModuleMetadata, 'abbreviation' | 'name' | 'module_id'>
): ModuleMetadata {
  return {
    module_type: 'bible',
    language_code: 'en',
    version: '1.0',
    database_path: 'x.db',
    is_indexed: true,
    update_available: false,
    usage_count: 0,
    user_hidden: false,
    ...overrides,
  };
}

const CATALOG: CatalogModule[] = [
  catalog({ abbreviation: 'ZZZ', name: 'Zeta Bible', recommended: true }),
  catalog({ abbreviation: 'AAA', name: 'Alpha Bible' }),
  catalog({ abbreviation: 'MMM', name: 'Mu Bible', recommended: true, version: '2.0' }),
  catalog({ abbreviation: 'CCC', name: 'Comm One', module_type: 'commentary' }),
  catalog({ abbreviation: 'BBB', name: 'Beta Bible', language_code: 'es' }),
];
const INSTALLED: ModuleMetadata[] = [
  installed({ abbreviation: 'MMM', name: 'Mu Bible', module_id: 1, version: '1.0', update_available: true }),
  installed({ abbreviation: 'AAA', name: 'Alpha Bible', module_id: 2 }),
];

function renderTable(props: Partial<React.ComponentProps<typeof ModuleTable>> = {}) {
  const handlers = { onSelect: vi.fn(), onInstall: vi.fn(), onUpdate: vi.fn() };
  const rows = mergeAndSortModules(CATALOG, INSTALLED);
  const utils = render(
    <ContextProvider services={createMockServices()}>
      <ModuleTable
        type="bible"
        rows={rows}
        installFilter="all"
        searchQuery=""
        selectedAbbreviation={null}
        {...handlers}
        {...props}
      />
    </ContextProvider>
  );
  return { ...utils, ...handlers };
}

const rowOrder = () =>
  screen
    .getAllByTestId(/^module-row-[A-Z]+$/)
    .map((el) => el.getAttribute('data-testid')!.replace('module-row-', ''));

describe('ModuleTable', () => {
  it('renders a table for the tab type only, with name, abbreviation, language, version and size', () => {
    renderTable();
    expect(screen.getByTestId('module-table-bible')).toBeInTheDocument();
    expect(screen.queryByTestId('module-row-CCC')).not.toBeInTheDocument();

    const row = screen.getByTestId('module-row-AAA');
    expect(within(row).getByText('Alpha Bible')).toBeInTheDocument();
    expect(within(row).getByText('AAA')).toBeInTheDocument();
    expect(within(row).getByText('EN')).toBeInTheDocument();
    expect(within(row).getByText('1.0')).toBeInTheDocument();
    expect(within(row).getByText('2 MB')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
  });

  it('keeps recommended modules first, then the rest alphabetically', () => {
    renderTable();
    expect(rowOrder()).toEqual(['MMM', 'ZZZ', 'AAA', 'BBB']);
  });

  it('shows Installed, Update available and Not installed statuses with the right button', () => {
    renderTable();
    const installedRow = screen.getByTestId('module-row-AAA');
    expect(within(installedRow).getByText('Installed')).toBeInTheDocument();
    expect(within(installedRow).queryByRole('button', { name: /install|update/i })).not.toBeInTheDocument();

    const updateRow = screen.getByTestId('module-row-MMM');
    expect(screen.getByTestId('module-row-status-MMM')).toHaveAttribute('data-status', 'update');
    expect(within(updateRow).getByText('Update Available')).toBeInTheDocument();
    expect(within(updateRow).getByTestId('module-row-update-MMM')).toBeEnabled();
    expect(within(updateRow).getByText('1.0 → 2.0')).toBeInTheDocument();

    const availableRow = screen.getByTestId('module-row-ZZZ');
    expect(screen.getByTestId('module-row-status-ZZZ')).toHaveAttribute('data-status', 'available');
    expect(within(availableRow).getByText('Not installed')).toBeInTheDocument();
    expect(within(availableRow).getByTestId('module-row-install-ZZZ')).toBeEnabled();
  });

  it('leaves an empty progress slot in every status cell', () => {
    renderTable();
    for (const abbrev of ['MMM', 'ZZZ', 'AAA', 'BBB']) {
      expect(screen.getByTestId(`module-row-progress-${abbrev}`)).toBeEmptyDOMElement();
    }
  });

  it('selects a row on click and marks it selected', async () => {
    const user = userEvent.setup();
    const { onSelect, rerender } = renderTable();
    await user.click(screen.getByTestId('module-row-AAA'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].abbreviation).toBe('AAA');

    expect(screen.getByTestId('module-row-AAA')).toHaveAttribute('data-selected', 'false');
    rerender(
      <ContextProvider services={createMockServices()}>
        <ModuleTable
          type="bible"
          rows={mergeAndSortModules(CATALOG, INSTALLED)}
          installFilter="all"
          searchQuery=""
          selectedAbbreviation="AAA"
          onSelect={onSelect}
          onInstall={vi.fn()}
          onUpdate={vi.fn()}
        />
      </ContextProvider>
    );
    expect(screen.getByTestId('module-row-AAA')).toHaveAttribute('data-selected', 'true');
  });

  it('Install and Update buttons act without selecting the row', async () => {
    const user = userEvent.setup();
    const { onSelect, onInstall, onUpdate } = renderTable();

    await user.click(screen.getByTestId('module-row-install-ZZZ'));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onInstall.mock.calls[0][0].abbreviation).toBe('ZZZ');

    await user.click(screen.getByTestId('module-row-update-MMM'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].abbreviation).toBe('MMM');

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables Install/Update while busy or offline', () => {
    renderTable({ busyAbbreviations: new Set(['ZZZ']) });
    expect(screen.getByTestId('module-row-install-ZZZ')).toBeDisabled();
    expect(screen.getByTestId('module-row-install-BBB')).toBeEnabled();
  });

  it('disables Install/Update when offline', () => {
    renderTable({ offline: true });
    expect(screen.getByTestId('module-row-install-ZZZ')).toBeDisabled();
    expect(screen.getByTestId('module-row-update-MMM')).toBeDisabled();
  });

  it('Installed filter lists only installed modules', () => {
    renderTable({ installFilter: 'installed' });
    expect(rowOrder()).toEqual(['MMM', 'AAA']);
  });

  it('Updates filter lists only modules with an update available', () => {
    renderTable({ installFilter: 'updates' });
    expect(rowOrder()).toEqual(['MMM']);
  });

  it('search matches name, abbreviation and description, case-insensitively', () => {
    renderTable({ searchQuery: 'alpha' });
    expect(rowOrder()).toEqual(['AAA']);
    expect(filterModuleRows(mergeAndSortModules(CATALOG, INSTALLED), 'bible', 'all', 'zzz').map((r) => r.abbreviation)).toEqual(['ZZZ']);
    expect(filterModuleRows(mergeAndSortModules(CATALOG, INSTALLED), 'bible', 'all', 'beta bible description').map((r) => r.abbreviation)).toEqual(['BBB']);
  });

  it('shows an empty state when nothing matches', () => {
    renderTable({ searchQuery: 'no-such-module' });
    expect(screen.getByTestId('module-table-empty-bible')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^module-row-[A-Z]+$/)).toHaveLength(0);
  });

  it('shows the "all up to date" empty state on the Updates filter with no updates', () => {
    renderTable({ rows: mergeAndSortModules(CATALOG, [installed({ abbreviation: 'AAA', name: 'Alpha Bible', module_id: 2 })]), installFilter: 'updates' });
    expect(screen.getByText('All modules are up to date')).toBeInTheDocument();
  });

  it('shows a spinner while loading with no rows yet, but keeps rows visible while reloading', () => {
    const { unmount } = renderTable({ rows: [], loading: true });
    expect(screen.getByText('Loading modules...')).toBeInTheDocument();
    unmount();
    renderTable({ loading: true });
    expect(screen.queryByText('Loading modules...')).not.toBeInTheDocument();
    expect(screen.getByTestId('module-row-AAA')).toBeInTheDocument();
  });

  it('lists an installed module that is not in the catalog', () => {
    renderTable({
      rows: mergeAndSortModules(
        [],
        [installed({ abbreviation: 'SIDE', name: 'Sideloaded', module_id: 9 })]
      ),
    });
    const row = screen.getByTestId('module-row-SIDE');
    expect(within(row).getByText('Installed')).toBeInTheDocument();
    expect(within(row).getByText('—', { selector: 'td' })).toBeInTheDocument(); // unknown size
  });

  describe('download progress', () => {
    it('shows no progress indicator when there is no download', () => {
      renderTable();
      for (const abbrev of ['MMM', 'ZZZ', 'AAA', 'BBB']) {
        expect(screen.getByTestId(`module-row-progress-${abbrev}`)).toBeEmptyDOMElement();
      }
    });

    it('shows a determinate progress ring when totalBytes is known', () => {
      const download: import('../../stores/module/types').DownloadProgress = {
        queueId: 1,
        moduleId: 'cat-ZZZ',
        moduleName: 'Zeta Bible',
        status: 'downloading',
        progressBytes: 5 * 1024 * 1024, // 5MB
        totalBytes: 10 * 1024 * 1024, // 10MB
        progressPercentage: 50,
      };
      renderTable({ activeDownloads: [download] });
      const progressSpan = screen.getByTestId('module-row-progress-ZZZ');
      const progressRing = progressSpan.querySelector('[role="progressbar"]');
      expect(progressRing).toBeInTheDocument();
      expect(progressRing).toHaveAttribute('aria-valuenow', '50');
    });

    it('shows an indeterminate spinner when totalBytes is unknown', () => {
      const download: import('../../stores/module/types').DownloadProgress = {
        queueId: 1,
        moduleId: 'cat-ZZZ',
        moduleName: 'Zeta Bible',
        status: 'downloading',
        progressBytes: 0,
        totalBytes: undefined,
        progressPercentage: 0,
      };
      renderTable({ activeDownloads: [download] });
      const progressSpan = screen.getByTestId('module-row-progress-ZZZ');
      const progressRing = progressSpan.querySelector('[role="progressbar"]');
      expect(progressRing).toBeInTheDocument();
      // Indeterminate spinner has no aria-valuenow
      expect(progressRing).not.toHaveAttribute('aria-valuenow');
    });

    it('shows a paused indicator when download is paused', () => {
      const download: import('../../stores/module/types').DownloadProgress = {
        queueId: 1,
        moduleId: 'cat-ZZZ',
        moduleName: 'Zeta Bible',
        status: 'paused',
        progressBytes: 5 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024,
        progressPercentage: 50,
      };
      renderTable({ activeDownloads: [download] });
      const progressSpan = screen.getByTestId('module-row-progress-ZZZ');
      expect(within(progressSpan).getByRole('img', { name: /paused/i })).toBeInTheDocument();
    });

    it('shows a failed indicator when download failed', () => {
      const download: import('../../stores/module/types').DownloadProgress = {
        queueId: 1,
        moduleId: 'cat-ZZZ',
        moduleName: 'Zeta Bible',
        status: 'failed',
        progressBytes: 5 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024,
        progressPercentage: 50,
        errorMessage: 'Network error',
      };
      renderTable({ activeDownloads: [download] });
      const progressSpan = screen.getByTestId('module-row-progress-ZZZ');
      expect(within(progressSpan).getByRole('img', { name: /failed/i })).toBeInTheDocument();
    });

    it('hides status text and Install/Update button while downloading', () => {
      const download: import('../../stores/module/types').DownloadProgress = {
        queueId: 1,
        moduleId: 'cat-ZZZ',
        moduleName: 'Zeta Bible',
        status: 'downloading',
        progressBytes: 0,
        totalBytes: 10 * 1024 * 1024,
        progressPercentage: 0,
      };
      renderTable({ activeDownloads: [download] });
      const row = screen.getByTestId('module-row-ZZZ');
      expect(within(row).queryByText('Not installed')).not.toBeInTheDocument();
      expect(within(row).queryByTestId('module-row-install-ZZZ')).not.toBeInTheDocument();
    });

    it('disables Install/Update button while pending or downloading', () => {
      const downloadPending: import('../../stores/module/types').DownloadProgress = {
        queueId: 1,
        moduleId: 'cat-BBB',
        moduleName: 'Beta Bible',
        status: 'pending',
        progressBytes: 0,
        totalBytes: 10 * 1024 * 1024,
        progressPercentage: 0,
      };
      renderTable({ activeDownloads: [downloadPending] });
      // BBB doesn't have a button because the row shows the download instead
      expect(screen.queryByTestId('module-row-install-BBB')).not.toBeInTheDocument();
    });

    it('matches download by catalog module id for an available module', () => {
      const download: import('../../stores/module/types').DownloadProgress = {
        queueId: 1,
        moduleId: 'cat-ZZZ',
        moduleName: 'Zeta Bible',
        status: 'downloading',
        progressBytes: 2 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024,
        progressPercentage: 20,
      };
      renderTable({ activeDownloads: [download] });
      const progressSpan = screen.getByTestId('module-row-progress-ZZZ');
      const progressRing = progressSpan.querySelector('[role="progressbar"]');
      expect(progressRing).toHaveAttribute('aria-valuenow', '20');
    });

    it('matches download by installed module id when updating', () => {
      const download: import('../../stores/module/types').DownloadProgress = {
        queueId: 1,
        moduleId: '1', // installed module id, not catalog
        moduleName: 'Mu Bible',
        status: 'downloading',
        progressBytes: 3 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024,
        progressPercentage: 30,
      };
      renderTable({ activeDownloads: [download] });
      // MMM is an update (installed with id 1), so matching by installed id should work
      const progressSpan = screen.getByTestId('module-row-progress-MMM');
      const progressRing = progressSpan.querySelector('[role="progressbar"]');
      expect(progressRing).toHaveAttribute('aria-valuenow', '30');
    });
  });
});
