import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import AdvancedSearchDialog from './AdvancedSearchDialog';
import { useSearchStore } from '../stores/useSearchStore';
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

describe('AdvancedSearchDialog', () => {
  const performSearch = vi.fn().mockResolvedValue(undefined);
  const setSearchOptions = vi.fn();
  const closeAdvancedDialog = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSearchStore.setState({
      query: 'love',
      searchOptions: {
        scope: 'currentModule',
        caseSensitive: false,
        wholeWord: false,
        fuzzyDistance: 2,
        proximityDistance: 0,
        maxResults: 200,
        includeContext: false,
        autoFuzzy: true,
      },
      isAdvancedDialogOpen: true,
      closeAdvancedDialog,
      setSearchOptions,
      performSearch,
    });
  });

  it('renders nothing when dialog is closed', () => {
    useSearchStore.setState({ isAdvancedDialogOpen: false });
    renderWithProviders(<AdvancedSearchDialog />);
    expect(screen.queryByTestId('advanced-search-dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog when isAdvancedDialogOpen is true', () => {
    renderWithProviders(<AdvancedSearchDialog />);
    expect(screen.getByTestId('advanced-search-dialog')).toBeInTheDocument();
  });

  it('shows the title', () => {
    renderWithProviders(<AdvancedSearchDialog />);
    expect(screen.getByText(enString('advancedSearchDialog.title'))).toBeInTheDocument();
  });

  it('pre-fills the query input', () => {
    renderWithProviders(<AdvancedSearchDialog />);
    const input = screen.getByPlaceholderText(enString('advancedSearchDialog.queryPlaceholder'));
    expect(input).toHaveValue('love');
  });

  it('shows scope selector', () => {
    renderWithProviders(<AdvancedSearchDialog />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('shows checkboxes for search options', () => {
    renderWithProviders(<AdvancedSearchDialog />);
    expect(screen.getByText(enString('advancedSearchDialog.caseSensitive'))).toBeInTheDocument();
    expect(screen.getByText(enString('advancedSearchDialog.wholeWordOnly'))).toBeInTheDocument();
    expect(screen.getByText(enString('advancedSearchDialog.includeContext'))).toBeInTheDocument();
    expect(screen.getByText(enString('advancedSearchDialog.autoFuzzy'))).toBeInTheDocument();
  });

  it('calls closeAdvancedDialog when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdvancedSearchDialog />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(closeAdvancedDialog).toHaveBeenCalled();
  });

  it('calls performSearch and setSearchOptions when Search is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdvancedSearchDialog />);
    // The Search button has exact text "Search"
    await user.click(screen.getByText('Search'));
    expect(setSearchOptions).toHaveBeenCalled();
    expect(performSearch).toHaveBeenCalledWith('love');
  });

  it('closes when Escape key is pressed (clicking overlay)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdvancedSearchDialog />);
    // Click the overlay (backdrop) to close
    const overlay = document.querySelector('.fixed.inset-0.bg-background-overlay');
    if (overlay) {
      await user.click(overlay as HTMLElement);
    }
    expect(closeAdvancedDialog).toHaveBeenCalled();
  });

  it('has accessible dialog role', () => {
    renderWithProviders(<AdvancedSearchDialog />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
