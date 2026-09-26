/**
 * `RepositorySettings`' catalog-signature badge - see `design-pack-trust.md`
 * item C. Covers the badge/copy mapping only (the rest of the component's
 * behaviour - add/remove/refresh/edit-url - is exercised only indirectly
 * elsewhere today; this file adds targeted coverage for the new badge without
 * expanding scope).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import RepositorySettings from './RepositorySettings';
import { useModuleStore, type ModuleCatalog } from '../stores/useModuleStore';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enT } from '../testing/enCatalog';

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

function repo(overrides: Partial<ModuleCatalog>): ModuleCatalog {
  return {
    catalogId: 1,
    name: 'Test catalog',
    url: 'https://example.test/catalog.json',
    type: 'third_party',
    isEnabled: true,
    priority: 0,
    ...overrides,
  };
}

describe('RepositorySettings signature badge', () => {
  beforeEach(() => {
    useModuleStore.setState({
      loadingRepositories: false,
      addRepository: vi.fn(),
      removeRepository: vi.fn(),
      updateRepositoryUrl: vi.fn(),
      setRepositoryEnabled: vi.fn(),
      refreshCatalog: vi.fn(),
      loadAvailableModules: vi.fn(),
    });
  });

  it('shows "Verified (Keep Thy Heart)" for a verified official catalog', () => {
    useModuleStore.setState({
      repositories: [repo({ catalogId: 1, type: 'official', signatureStatus: 'verified' })],
    });
    renderWithProviders(<RepositorySettings />);
    expect(screen.getByTestId('repository-signature-badge-1')).toHaveTextContent('Verified (Keep Thy Heart)');
  });

  it('shows plain "Signed" for a verified non-official catalog', () => {
    useModuleStore.setState({
      repositories: [repo({ catalogId: 2, type: 'third_party', signatureStatus: 'verified' })],
    });
    renderWithProviders(<RepositorySettings />);
    expect(screen.getByTestId('repository-signature-badge-2')).toHaveTextContent('Signed');
    expect(screen.getByTestId('repository-signature-badge-2')).not.toHaveTextContent('Keep Thy Heart');
  });

  it('shows "Unsigned" for an unsigned catalog', () => {
    useModuleStore.setState({
      repositories: [repo({ catalogId: 3, signatureStatus: 'unsigned' })],
    });
    renderWithProviders(<RepositorySettings />);
    expect(screen.getByTestId('repository-signature-badge-3')).toHaveTextContent('Unsigned');
  });

  it.each(['untrusted_key', 'invalid', 'error'] as const)(
    'shows "Signature problem" for a %s catalog',
    (status) => {
      useModuleStore.setState({
        repositories: [repo({ catalogId: 4, signatureStatus: status })],
      });
      renderWithProviders(<RepositorySettings />);
      expect(screen.getByTestId('repository-signature-badge-4')).toHaveTextContent('Signature problem');
    }
  );

  it('shows no badge at all when the catalog has never been fetched', () => {
    useModuleStore.setState({
      repositories: [repo({ catalogId: 5, signatureStatus: undefined })],
    });
    renderWithProviders(<RepositorySettings />);
    expect(screen.queryByTestId('repository-signature-badge-5')).not.toBeInTheDocument();
  });
});
