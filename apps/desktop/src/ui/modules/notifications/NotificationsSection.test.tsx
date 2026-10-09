import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NotificationsViewState } from '@bible/core/browser';
import { NotificationsSection } from './NotificationsSection';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en' }),
}));

function makeState(over: Partial<NotificationsViewState> = {}): NotificationsViewState {
  return {
    settings: { version: 1, enabled: true, quiet: null, sources: {} },
    sources: [],
    capabilities: { permission: 'granted', whenClosed: 'fires', actions: false },
    timeZone: 'UTC',
    device: { tray: false, openAtLogin: false },
    deviceSupport: { tray: true, openAtLogin: true },
    ...over,
  };
}

let stateListener: ((s: NotificationsViewState) => void) | null;
const unsubscribe = vi.fn();
const api = {
  getState: vi.fn(),
  setSettings: vi.fn(),
  setDevice: vi.fn(),
  sendTest: vi.fn(),
  requestPermission: vi.fn(),
  onStateChanged: vi.fn(),
};

/** The real module client over a fake `window.electron.modules` bridge (the preload's shape). */
const bridge = {
  invoke: (_ns: string, method: string, ...args: unknown[]) => {
    const fn = (api as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!;
    return fn(...args).then(
      (value) => ({ ok: true, value }),
      (err: Error) => ({ ok: false, error: { code: 'internal', message: err.message } }),
    );
  },
  on: (_ns: string, event: string, cb: (s: NotificationsViewState) => void) => {
    expect(event).toBe('state-changed');
    return api.onStateChanged(cb);
  },
};

beforeEach(() => {
  stateListener = null;
  unsubscribe.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  api.getState.mockResolvedValue(makeState());
  api.setSettings.mockImplementation(async (settings) => makeState({ settings }));
  api.setDevice.mockImplementation(async (patch) =>
    makeState({ device: { tray: false, openAtLogin: false, ...patch } })
  );
  api.sendTest.mockResolvedValue(undefined);
  api.requestPermission.mockResolvedValue('granted');
  api.onStateChanged.mockImplementation((cb) => {
    stateListener = cb;
    return unsubscribe;
  });
  (window as unknown as { electron: unknown }).electron = { modules: bridge };
});

describe('NotificationsSection', () => {
  it('shows loading, then the state', async () => {
    render(<NotificationsSection />);
    expect(screen.getByTestId('notifications-loading')).toBeInTheDocument();
    expect(await screen.findByLabelText('notifications.enabled')).toBeChecked();
  });

  it('shows an error when the state cannot be loaded', async () => {
    api.getState.mockRejectedValue(new Error('boom'));
    render(<NotificationsSection />);
    expect(await screen.findByTestId('notifications-error')).toBeInTheDocument();
  });

  it('toggling the master switch calls setSettings and keeps the returned state', async () => {
    render(<NotificationsSection />);
    await userEvent.click(await screen.findByLabelText('notifications.enabled'));
    expect(api.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
    await waitFor(() => expect(screen.getByLabelText('notifications.enabled')).not.toBeChecked());
  });

  it('device toggles call setDevice', async () => {
    render(<NotificationsSection />);
    await userEvent.click(await screen.findByLabelText('notifications.tray'));
    expect(api.setDevice).toHaveBeenCalledWith({ tray: true });
    await userEvent.click(screen.getByLabelText('notifications.openAtLogin'));
    expect(api.setDevice).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it('send test calls sendTest', async () => {
    render(<NotificationsSection />);
    await userEvent.click(await screen.findByText('notifications.sendTest'));
    expect(api.sendTest).toHaveBeenCalledTimes(1);
  });

  it('requests permission then refreshes the state', async () => {
    api.getState
      .mockResolvedValueOnce(makeState({ capabilities: { permission: 'prompt', whenClosed: 'fires', actions: false } }))
      .mockResolvedValue(makeState());
    render(<NotificationsSection />);
    await userEvent.click(await screen.findByText('notifications.allow'));
    expect(api.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('notifications.allow')).not.toBeInTheDocument());
  });

  it('updates the view on state-changed events and unsubscribes on unmount', async () => {
    const { unmount } = render(<NotificationsSection />);
    await screen.findByLabelText('notifications.enabled');
    act(() => {
      stateListener?.(makeState({ settings: { version: 1, enabled: false, quiet: null, sources: {} } }));
    });
    expect(screen.getByLabelText('notifications.enabled')).not.toBeChecked();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
