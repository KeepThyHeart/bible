/**
 * What a Notifications settings page shows: one serializable snapshot an app
 * builds from its engine and platform (desktop sends it over IPC).
 */
import type { ReminderSourceInfo } from './ReminderScheduler';
import type { NotificationSettings } from './settings';
import type { ReminderCapabilities } from './types';

/** Per-device switches (desktop): never stored in user data, never backed up. */
export interface NotificationDeviceSettings {
  /** Keep running in the tray when the window is closed, so reminders still fire. */
  tray: boolean;
  /** Start (hidden, in the tray) when the user logs in. */
  openAtLogin: boolean;
}

export const DEFAULT_NOTIFICATION_DEVICE_SETTINGS: NotificationDeviceSettings = Object.freeze({
  tray: false,
  openAtLogin: false,
}) as NotificationDeviceSettings;

export interface NotificationsViewState {
  settings: NotificationSettings;
  sources: ReminderSourceInfo[];
  capabilities: ReminderCapabilities;
  /** IANA zone the engine schedules in. */
  timeZone: string;
  /** Desktop only. */
  device?: NotificationDeviceSettings;
  /** Desktop only: which device switches this platform supports. */
  deviceSupport?: { tray: boolean; openAtLogin: boolean };
}
