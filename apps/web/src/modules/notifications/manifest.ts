/**
 * The Notifications feature-module manifest (web): data only, loaded at boot. It owns the
 * Settings "Notifications" tab and the tier-1 web reminders (notifications while a tab is open).
 * The reminder engine itself (`ReminderScheduler`) is core code. The tab id, order and label key
 * are what the host manifest declared; never rename them. The label stays in `ui.json`, because
 * the tab shows before the module's code loads.
 */
import type { FeatureModuleManifest, PreferencesSectionContribution } from '@bible/core/browser';

export const NOTIFICATIONS_MODULE_ID = 'notifications';

export const notificationsSettingsSection: PreferencesSectionContribution = {
  id: 'notifications',
  title: { key: 'settings.tabs.notifications', fallback: 'Notifications' },
  icon: { kind: 'builtin', name: 'fa-bell' },
  order: 60,
};

export const notificationsManifest: FeatureModuleManifest = {
  id: NOTIFICATIONS_MODULE_ID,
  platforms: ['web'],
  contributes: {
    preferencesSections: [notificationsSettingsSection],
    i18nNamespace: 'notifications',
  },
};
