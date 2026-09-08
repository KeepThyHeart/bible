import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ModuleCard from './ModuleCard';
import { useModuleStore } from '../stores/useModuleStore';
import type { CatalogModule, ModuleMetadata } from '../stores/useModuleStore';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enString, enT } from '../testing/enCatalog';

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

const mockCatalogModule: CatalogModule = {
  module_id: 'kjv-catalog',
  module_type: 'bible',
  name: 'King James Version',
  abbreviation: 'KJV',
  description: 'The classic King James Bible translation.',
  version: '1.0',
  language_code: 'en',
  download_size_bytes: 5000000,
  installed_size_bytes: 5000000,
  recommended: true,
  author: 'Public Domain',
  publisher: 'Bible Society',
  year_published: 1611,
  license: 'Public Domain',
  features: ['strongs', 'morphology'],
  tags: [],
  download_url: 'https://example.com/kjv.db',
  checksum: 'abc123',
  created_date: '2024-01-01',
  updated_date: '2024-04-01',
};

const mockInstalledModule: ModuleMetadata = {
  module_id: 1,
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
  user_hidden: false,
};

describe('ModuleCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModuleStore.setState({
      installedModules: [],
      installModule: vi.fn().mockResolvedValue(true),
      uninstallModule: vi.fn().mockResolvedValue(undefined),
      updateModule: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('renders module name and abbreviation', () => {
    renderWithProviders(<ModuleCard module={mockCatalogModule} viewMode="available" />);
    expect(screen.getByText('King James Version')).toBeInTheDocument();
    expect(screen.getByText('KJV')).toBeInTheDocument();
  });

  it('shows Install button for uninstalled catalog module', () => {
    renderWithProviders(<ModuleCard module={mockCatalogModule} viewMode="available" />);
    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument();
  });

  it('shows Installed badge when module is already installed', () => {
    // Use an installed module that matches the catalog module abbreviation (KJV)
    const installedKjv = { ...mockInstalledModule, abbreviation: 'KJV' };
    useModuleStore.setState({
      installedModules: [installedKjv],
      installModule: vi.fn(),
      uninstallModule: vi.fn(),
      updateModule: vi.fn(),
    });
    renderWithProviders(<ModuleCard module={mockCatalogModule} viewMode="available" />);
    expect(screen.getByText('Installed')).toBeInTheDocument();
  });

  it('shows Recommended badge for recommended modules', () => {
    renderWithProviders(<ModuleCard module={mockCatalogModule} viewMode="available" />);
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('shows Uninstall button for installed module without update', () => {
    renderWithProviders(<ModuleCard module={mockInstalledModule} viewMode="available" />);
    expect(screen.getByRole('button', { name: /uninstall/i })).toBeInTheDocument();
  });

  it('shows Update button when update is available', () => {
    const moduleWithUpdate: ModuleMetadata = { ...mockInstalledModule, update_available: true };
    renderWithProviders(<ModuleCard module={moduleWithUpdate} viewMode="available" />);
    expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument();
  });

  it('calls installModule when Install button is clicked', async () => {
    const user = userEvent.setup();
    const installModule = vi.fn().mockResolvedValue(true);
    useModuleStore.setState({
      installedModules: [],
      installModule,
      uninstallModule: vi.fn(),
      updateModule: vi.fn(),
    });
    renderWithProviders(<ModuleCard module={mockCatalogModule} viewMode="available" />);
    await user.click(screen.getByRole('button', { name: /install/i }));
    await waitFor(() => {
      expect(installModule).toHaveBeenCalledWith(mockCatalogModule.module_id);
    });
  });

  it('toggles details panel on Show/Hide details click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ModuleCard module={mockCatalogModule} viewMode="available" />);
    // Before expansion, Author label should not be visible
    expect(screen.queryByText(enString('moduleCard.authorLabel'))).not.toBeInTheDocument();
    await user.click(screen.getByText('Show details'));
    // After expansion, Author label should be visible
    expect(screen.getByText(enString('moduleCard.authorLabel'))).toBeInTheDocument();
    await user.click(screen.getByText('Hide details'));
    expect(screen.queryByText(enString('moduleCard.authorLabel'))).not.toBeInTheDocument();
  });
});
