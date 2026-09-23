/**
 * `showNotification` resolving with the clicked action id (P1.10).
 *
 * Before this, `showNotification` was fire-and-forget: `opts.actions` was
 * accepted and validated but never rendered (a toast was just a message and
 * a dismiss button), and the promise resolved the instant the toast was
 * queued rather than when the user actually did something. These tests
 * drive the real store + `ExtensionUiHost` together, the same way a worker's
 * `await api.ui.showNotification(...)` call would resolve in production.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExtensionUiHost from '../components/extensions/ExtensionUiHost';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { useExtensionUiStore } from './extensionUiStore';

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) =>
        typeof v === 'object' && v !== null && 'key' in v
          ? String((v as { key: string }).key)
          : String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderHost() {
  return render(
    <ContextProvider services={createMockServices()}>
      <ExtensionUiHost />
    </ContextProvider>,
  );
}

function resetStore(): void {
  useExtensionUiStore.setState({ notifications: [], modal: null });
}

describe('showNotification resolves with the clicked action (or undefined)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders opts.actions as buttons and resolves with the clicked one', async () => {
    const user = userEvent.setup();
    renderHost();

    const resultPromise = useExtensionUiStore.getState().pushNotification(
      'ext.test.x',
      'Sync failed',
      { actions: [{ id: 'retry', label: 'Retry' }, { id: 'ignore', label: 'Ignore' }] },
    );

    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    await user.click(retryButton);

    await expect(resultPromise).resolves.toBe('retry');
    expect(screen.queryByText('Sync failed')).not.toBeInTheDocument();
  });

  it('resolves undefined when the × dismiss button is clicked', async () => {
    const user = userEvent.setup();
    renderHost();

    const resultPromise = useExtensionUiStore.getState().pushNotification(
      'ext.test.x',
      'Just FYI',
      { durationMs: 0, actions: [{ id: 'ok', label: 'OK' }] },
    );

    const notification = await screen.findByTestId('extension-notification');
    const dismissButton = notification.querySelector('button:not([data-testid])');
    expect(dismissButton).not.toBeNull();
    await user.click(dismissButton as HTMLButtonElement);

    await expect(resultPromise).resolves.toBeUndefined();
  });

  it('resolves undefined on auto-dismiss timeout when no action was clicked', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = useExtensionUiStore
        .getState()
        .pushNotification('ext.test.x', 'Heads up', { durationMs: 500 });
      await vi.advanceTimersByTimeAsync(600);
      await expect(resultPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a sticky notification (durationMs: 0) with no actions still resolves via manual dismiss', async () => {
    const resultPromise = useExtensionUiStore
      .getState()
      .pushNotification('ext.test.x', 'Sticky', { durationMs: 0 });
    const id = useExtensionUiStore.getState().notifications[0]!.id;
    useExtensionUiStore.getState().dismissNotification(id);
    await expect(resultPromise).resolves.toBeUndefined();
  });
});
