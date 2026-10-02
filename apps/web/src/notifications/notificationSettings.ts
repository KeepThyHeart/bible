/**
 * Notification preferences on the web. They are a UI preference (which reminders the user
 * wants, and when), so they live in localStorage; the web app keeps no personal content in
 * the browser. Every storage access is wrapped: a blocked or full store falls back to defaults.
 */
import { normalizeNotificationSettings } from '@bible/core/browser';
import type { NotificationSettings } from '@bible/core/browser';

export const NOTIFICATION_SETTINGS_KEY = 'bible-notifications';
export const NOTIFICATION_STATE_KEY = 'bible-notifications-state';

export function loadNotificationSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): NotificationSettings {
  let raw: unknown = null;
  try {
    const text = storage?.getItem(NOTIFICATION_SETTINGS_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null; // corrupt JSON or blocked storage
  }
  return normalizeNotificationSettings(raw);
}

/** Returns false when the value could not be stored (the caller keeps it in memory). */
export function saveNotificationSettings(
  settings: NotificationSettings,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
