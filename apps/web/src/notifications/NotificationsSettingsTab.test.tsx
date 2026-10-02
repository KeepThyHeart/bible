import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.startsWith('notifications.labels.') ? key.slice('notifications.labels.'.length) : key }),
}));
vi.mock('../stores/bibleStore', () => ({ bibleStore: { navigateTo: vi.fn(), getVerseOfTheDay: vi.fn(async () => null) } }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k, language: 'en' } }));

import { NotificationsSettingsTab } from './NotificationsSettingsTab';
import { createWebReminderHost } from './webReminders';
import { loadNotificationSettings } from './notificationSettings';

class FakeNotification {
  static permission = 'default';
  static requestPermission = vi.fn(async () => { FakeNotification.permission = 'granted'; return 'granted'; });
  constructor(public title: string) {}
}

beforeEach(() => {
  localStorage.clear();
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockClear();
  (window as unknown as Record<string, unknown>).Notification = FakeNotification;
  (globalThis as unknown as Record<string, unknown>).Notification = FakeNotification;
});

describe('NotificationsSettingsTab', () => {
  it('requests permission from the button', async () => {
    const host = createWebReminderHost();
    render(<NotificationsSettingsTab host={host} />);
    fireEvent.click(await screen.findByText('allow'));
    await waitFor(() => expect(FakeNotification.requestPermission).toHaveBeenCalled());
    await waitFor(() => expect(host.store.getSnapshot().capabilities.permission).toBe('granted'));
    host.stop();
  });

  it('toggling verse of the day persists', async () => {
    FakeNotification.permission = 'granted';
    const host = createWebReminderHost();
    const { container } = render(<NotificationsSettingsTab host={host} />);
    const toggle = await waitFor(() => {
      const el = container.querySelector('[data-source-id="app:verse-of-the-day"] input[type=checkbox]');
      if (!el) throw new Error('no toggle yet');
      return el as HTMLInputElement;
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(loadNotificationSettings().sources['app:verse-of-the-day']?.enabled).toBe(true));
    host.stop();
  });

  it('explains when notifications are unsupported', async () => {
    delete (window as unknown as Record<string, unknown>).Notification;
    delete (globalThis as unknown as Record<string, unknown>).Notification;
    const host = createWebReminderHost();
    render(<NotificationsSettingsTab host={host} />);
    expect(await screen.findByText('statusUnsupported')).toBeTruthy();
  });
});
