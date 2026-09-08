import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ModuleSelector, { type ModuleItem } from './ModuleSelector';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
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

const mockModules: ModuleItem[] = [
  { id: 'kjv', name: 'King James Version', abbreviation: 'KJV', languageCode: 'en', version: '1.0' },
  { id: 'esv', name: 'English Standard Version', abbreviation: 'ESV', languageCode: 'en', version: '2.0' },
  { id: 'esp', name: 'Reina Valera', abbreviation: 'RVR', languageCode: 'es', version: '1.0' },
];

describe('ModuleSelector', () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the title and all modules', () => {
    renderWithProviders(
      <ModuleSelector
        title="Select Translation"
        modules={mockModules}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Select Translation')).toBeInTheDocument();
    expect(screen.getByText('King James Version')).toBeInTheDocument();
    expect(screen.getByText('English Standard Version')).toBeInTheDocument();
    expect(screen.getByText('Reina Valera')).toBeInTheDocument();
  });

  it('filters modules based on search input', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleSelector
        title="Select Translation"
        modules={mockModules}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const input = screen.getByPlaceholderText('ui.moduleSelector.filterPlaceholder');
    await user.type(input, 'kjv');
    expect(screen.getByText('King James Version')).toBeInTheDocument();
    expect(screen.queryByText('English Standard Version')).not.toBeInTheDocument();
  });

  it('shows "No matches found" when filter yields no results', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleSelector
        title="Select Translation"
        modules={mockModules}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const input = screen.getByPlaceholderText('ui.moduleSelector.filterPlaceholder');
    await user.type(input, 'zzz_no_match');
    expect(screen.getByText('ui.moduleSelector.noMatches')).toBeInTheDocument();
  });

  it('calls onSelect when a module is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleSelector
        title="Select Translation"
        modules={mockModules}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByText('King James Version'));
    expect(onSelect).toHaveBeenCalledWith(mockModules[0]);
  });

  it('calls onClose when Escape is pressed in the input', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleSelector
        title="Select Translation"
        modules={mockModules}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const input = screen.getByPlaceholderText('ui.moduleSelector.filterPlaceholder');
    await user.click(input);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('selects module with Enter key', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleSelector
        title="Select Translation"
        modules={mockModules}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    // The first module (index 0) is selected by default
    const input = screen.getByPlaceholderText('ui.moduleSelector.filterPlaceholder');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(mockModules[0]);
  });

  it('navigates with arrow keys and selects with Enter', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleSelector
        title="Select Translation"
        modules={mockModules}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const input = screen.getByPlaceholderText('ui.moduleSelector.filterPlaceholder');
    await user.click(input);
    // Press ArrowDown twice to get to index 2 (third module), then Enter
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    // Should select third module (index 2)
    expect(onSelect).toHaveBeenCalledWith(mockModules[2]);
  });

  it('shows loading state', () => {
    renderWithProviders(
      <ModuleSelector
        title="Select Translation"
        modules={[]}
        isLoading={true}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('ui.moduleSelector.loading')).toBeInTheDocument();
  });

  it('shows empty message when no modules', () => {
    renderWithProviders(
      <ModuleSelector
        title="Select Translation"
        modules={[]}
        emptyMessage="No modules installed."
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('No modules installed.')).toBeInTheDocument();
  });
});

// ModuleSelector is generic (used for Bible translations, dictionaries, etc.)
// so the per-passage availability badge is strictly opt-in: a module without
// `availabilityLabel`/`availabilityLoading` renders exactly as before.
describe('ModuleSelector: availability badge (opt-in)', () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders no badge and no loading text when a caller supplies neither field', () => {
    renderWithProviders(
      <ModuleSelector title="Select Commentary" modules={mockModules} onSelect={onSelect} onClose={onClose} />,
    );
    expect(screen.queryByText('ui.moduleSelector.checkingAvailability')).not.toBeInTheDocument();
  });

  it('shows the badge when a module has an availability label', () => {
    const modules: ModuleItem[] = [
      { ...mockModules[0], availabilityLabel: 'Has content for John 3:16' },
      mockModules[1],
    ];
    renderWithProviders(
      <ModuleSelector title="Select Commentary" modules={modules} onSelect={onSelect} onClose={onClose} />,
    );
    expect(screen.getByText('Has content for John 3:16')).toBeInTheDocument();
  });

  it('shows a loading indicator instead of a badge while a check is in flight', () => {
    const modules: ModuleItem[] = [
      { ...mockModules[0], availabilityLoading: true },
      { ...mockModules[1], availabilityLabel: 'Has content for John 3:16' },
    ];
    renderWithProviders(
      <ModuleSelector title="Select Commentary" modules={modules} onSelect={onSelect} onClose={onClose} />,
    );
    expect(screen.getAllByText('ui.moduleSelector.checkingAvailability')).toHaveLength(1);
    // A module with a resolved label still shows its badge even while a
    // sibling module is still loading - the loading state is per-item.
    expect(screen.getByText('Has content for John 3:16')).toBeInTheDocument();
  });

  it('prefers the loading indicator over a stale label when both are set', () => {
    const modules: ModuleItem[] = [
      { ...mockModules[0], availabilityLoading: true, availabilityLabel: 'Has content for John 3:16' },
    ];
    renderWithProviders(
      <ModuleSelector title="Select Commentary" modules={modules} onSelect={onSelect} onClose={onClose} />,
    );
    expect(screen.getByText('ui.moduleSelector.checkingAvailability')).toBeInTheDocument();
    expect(screen.queryByText('Has content for John 3:16')).not.toBeInTheDocument();
  });

  it('does not affect selection or filtering behavior', async () => {
    const user = userEvent.setup();
    const modules: ModuleItem[] = [
      { ...mockModules[0], availabilityLabel: 'Has content for John 3:16' },
      mockModules[1],
    ];
    renderWithProviders(
      <ModuleSelector title="Select Commentary" modules={modules} onSelect={onSelect} onClose={onClose} />,
    );
    await user.click(screen.getByText('King James Version'));
    expect(onSelect).toHaveBeenCalledWith(modules[0]);
  });
});

describe('ModuleSelector: remove affordance (opt-in)', () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const onRemove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders no remove button when the caller supplies no onRemove', () => {
    const modules: ModuleItem[] = [{ ...mockModules[0], openCount: 1 }];
    renderWithProviders(
      <ModuleSelector title="Select Commentary" modules={modules} onSelect={onSelect} onClose={onClose} />,
    );
    expect(screen.queryByTestId('module-selector-remove')).not.toBeInTheDocument();
  });

  it('renders a remove button only for modules that are already open', () => {
    const modules: ModuleItem[] = [
      { ...mockModules[0], openCount: 1 },
      { ...mockModules[1], openCount: 0 },
      mockModules[2],
    ];
    renderWithProviders(
      <ModuleSelector
        title="Select Commentary"
        modules={modules}
        onSelect={onSelect}
        onRemove={onRemove}
        removeLabel="Remove this commentary"
        onClose={onClose}
      />,
    );
    const removes = screen.getAllByTestId('module-selector-remove');
    expect(removes).toHaveLength(1);
    expect(removes[0]).toHaveAttribute('data-module-id', 'kjv');
    expect(removes[0]).toHaveAccessibleName('Remove this commentary');
  });

  it('calls onRemove without also selecting the module', async () => {
    const user = userEvent.setup();
    const modules: ModuleItem[] = [{ ...mockModules[0], openCount: 1 }];
    renderWithProviders(
      <ModuleSelector
        title="Select Commentary"
        modules={modules}
        onSelect={onSelect}
        onRemove={onRemove}
        removeLabel="Remove this commentary"
        onClose={onClose}
      />,
    );
    await user.click(screen.getByTestId('module-selector-remove'));
    expect(onRemove).toHaveBeenCalledWith(modules[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
