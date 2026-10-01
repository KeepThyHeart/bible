/**
 * IPC for notifications (task 0083). The renderer's Preferences page reads the
 * view state, saves settings, changes device options (tray, start at login),
 * sends a test and asks for permission; the host (ElectronReminderHost) does
 * the work. Replies use the `Result<T>` envelope.
 *
 * Events to the renderer (sent by the host): `notifications:state-changed`,
 * `notifications:open-target`.
 */
import type { NotificationDeviceSettings, NotificationsViewState, ReminderPermission } from '@bible/core/browser';
import type { ElectronReminderHost } from '../notifications/ElectronReminderHost';
import { ipcHandler, IpcKnownError } from './handler-helper';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function registerNotificationHandlers(getHost: () => ElectronReminderHost | null): void {
  const host = (): ElectronReminderHost => {
    const h = getHost();
    if (!h) throw new IpcKnownError('unavailable', 'Notifications are not ready yet.');
    return h;
  };

  ipcHandler<[], NotificationsViewState>('notifications:get-state', () => host().getViewState());

  ipcHandler<[unknown], NotificationsViewState>('notifications:set-settings', async (settings) => {
    if (!isPlainObject(settings)) throw new IpcKnownError('invalid_input', 'Notification settings must be an object.');
    return host().setSettings(settings);
  });

  ipcHandler<[unknown], NotificationsViewState>('notifications:set-device', (patch) => {
    if (!isPlainObject(patch)) throw new IpcKnownError('invalid_input', 'A device settings patch must be an object.');
    const clean: Partial<NotificationDeviceSettings> = {};
    for (const key of ['tray', 'openAtLogin'] as const) {
      if (patch[key] === undefined) continue;
      if (typeof patch[key] !== 'boolean') throw new IpcKnownError('invalid_input', `${key} must be true or false.`);
      clean[key] = patch[key] as boolean;
    }
    return host().setDevice(clean);
  });

  ipcHandler<[], void>('notifications:send-test', async () => {
    await host().sendTest();
  });

  ipcHandler<[], ReminderPermission>('notifications:request-permission', () => host().requestPermission());
}
