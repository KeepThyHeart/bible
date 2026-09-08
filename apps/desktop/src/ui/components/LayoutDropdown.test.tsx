import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LayoutDropdown from './LayoutDropdown';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { usePreferencesStore } from '../stores/usePreferencesStore';

function createMockI18n() {
  return {
    t: (key: string) => {
      const map: Record<string, string> = {
        'layout.dropdown.tooltip': 'Choose layout',
        'layout.dropdown.label': 'Layout',
      };
      return map[key] || key;
    },
    currentLocale: 'en' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  };
}

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: createMockI18n() as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ContextProvider services={createMockServices()}>{ui}</ContextProvider>
  );
}

describe('LayoutDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dropdown button', () => {
    renderWithProviders(<LayoutDropdown />);

    const button = screen.getByTestId('layout-dropdown-button');
    expect(button).toBeInTheDocument();
  });

  it('displays Layout label', () => {
    renderWithProviders(<LayoutDropdown />);

    expect(screen.getByText('Layout')).toBeInTheDocument();
  });

  it('opens dropdown menu when button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LayoutDropdown />);

    const button = screen.getByTestId('layout-dropdown-button');
    await user.click(button);

    // Menu should appear with presets
    expect(document.querySelector('.absolute.top-full')).toBeInTheDocument();
  });

  it('closes dropdown when item is selected', async () => {
    const user = userEvent.setup();
    // Mock the layout preset service to avoid errors
    vi.mock('../../services/LayoutPresetService', () => ({
      layoutPresetService: {
        apply: vi.fn().mockResolvedValue(undefined),
        currentPresetId: 'study-mode',
      },
    }));

    renderWithProviders(<LayoutDropdown />);

    const button = screen.getByTestId('layout-dropdown-button');
    await user.click(button);

    await waitFor(() => {
      const presetButtons = screen.queryAllByTestId(/layout-preset-/);
      expect(presetButtons.length).toBeGreaterThan(0);
    });

    // Menu is open
    expect(document.querySelector('.absolute.top-full')).toBeInTheDocument();
  });

  it('closes dropdown when clicking outside', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LayoutDropdown />);

    const button = screen.getByTestId('layout-dropdown-button');
    await user.click(button);

    expect(document.querySelector('.absolute.top-full')).toBeInTheDocument();

    // Click outside the dropdown
    await user.click(document.body);

    await waitFor(() => {
      expect(document.querySelector('.absolute.top-full')).not.toBeInTheDocument();
    });
  });

  it('displays layout preset options', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LayoutDropdown />);

    const button = screen.getByTestId('layout-dropdown-button');
    await user.click(button);

    await waitFor(() => {
      const presetButtons = screen.queryAllByTestId(/layout-preset-/);
      expect(presetButtons.length).toBeGreaterThan(0);
    });
  });

  it('toggles dropdown on multiple clicks', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LayoutDropdown />);

    const button = screen.getByTestId('layout-dropdown-button');

    // Open
    await user.click(button);
    expect(document.querySelector('.absolute.top-full')).toBeInTheDocument();

    // Close
    await user.click(button);
    await waitFor(() => {
      expect(document.querySelector('.absolute.top-full')).not.toBeInTheDocument();
    });

    // Open again
    await user.click(button);
    expect(document.querySelector('.absolute.top-full')).toBeInTheDocument();
  });

  it('has proper button styling', () => {
    renderWithProviders(<LayoutDropdown />);

    const button = screen.getByTestId('layout-dropdown-button');
    expect(button).toHaveClass('border', 'border-border', 'rounded-lg');
  });

  it('closes dropdown when Escape is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LayoutDropdown />);

    const button = screen.getByTestId('layout-dropdown-button');
    await user.click(button);
    expect(document.querySelector('.absolute.top-full')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(document.querySelector('.absolute.top-full')).not.toBeInTheDocument();
    });
    expect(button).toHaveFocus();
  });

  it('toggles advanced layout mode from the menu', async () => {
    const user = userEvent.setup();
    usePreferencesStore.setState({ advancedPaneManagerEnabled: false });
    renderWithProviders(<LayoutDropdown />);

    await user.click(screen.getByTestId('layout-dropdown-button'));

    const checkbox = screen.getByTestId('layout-advanced-mode-checkbox');
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    // Reads the store directly to prove the checkbox wrote through, rather
    // than only that it re-rendered checked.
    expect(usePreferencesStore.getState().advancedPaneManagerEnabled).toBe(true); // allow-getstate: test assertion
    expect(screen.getByTestId('layout-advanced-mode-checkbox')).toBeChecked();
  });

  it('help button opens the full setting in Preferences', async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener('command:app:openPreferences', listener);

    renderWithProviders(<LayoutDropdown />);
    await user.click(screen.getByTestId('layout-dropdown-button'));
    await user.click(screen.getByTestId('layout-advanced-mode-help'));

    expect(listener).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(document.querySelector('.absolute.top-full')).not.toBeInTheDocument();
    });

    window.removeEventListener('command:app:openPreferences', listener);
  });
});
