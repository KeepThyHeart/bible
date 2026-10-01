import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationsViewState, ReminderSourceInfo } from '@bible/core/browser';
import { NotificationPreferences } from './NotificationPreferences';

const votd: ReminderSourceInfo = {
  id: 'app:votd', kind: 'rules', label: 'Verse of the day', description: 'A verse each morning.', enabled: true,
  defaultEnabled: false, registered: true, allowed: true, userEditable: true, nextAt: 1_700_000_000_000, pending: 0,
  plan: { slots: [{ id: 'daily', kind: 'fixed', time: '08:00', days: [1, 2, 3] }] },
};
const ext: ReminderSourceInfo = {
  id: 'ext:memory', kind: 'items', label: 'Memory cards', enabled: true, defaultEnabled: true, registered: true, allowed: true,
  userEditable: false, nextAt: null, pending: 3, plan: null,
};

function makeState(over: Partial<NotificationsViewState> = {}): NotificationsViewState {
  return {
    settings: { version: 1, enabled: true, quiet: null, sources: {} },
    sources: [votd, ext],
    capabilities: { permission: 'granted', whenClosed: 'never', actions: false },
    timeZone: 'UTC',
    ...over,
  } as NotificationsViewState;
}

function setup(state: NotificationsViewState, extra: Record<string, unknown> = {}) {
  const onSettingsChange = vi.fn();
  const onDeviceChange = vi.fn();
  render(
    <NotificationPreferences state={state} onSettingsChange={onSettingsChange} onDeviceChange={onDeviceChange} formatTime={() => 'T'} {...extra} />,
  );
  return { onSettingsChange, onDeviceChange, user: userEvent.setup() };
}

describe('NotificationPreferences', () => {
  it('renders each permission state', () => {
    const onRequestPermission = vi.fn();
    const { unmount } = render(
      <NotificationPreferences
        state={makeState({ capabilities: { permission: 'prompt', whenClosed: 'fires', actions: false } })}
        onSettingsChange={() => undefined}
        onRequestPermission={onRequestPermission}
      />,
    );
    expect(screen.getByRole('button', { name: 'Allow notifications' })).toBeInTheDocument();
    expect(screen.getByText('Reminders keep arriving while the app runs in the tray.')).toBeInTheDocument();
    unmount();
    const denied = render(
      <NotificationPreferences state={makeState({ capabilities: { permission: 'denied', whenClosed: 'background-only', actions: false } })} onSettingsChange={() => undefined} />,
    );
    expect(screen.getByText(/Notifications are blocked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow notifications' })).toBeNull();
    expect(screen.getByText('Reminders arrive while the app is open, even in the background.')).toBeInTheDocument();
    denied.unmount();
    render(
      <NotificationPreferences state={makeState({ capabilities: { permission: 'unsupported', whenClosed: 'never', actions: false } })} onSettingsChange={() => undefined} />,
    );
    expect(screen.getByText('This browser or device cannot show notifications.')).toBeInTheDocument();
    expect(screen.queryByText('Reminders arrive only while the app is open.')).toBeNull();
  });

  it('calls onRequestPermission', async () => {
    const onRequestPermission = vi.fn();
    const user = userEvent.setup();
    render(
      <NotificationPreferences
        state={makeState({ capabilities: { permission: 'prompt', whenClosed: 'never', actions: false } })}
        onSettingsChange={() => undefined}
        onRequestPermission={onRequestPermission}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Allow notifications' }));
    expect(onRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('master switch writes settings and disables the rest when off', async () => {
    const { onSettingsChange, user } = setup(makeState());
    await user.click(screen.getByRole('switch', { name: 'Show notifications' }));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('disables children when the master is off', () => {
    setup(makeState({ settings: { version: 1, enabled: false, quiet: null, sources: {} } }));
    expect(screen.getByRole('switch', { name: 'Show notifications' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Verse of the day' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Memory cards' })).toBeDisabled();
    expect(screen.getByLabelText('Time for Verse of the day')).toBeDisabled();
  });

  it('toggles a source', async () => {
    const { onSettingsChange, user } = setup(makeState());
    await user.click(screen.getByRole('switch', { name: 'Memory cards' }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      version: 1, enabled: true, quiet: null, sources: { 'ext:memory': { enabled: false } },
    });
  });

  it('shows description, next time and scheduled count', () => {
    setup(makeState());
    expect(screen.getByText('A verse each morning.')).toBeInTheDocument();
    expect(screen.getByText('Next: T')).toBeInTheDocument();
    expect(screen.getByText('3 scheduled')).toBeInTheDocument();
    expect(screen.getByLabelText('Time for Verse of the day')).toHaveValue('08:00');
  });

  it('editing the daily time writes the plan and keeps the days of a single fixed slot', () => {
    const { onSettingsChange } = setup(makeState());
    const input = screen.getByLabelText('Time for Verse of the day');
    fireEvent.input(input, { target: { value: '09:15' } });
    const last = onSettingsChange.mock.calls.at(-1)?.[0];
    expect(last.sources['app:votd'].plan).toEqual({
      slots: [{ id: 'daily', kind: 'fixed', time: '09:15', days: [1, 2, 3] }],
    });
  });

  it('uses all days when there is no single fixed slot', () => {
    const source = { ...votd, plan: null };
    const { onSettingsChange } = setup(makeState({ sources: [source] }));
    fireEvent.input(screen.getByLabelText('Time for Verse of the day'), { target: { value: '10:00' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].sources['app:votd'].plan.slots[0].days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('does not offer a time for item sources or disabled rule sources', () => {
    setup(makeState({ sources: [{ ...votd, enabled: false, nextAt: null }, ext] }));
    expect(screen.queryByLabelText(/^Time for /)).toBeNull();
  });

  it('quiet hours: on uses defaults, off clears, edit writes', async () => {
    const first = setup(makeState());
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(screen.queryByLabelText('To')).toBeNull();
    await first.user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(first.onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ quiet: { start: '21:30', end: '07:00' } }));
    expect(screen.getByText('Notifications due in quiet hours wait until they end.')).toBeInTheDocument();
  });

  it('quiet hours: off and edit when on', async () => {
    const { onSettingsChange, user } = setup(
      makeState({ settings: { version: 1, enabled: true, quiet: { start: '21:30', end: '07:00' }, sources: {} } }),
    );
    expect(screen.getByLabelText('From')).toHaveValue('21:30');
    expect(screen.getByLabelText('To')).toHaveValue('07:00');
    const to = screen.getByLabelText('To');
    fireEvent.input(to, { target: { value: '06:30' } });
    expect(onSettingsChange.mock.calls.at(-1)?.[0].quiet).toEqual({ start: '21:30', end: '06:30' });
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(onSettingsChange.mock.calls.at(-1)?.[0].quiet).toBeNull();
  });

  it('unsupported disables every control', () => {
    setup(
      makeState({
        capabilities: { permission: 'unsupported', whenClosed: 'fires', actions: false },
        device: { tray: true, openAtLogin: false },
        deviceSupport: { tray: true, openAtLogin: true },
      }),
      { onSendTest: vi.fn() },
    );
    expect(screen.queryByText('Reminders keep arriving while the app runs in the tray.')).toBeNull();
    for (const name of ['Show notifications', 'Quiet hours', 'Verse of the day', 'Memory cards', 'Keep running in the tray', 'Start when I log in (in the tray)']) {
      expect(screen.getByRole('switch', { name })).toBeDisabled();
    }
    expect(screen.getByLabelText('Time for Verse of the day')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send a test notification' })).toBeDisabled();
  });

  it('replaces {source} in the dailyTime label', () => {
    setup(makeState(), { labels: { dailyTime: '{source} um' } });
    expect(screen.getByLabelText('Verse of the day um')).toBeInTheDocument();
  });

  it('uses formatScheduled when given', () => {
    setup(makeState(), { formatScheduled: (n: number) => `${n} cards pending` });
    expect(screen.getByText('3 cards pending')).toBeInTheDocument();
    expect(screen.queryByText('3 scheduled')).toBeNull();
  });

  it('login switch is disabled while the tray is off unless already on', () => {
    const first = render(
      <NotificationPreferences state={makeState({ device: { tray: false, openAtLogin: false }, deviceSupport: { tray: true, openAtLogin: true } })} onSettingsChange={() => undefined} />,
    );
    expect(screen.getByRole('switch', { name: 'Start when I log in (in the tray)' })).toBeDisabled();
    first.unmount();
    const second = render(
      <NotificationPreferences state={makeState({ device: { tray: false, openAtLogin: true }, deviceSupport: { tray: true, openAtLogin: true } })} onSettingsChange={() => undefined} />,
    );
    expect(screen.getByRole('switch', { name: 'Start when I log in (in the tray)' })).toBeEnabled();
    second.unmount();
    render(
      <NotificationPreferences state={makeState({ device: { tray: true, openAtLogin: false }, deviceSupport: { tray: true, openAtLogin: true } })} onSettingsChange={() => undefined} />,
    );
    expect(screen.getByRole('switch', { name: 'Start when I log in (in the tray)' })).toBeEnabled();
  });

  it('hides the device section without state.device', () => {
    setup(makeState());
    expect(screen.queryByText('When the window is closed')).toBeNull();
  });

  it('device section calls onDeviceChange and respects support', async () => {
    const { onDeviceChange, user } = setup(
      makeState({ device: { tray: false, openAtLogin: false }, deviceSupport: { tray: true, openAtLogin: false } }),
    );
    expect(screen.getByRole('group', { name: 'When the window is closed' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Start when I log in (in the tray)' })).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'Keep running in the tray' }));
    expect(onDeviceChange).toHaveBeenCalledWith({ tray: true });
  });

  it('send test button', async () => {
    const onSendTest = vi.fn();
    const { user } = setup(makeState(), { onSendTest });
    await user.click(screen.getByRole('button', { name: 'Send a test notification' }));
    expect(onSendTest).toHaveBeenCalledTimes(1);
  });

  it('no test button without onSendTest', () => {
    setup(makeState());
    expect(screen.queryByRole('button', { name: 'Send a test notification' })).toBeNull();
  });

  it('empty state', () => {
    setup(makeState({ sources: [] }));
    expect(screen.getByText('No features use notifications yet.')).toBeInTheDocument();
  });

  it('labels override', () => {
    setup(makeState({ sources: [] }), { labels: { enabled: 'Benachrichtigungen', noSources: 'Nichts' } });
    expect(screen.getByRole('switch', { name: 'Benachrichtigungen' })).toBeInTheDocument();
    expect(screen.getByText('Nichts')).toBeInTheDocument();
  });

  it('disables a blocked source and shows the hint', () => {
    setup(makeState({ sources: [votd, { ...ext, allowed: false }] }));
    expect(screen.getByRole('switch', { name: 'Memory cards' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Verse of the day' })).toBeEnabled();
    expect(screen.getAllByText('Turned off because the extension is disabled or lacks permission.')).toHaveLength(1);
  });

  it('master switch is unchecked when unsupported', () => {
    setup(makeState({ capabilities: { permission: 'unsupported', whenClosed: 'never', actions: false } }));
    expect(screen.getByRole('switch', { name: 'Show notifications' })).not.toBeChecked();
  });

  it('keeps spacing under the status line when unsupported', () => {
    setup(makeState({ capabilities: { permission: 'unsupported', whenClosed: 'never', actions: false } }));
    expect(screen.getByRole('status')).toHaveClass('kth-notify-prefs__hint');
  });

  it('does not mangle replacement patterns in labels', () => {
    const tricky = { ...votd, label: "A $& B $' $1", pending: 0 };
    setup(makeState({ sources: [tricky, { ...ext, label: '$&' }] }), {
      formatTime: () => '$&-t',
      labels: { scheduled: '{count} x', next: 'Next: {time}' },
    });
    expect(screen.getByLabelText("Time for A $& B $' $1")).toBeInTheDocument();
    expect(screen.getByText('Next: $&-t')).toBeInTheDocument();
  });
});
