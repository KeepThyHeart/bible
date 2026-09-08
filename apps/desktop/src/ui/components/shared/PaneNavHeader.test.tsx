import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaneNavHeader from './PaneNavHeader';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';

function createMockI18n() {
  return {
    t: (key: string) => {
      const map: Record<string, string> = {
        'ui.paneNav.goBack': 'Go back',
        'ui.paneNav.goForward': 'Go forward',
        'ui.paneNav.pin': 'Pin',
        'ui.paneNav.pinned': 'Pinned',
        'ui.paneNav.pinTitle': 'Pin (ignore verse clicks)',
        'ui.paneNav.unpinTitle': 'Unpin (allow verse sync)',
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

describe('PaneNavHeader', () => {
  it('renders back and forward buttons', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    renderWithProviders(
      <PaneNavHeader
        canGoBack={true}
        canGoForward={true}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    renderWithProviders(
      <PaneNavHeader
        canGoBack={true}
        canGoForward={false}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const buttons = screen.getAllByRole('button');
    const backButton = buttons[0];
    await user.click(backButton);

    expect(onBack).toHaveBeenCalled();
  });

  it('calls onForward when forward button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    renderWithProviders(
      <PaneNavHeader
        canGoBack={false}
        canGoForward={true}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const buttons = screen.getAllByRole('button');
    const forwardButton = buttons[1];
    await user.click(forwardButton);

    expect(onForward).toHaveBeenCalled();
  });

  it('calls onTogglePin when pin button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    renderWithProviders(
      <PaneNavHeader
        canGoBack={false}
        canGoForward={false}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const buttons = screen.getAllByRole('button');
    const pinButton = buttons[2];
    await user.click(pinButton);

    expect(onTogglePin).toHaveBeenCalled();
  });

  it('disables back button when canGoBack is false', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    renderWithProviders(
      <PaneNavHeader
        canGoBack={false}
        canGoForward={true}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const buttons = screen.getAllByRole('button');
    const backButton = buttons[0];
    expect(backButton).toBeDisabled();
  });

  it('disables forward button when canGoForward is false', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    renderWithProviders(
      <PaneNavHeader
        canGoBack={true}
        canGoForward={false}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const buttons = screen.getAllByRole('button');
    const forwardButton = buttons[1];
    expect(forwardButton).toBeDisabled();
  });

  it('shows "Pinned" text when pinned is true', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    renderWithProviders(
      <PaneNavHeader
        canGoBack={false}
        canGoForward={false}
        pinned={true}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('shows "Pin" text when pinned is false', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    renderWithProviders(
      <PaneNavHeader
        canGoBack={false}
        canGoForward={false}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    expect(screen.getByText('Pin')).toBeInTheDocument();
  });

  it('pin button is marked pressed and accent-styled when pinned', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    const { container } = renderWithProviders(
      <PaneNavHeader
        canGoBack={false}
        canGoForward={false}
        pinned={true}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const pinnedButton = Array.from(container.querySelectorAll('button')).find(
      btn => btn.textContent === 'Pinned'
    );
    expect(pinnedButton).toHaveAttribute('aria-pressed', 'true');
    expect(pinnedButton?.className).toContain('text-accent');
  });

  it('pin button is not marked pressed when unpinned', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    const { container } = renderWithProviders(
      <PaneNavHeader
        canGoBack={false}
        canGoForward={false}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const pinButton = Array.from(container.querySelectorAll('button')).find(
      btn => btn.textContent === 'Pin'
    );
    expect(pinButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the shared pin icon (svg) inside the pin button', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    renderWithProviders(
      <PaneNavHeader
        canGoBack={false}
        canGoForward={false}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const pinButton = screen.getByTestId('pin-button');
    expect(pinButton.querySelector('svg')).toBeInTheDocument();
  });

  it('both buttons are enabled when canGoBack and canGoForward are true', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    renderWithProviders(
      <PaneNavHeader
        canGoBack={true}
        canGoForward={true}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).not.toBeDisabled();
    expect(buttons[1]).not.toBeDisabled();
  });

  it('has proper title attributes for accessibility', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onTogglePin = vi.fn();

    const { container } = renderWithProviders(
      <PaneNavHeader
        canGoBack={true}
        canGoForward={true}
        pinned={false}
        onBack={onBack}
        onForward={onForward}
        onTogglePin={onTogglePin}
      />
    );

    const buttons = container.querySelectorAll('button');
    expect(buttons[0]).toHaveAttribute('title');
    expect(buttons[1]).toHaveAttribute('title');
  });
});
