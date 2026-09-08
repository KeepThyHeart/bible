import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaneOptionsMenu, { type PaneMenuOption } from './PaneOptionsMenu';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

function createMockI18n() {
  return {
    t: (key: string) => {
      const map: Record<string, string> = {
        'ui.paneOptions.menu': 'More options',
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

describe('PaneOptionsMenu', () => {
  const mockOptions: PaneMenuOption[] = [
    { id: 'pop-out', label: 'Pop Out', icon: '📤', onClick: vi.fn() },
    { id: 'settings', label: 'Settings', icon: '⚙️', onClick: vi.fn() },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ellipsis button', () => {
    renderWithProviders(<PaneOptionsMenu options={mockOptions} />);

    const button = screen.getByLabelText(/More options/i);
    expect(button).toBeInTheDocument();
  });

  it('opens menu when button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaneOptionsMenu options={mockOptions} />);

    const button = screen.getByLabelText(/More options/i);
    await user.click(button);

    expect(screen.getByText('Pop Out')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders menu options', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaneOptionsMenu options={mockOptions} />);

    const button = screen.getByLabelText(/More options/i);
    await user.click(button);

    mockOptions.forEach(option => {
      expect(screen.getByText(option.label)).toBeInTheDocument();
    });
  });

  it('calls onClick handler when option is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const options: PaneMenuOption[] = [
      { id: 'test', label: 'Test Option', onClick },
    ];

    renderWithProviders(<PaneOptionsMenu options={options} />);

    const button = screen.getByLabelText(/More options/i);
    await user.click(button);

    const option = screen.getByText('Test Option');
    await user.click(option);

    expect(onClick).toHaveBeenCalled();
  });

  it('closes menu after option is selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaneOptionsMenu options={mockOptions} />);

    const button = screen.getByLabelText(/More options/i);
    await user.click(button);

    expect(screen.getByText('Pop Out')).toBeInTheDocument();

    const option = screen.getByText('Pop Out');
    await user.click(option);

    await waitFor(() => {
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });
  });

  it('closes menu when clicking outside', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaneOptionsMenu options={mockOptions} />);

    const button = screen.getByLabelText(/More options/i);
    await user.click(button);

    expect(screen.getByText('Pop Out')).toBeInTheDocument();

    await user.click(document.body);

    await waitFor(() => {
      expect(screen.queryByText('Pop Out')).not.toBeInTheDocument();
    });
  });

  it('shows menu icons when provided', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaneOptionsMenu options={mockOptions} />);

    const button = screen.getByLabelText(/More options/i);
    await user.click(button);

    expect(screen.getByText('📤')).toBeInTheDocument();
    expect(screen.getByText('⚙️')).toBeInTheDocument();
  });

  it('disables option when disabled prop is true', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const options: PaneMenuOption[] = [
      {
        id: 'disabled',
        label: 'Disabled Option',
        onClick,
        disabled: true,
      },
    ];

    renderWithProviders(<PaneOptionsMenu options={options} />);

    const button = screen.getByLabelText(/More options/i);
    await user.click(button);

    const option = screen.getByText('Disabled Option');
    expect(option.closest('button')).toBeDisabled();

    await user.click(option);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('supports lightText prop for dark backgrounds', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PaneOptionsMenu options={mockOptions} lightText={true} />
    );

    const button = screen.getByLabelText(/More options/i);
    expect(button).toHaveClass('text-white/80');

    await user.click(button);
    expect(screen.getByText('Pop Out')).toBeInTheDocument();
  });

  it('applies custom buttonClassName', () => {
    renderWithProviders(
      <PaneOptionsMenu options={mockOptions} buttonClassName="custom-class" />
    );

    const button = screen.getByLabelText(/More options/i);
    expect(button).toHaveClass('custom-class');
  });

  it('has aria-expanded attribute', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaneOptionsMenu options={mockOptions} />);

    const button = screen.getByLabelText(/More options/i);
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders empty menu gracefully', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaneOptionsMenu options={[]} />);

    const button = screen.getByLabelText(/More options/i);
    await user.click(button);

    // Menu opens but is empty
    const menu = document.querySelector('[role="menu"]');
    expect(menu).toBeInTheDocument();
  });
});
