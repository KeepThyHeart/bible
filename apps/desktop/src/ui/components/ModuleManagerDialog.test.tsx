import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ModuleManagerDialog from './ModuleManagerDialog';
import { useModuleStore } from '../stores/useModuleStore';
import { useNetworkStore } from '../stores/useNetworkStore';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enT } from '../testing/enCatalog';
import { moduleAPI } from '../stores/module/moduleAPI';

// Mock moduleAPI
vi.mock('../stores/module/moduleAPI', () => ({
  moduleAPI: {
    installFromFile: vi.fn().mockResolvedValue(null),
    inspectPack: vi.fn(),
    installPackFromPath: vi.fn(),
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
    // Online by default so the existing tests below exercise the ordinary
    // (network-available) rendering; the offline-specific tests further down
    // set this back to `false` themselves.
    useNetworkStore.setState({ allowWebRequests: true, loaded: true });
    useModuleStore.setState({
      isInitialized: true,
      initError: null,
      viewMode: 'available',
      loadingAvailable: false,
      loadingInstalled: false,
      error: null,
      errorCode: null,
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

  describe('offline banner', () => {
    beforeEach(() => {
      useNetworkStore.setState({ allowWebRequests: false, loaded: true });
    });

    it('shows the banner on the Available tab when the network is off', () => {
      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      expect(screen.getByTestId('module-manager-offline-banner')).toBeInTheDocument();
    });

    it('does not show the banner once the network is on', () => {
      useNetworkStore.setState({ allowWebRequests: true, loaded: true });
      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      expect(screen.queryByTestId('module-manager-offline-banner')).not.toBeInTheDocument();
    });

    it('does not show the banner on the Installed tab', () => {
      useModuleStore.setState({ viewMode: 'installed' });
      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      expect(screen.queryByTestId('module-manager-offline-banner')).not.toBeInTheDocument();
    });

    it('"Turn on" asks the network store, and refreshes on success', async () => {
      const user = userEvent.setup();
      const requestAllow = vi.fn().mockResolvedValue(true);
      const refreshAllCatalogs = vi.fn().mockResolvedValue(undefined);
      useNetworkStore.setState({ requestAllow });
      useModuleStore.setState({ refreshAllCatalogs });

      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      await user.click(screen.getByTestId('module-manager-offline-turn-on'));

      expect(requestAllow).toHaveBeenCalledWith(true);
      expect(refreshAllCatalogs).toHaveBeenCalled();
    });

    it('"Turn on" does not refresh when the confirmation dialog is cancelled', async () => {
      const user = userEvent.setup();
      const requestAllow = vi.fn().mockResolvedValue(false);
      const refreshAllCatalogs = vi.fn().mockResolvedValue(undefined);
      useNetworkStore.setState({ requestAllow });
      useModuleStore.setState({ refreshAllCatalogs });

      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      await user.click(screen.getByTestId('module-manager-offline-turn-on'));

      expect(requestAllow).toHaveBeenCalledWith(true);
      expect(refreshAllCatalogs).not.toHaveBeenCalled();
    });

    it('renders the "Install from a file…" action', () => {
      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      expect(screen.getByTestId('module-manager-offline-install-file')).toBeInTheDocument();
    });

    it('does not render `network_blocked` as the generic red error banner', () => {
      useModuleStore.setState({ error: 'Network egress blocked by offline mode: refresh all catalogs', errorCode: 'network_blocked' });
      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      expect(screen.queryByText(/Network egress blocked/)).not.toBeInTheDocument();
      // The offline banner still renders - the condition is not "no message at all".
      expect(screen.getByTestId('module-manager-offline-banner')).toBeInTheDocument();
    });

    it('keeps showing a real (non-network) error in the generic red banner', () => {
      useModuleStore.setState({ error: 'Disk is full', errorCode: 'internal' });
      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      expect(screen.getByText('Disk is full')).toBeInTheDocument();
    });
  });

  describe('pack drag-and-drop trust gate (.zip and .biblepack alike)', () => {
    const getPathForFile = vi.fn().mockResolvedValue('C:\\fake\\starter.biblepack');

    beforeEach(() => {
      vi.mocked(moduleAPI.inspectPack).mockReset();
      vi.mocked(moduleAPI.installPackFromPath).mockReset();
      getPathForFile.mockReset().mockResolvedValue('C:\\fake\\starter.biblepack');
      // Preserve the other stubbed members `vitest.setup.ts` installs (log,
      // diagnostics, window) - only `webUtils` is new here.
      (window as unknown as { electron: Record<string, unknown> }).electron = {
        ...(window as unknown as { electron: Record<string, unknown> }).electron,
        webUtils: { getPathForFile },
      };
    });

    function dropFile(name: string) {
      const dialog = screen.getByTestId('module-manager-dialog');
      const file = new File(['irrelevant'], name);
      Object.defineProperty(file, 'name', { value: name });
      fireEvent.drop(dialog, { dataTransfer: { files: [file], types: ['Files'] } });
    }

    it('an unsigned pack asks "install anyway?", and confirming installs with acceptUnverified: true', async () => {
      vi.mocked(moduleAPI.inspectPack).mockResolvedValue({
        status: 'unsigned',
        message: 'This pack is not signed.',
      });
      vi.mocked(moduleAPI.installPackFromPath).mockResolvedValue({
        found: 1,
        installed: [{ entryPath: 'kjv.db', moduleName: 'KJV' }],
        failed: [],
        skipped: [],
      });

      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      dropFile('starter.biblepack');

      const confirmButton = await screen.findByTestId('confirm-dialog-confirm');
      expect(screen.getByTestId('confirm-dialog')).toHaveTextContent("This pack isn");
      await userEvent.click(confirmButton);

      await waitFor(() =>
        expect(moduleAPI.installPackFromPath).toHaveBeenCalledWith(
          'C:\\fake\\starter.biblepack',
          true,
          { acceptUnverified: true }
        )
      );
    });

    it('declining the confirmation never calls installPackFromPath', async () => {
      vi.mocked(moduleAPI.inspectPack).mockResolvedValue({
        status: 'untrusted',
        message: 'Signed, but not by a key this app trusts.',
      });

      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      dropFile('starter.biblepack');

      const cancelButton = await screen.findByTestId('confirm-dialog-cancel');
      await userEvent.click(cancelButton);

      expect(moduleAPI.installPackFromPath).not.toHaveBeenCalled();
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });

    it('applies the exact same gate to a plain .zip - the extension decides nothing', async () => {
      getPathForFile.mockResolvedValue('C:\\fake\\bundle.zip');
      vi.mocked(moduleAPI.inspectPack).mockResolvedValue({
        status: 'unsigned',
        message: 'This pack is not signed.',
      });

      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      dropFile('bundle.zip');

      // Asked exactly like a `.biblepack` would be - a renamed unsigned
      // archive gets no free pass.
      const confirmDialog = await screen.findByTestId('confirm-dialog');
      expect(confirmDialog).toHaveTextContent("This pack isn");
      expect(moduleAPI.inspectPack).toHaveBeenCalledWith('C:\\fake\\bundle.zip');

      await userEvent.click(screen.getByTestId('confirm-dialog-cancel'));
      expect(moduleAPI.installPackFromPath).not.toHaveBeenCalled();
    });

    it('an invalid (tampered) pack shows an error and offers no install option', async () => {
      vi.mocked(moduleAPI.inspectPack).mockResolvedValue({
        status: 'invalid',
        message: 'pack.json.sig does not match pack.json.',
      });

      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      dropFile('starter.biblepack');

      await waitFor(() => expect(screen.getByText(/altered or its signature is broken/)).toBeInTheDocument());
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
      expect(moduleAPI.installPackFromPath).not.toHaveBeenCalled();
    });

    it('a verified pack installs straight away with no confirmation', async () => {
      vi.mocked(moduleAPI.inspectPack).mockResolvedValue({
        status: 'verified',
        message: 'Verified: signed by Keep Thy Heart.',
      });
      vi.mocked(moduleAPI.installPackFromPath).mockResolvedValue({
        found: 1,
        installed: [{ entryPath: 'kjv.db', moduleName: 'KJV' }],
        failed: [],
        skipped: [],
      });

      renderWithProviders(<ModuleManagerDialog onClose={onClose} />);
      dropFile('starter.biblepack');

      await waitFor(() =>
        expect(moduleAPI.installPackFromPath).toHaveBeenCalledWith(
          'C:\\fake\\starter.biblepack',
          true,
          { acceptUnverified: false }
        )
      );
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });
  });
});
