import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import AdvancedPaneManagerGateDialog from './AdvancedPaneManagerGateDialog';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import enUi from '../../../locales/en/ui.json';

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

describe('AdvancedPaneManagerGateDialog', () => {
  it('renders the explanation and a reference to the Layout button', () => {
    renderWithProviders(<AdvancedPaneManagerGateDialog onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Layout button/)).toBeInTheDocument();
  });

  it('disables the confirm button until the checkbox is checked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(<AdvancedPaneManagerGateDialog onCancel={vi.fn()} onConfirm={onConfirm} />);

    const confirmButton = screen.getByTestId('advanced-pane-manager-gate-confirm');
    expect(confirmButton).toBeDisabled();

    await user.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('advanced-pane-manager-gate-checkbox'));
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Cancel is clicked, without enabling anything', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderWithProviders(<AdvancedPaneManagerGateDialog onCancel={onCancel} onConfirm={onConfirm} />);

    await user.click(screen.getByTestId('advanced-pane-manager-gate-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel when the overlay is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { container } = renderWithProviders(
      <AdvancedPaneManagerGateDialog onCancel={onCancel} onConfirm={vi.fn()} />,
    );
    const overlay = container.querySelector('[data-testid="advanced-pane-manager-gate-overlay"]');
    if (overlay) await user.click(overlay);
    expect(onCancel).toHaveBeenCalled();
  });
});
