import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enString, enT } from '../testing/enCatalog';

function createMockI18n() {
  return {
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
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

describe('KeyboardShortcutsDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockClear();
    vi.clearAllTimers();
  });;

  it('renders dialog with title', () => {
    renderWithProviders(<KeyboardShortcutsDialog onClose={onClose} />);

    expect(
      screen.getByRole('dialog', {
        name: enString('ui.keyboardShortcuts.title'),
      })
    ).toBeInTheDocument();
  });

  it('displays shortcut categories', () => {
    renderWithProviders(<KeyboardShortcutsDialog onClose={onClose} />);

    // Check for common category names
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Editing & Annotations')).toBeInTheDocument();
    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByText('Application')).toBeInTheDocument();
  });

  it('displays keyboard shortcut entries', () => {
    renderWithProviders(<KeyboardShortcutsDialog onClose={onClose} />);

    // Check for some known shortcuts
    expect(screen.getByText(/Go to verse/i)).toBeInTheDocument();
    expect(screen.getByText(/Find in current pane/i)).toBeInTheDocument();
    expect(screen.getByText(/Copy selection/i)).toBeInTheDocument();
  });

  it('renders kbd elements for each key', () => {
    renderWithProviders(<KeyboardShortcutsDialog onClose={onClose} />);

    const kbds = document.querySelectorAll('kbd');
    expect(kbds.length).toBeGreaterThan(0);
  });

  it('closes dialog when close button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<KeyboardShortcutsDialog onClose={onClose} />);

    const closeButton = screen.getByLabelText(enString('ui.keyboardShortcuts.close'));
    await user.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('closes dialog when Escape key is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<KeyboardShortcutsDialog onClose={onClose} />);

    screen.getByRole('dialog');
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('closes dialog when backdrop is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<KeyboardShortcutsDialog onClose={onClose} />);

    // The backdrop is the fixed overlay
    const backdrops = document.querySelectorAll('.fixed.inset-0');
    const backdrop = Array.from(backdrops).find(el =>
      el.classList.contains('bg-background-overlay')
    );
    expect(backdrop).toBeInTheDocument();

    await user.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes dialog with footer button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<KeyboardShortcutsDialog onClose={onClose} />);

    const closeButtons = screen.getAllByText('Close');
    // Click the footer button (last Close button)
    await user.click(closeButtons[closeButtons.length - 1]);

    expect(onClose).toHaveBeenCalled();
  });

  it('has aria-modal attribute set to true', () => {
    renderWithProviders(<KeyboardShortcutsDialog onClose={onClose} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('displays platform-specific shortcut format', () => {
    renderWithProviders(<KeyboardShortcutsDialog onClose={onClose} />);

    // Should display platform info at the top
    const text = document.body.textContent;
    expect(
      text?.includes('Windows / Linux') || text?.includes('macOS')
    ).toBeTruthy();
  });
});
