import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import PreferencesDialog from './PreferencesDialog';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import enUi from '../../../locales/en/ui.json';

// The dialog's chrome (heading, section labels, Done) is catalog data, so the
// stub resolves against the real `en` catalog rather than a hand-written map:
// a mistyped key renders `[key]` and fails the assertion instead of silently
// matching a copy of the same typo.
const catalog = enUi as Record<string, string>;

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => catalog[key] ?? `[${key}]`,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

// Mock hooks
vi.mock('../hooks/useTabKeyboardNav', () => ({
  useTabKeyboardNav: () => ({ tablistRef: { current: null }, onKeyDown: vi.fn() }),
}));

vi.mock('./PreferencesDialog/useDialogShell', () => ({
  useDialogShell: vi.fn(),
}));

// Mock section components
vi.mock('./PreferencesDialog/GeneralSection', () => ({
  GeneralSection: () => <div data-testid="general-section">General Content</div>,
}));
vi.mock('./PreferencesDialog/TypographySection', () => ({
  TypographySection: () => <div data-testid="typography-section">Typography Content</div>,
}));
vi.mock('./PreferencesDialog/FontsSection', () => ({
  FontsSection: () => <div data-testid="fonts-section">Fonts Content</div>,
}));
vi.mock('./PreferencesDialog/ThemesSection', () => ({
  ThemesSection: () => <div data-testid="themes-section">Themes Content</div>,
}));
vi.mock('./ExtensionsSection', () => ({
  ExtensionsSection: () => <div data-testid="extensions-section">Extensions Content</div>,
}));
vi.mock('./diagnostics/DiagnosticsSettings', () => ({
  default: () => <div data-testid="diagnostics-section">Diagnostics Content</div>,
}));

describe('PreferencesDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the dialog with title', () => {
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    expect(screen.getByText('Preferences')).toBeInTheDocument();
  });

  it('renders all section tabs', () => {
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    // Each tab should have the section label
    expect(tabs[0]).toHaveTextContent('General');
    expect(tabs[1]).toHaveTextContent('Typography');
    expect(tabs[2]).toHaveTextContent('Fonts');
    expect(tabs[3]).toHaveTextContent('Themes');
    expect(tabs[4]).toHaveTextContent('Extensions');
    expect(tabs[5]).toHaveTextContent('Diagnostics');
  });

  it('shows General section by default', () => {
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    expect(screen.getByTestId('general-section')).toBeInTheDocument();
  });

  it('switches to Fonts section when clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    // Click Fonts tab - there will be both the tab button and the header; use getAllByText and click first
    const fontsButtons = screen.getAllByText('Fonts');
    await user.click(fontsButtons[0]);
    expect(screen.getByTestId('fonts-section')).toBeInTheDocument();
    expect(screen.queryByTestId('general-section')).not.toBeInTheDocument();
  });

  it('switches to Themes section when clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    const themesButtons = screen.getAllByText('Themes');
    await user.click(themesButtons[0]);
    expect(screen.getByTestId('themes-section')).toBeInTheDocument();
  });

  it('switches to Extensions section when clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    const extButtons = screen.getAllByText('Extensions');
    await user.click(extButtons[0]);
    expect(screen.getByTestId('extensions-section')).toBeInTheDocument();
  });

  it('switches to Diagnostics section when clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    const diagButtons = screen.getAllByText('Diagnostics');
    await user.click(diagButtons[0]);
    expect(screen.getByTestId('diagnostics-section')).toBeInTheDocument();
  });

  it('calls onClose when Done button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    await user.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay is clicked', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<PreferencesDialog onClose={onClose} />);
    // Click the outer overlay div
    const overlay = container.querySelector('.fixed.inset-0');
    if (overlay) await user.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders with initialSection set to fonts', () => {
    renderWithProviders(<PreferencesDialog onClose={onClose} initialSection="fonts" />);
    expect(screen.getByTestId('fonts-section')).toBeInTheDocument();
    expect(screen.queryByTestId('general-section')).not.toBeInTheDocument();
  });

  it('uses correct ARIA attributes for dialog', () => {
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'preferences-dialog-title');
  });

  it('renders section tabs with correct ARIA roles', () => {
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
  });

  it('gives the tablist an accessible name resolved from the catalog', () => {
    // Moving the aria-label into the catalog must not leave a bare key (or
    // nothing at all) as the accessible name.
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    expect(
      screen.getByRole('tablist', { name: 'Preferences sections' })
    ).toBeInTheDocument();
  });

  it('switches to Typography section when clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PreferencesDialog onClose={onClose} />);
    const buttons = screen.getAllByText('Typography');
    await user.click(buttons[0]);
    expect(screen.getByTestId('typography-section')).toBeInTheDocument();
    expect(screen.queryByTestId('general-section')).not.toBeInTheDocument();
  });

  it('keeps a fixed dialog height when switching between short and tall sections', async () => {
    // KAN QA 4.1: the dialog must not grow/shrink to fit each section's content
    // (short sections like General vs. tall ones like Typography/Fonts). Only
    // the inner content region should scroll. jsdom can't measure real layout,
    // so assert the fixed-height class survives the section switch instead.
    const user = userEvent.setup();
    const { container } = renderWithProviders(<PreferencesDialog onClose={onClose} />);
    const dialog = () => container.querySelector('[role="dialog"]');

    // General (short section) is shown first.
    expect(screen.getByTestId('general-section')).toBeInTheDocument();
    expect(dialog()).toHaveClass('h-[min(85vh,700px)]');

    // Switch to Typography (tall section).
    const typographyButtons = screen.getAllByText('Typography');
    await user.click(typographyButtons[0]);
    expect(screen.getByTestId('typography-section')).toBeInTheDocument();
    expect(dialog()).toHaveClass('h-[min(85vh,700px)]');

    // Switch back to General (short section) - height class must still be present.
    const generalButtons = screen.getAllByText('General');
    await user.click(generalButtons[0]);
    expect(screen.getByTestId('general-section')).toBeInTheDocument();
    expect(dialog()).toHaveClass('h-[min(85vh,700px)]');
  });
});
