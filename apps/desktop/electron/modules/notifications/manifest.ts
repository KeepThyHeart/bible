import type { FeatureModuleManifest } from '@bible/core/browser';

/**
 * Main-process manifest of the Notifications module (data only; the code loads from `./index`).
 * It owns the Preferences page's IPC. The reminder engine (`ElectronReminderHost`, tray, scheduler,
 * extension reminders) is host code and starts whether or not this module is on.
 */
export const notificationsMainManifest: FeatureModuleManifest = {
  id: 'notifications',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
