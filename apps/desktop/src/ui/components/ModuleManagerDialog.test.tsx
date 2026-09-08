import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ModuleManagerDialog from './ModuleManagerDialog';
import { useModuleStore } from '../stores/useModuleStore';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enT } from '../testing/enCatalog';

// Mock moduleAPI
vi.mock('../stores/module/moduleAPI', () => ({
  moduleAPI: {
    installFromFile: vi.fn().mockResolvedValue(null),
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

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

describe('ModuleManagerDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useModuleStore.setState({
      isInitialized: true,
      initError: null,
      viewMode: 'available',
      loadingAvailable: false,
      loadingInstalled: false,
      error: null,
      activeDownloads: [],
      repositories: [],
      activeFilter: {},
      availableModules: [],
      installedModules: [],
      searchQuery: '',
      initialize: vi.fn().mockResolvedValue(undefined),
      setViewMode: vi.fn(),
      searchModules: vi.fn(),
      setFilter: vi.fn(),
      clearFilter: vi.fn(),
      refreshAllCatalogs: vi.fn().mockResolvedValue(undefined),
      clearError: vi.fn(),
      startDownloadPolling: vi.fn(),
      stopDownloadPolling: vi.fn(),
      loadInstalledModules: vi.fn().mockResolvedValue(undefined),
      installModule: vi.fn().mockResolvedValue(true),
      uninstallModule: vi.fn().mockResolvedValue(undefined),
      updateModule: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('renders the dialog', () => {
    renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
    // The module manager should render with tabs
    expect(screen.getByText('Available Modules')).toBeInTheDocument();
    expect(screen.getByText('Installed Modules')).toBeInTheDocument();
  });

  it('shows Available Modules tab as active by default', () => {
    renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
    const availableTab = screen.getByTestId('module-manager-available-tab');
    expect(availableTab).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to Installed tab when clicked', async () => {
    const user = userEvent.setup();
    const setViewMode = vi.fn();
    useModuleStore.setState({ setViewMode });

    renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
    await user.click(screen.getByTestId('module-manager-installed-tab'));
    expect(setViewMode).toHaveBeenCalledWith('installed');
  });

  it('renders search input', () => {
    renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('closes when Escape key is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Repositories tab', () => {
    renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
    expect(screen.getByTestId('module-manager-repositories-tab')).toBeInTheDocument();
  });

  it('shows Updates tab', () => {
    renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
    expect(screen.getByText('Updates')).toBeInTheDocument();
  });
});
