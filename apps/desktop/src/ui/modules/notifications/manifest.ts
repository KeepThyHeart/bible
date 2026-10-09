/**
 * The Notifications feature module's manifest (desktop; data only, task 0128). The Preferences
 * section is what `host/ui.ts` declared (id `notifications`, order 30, label key in `ui.json`, which
 * shows before the module's code loads). `onStartupFinished` activates the module once the renderer
 * is idle, so a notification click is routed (see `module.ts`).
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const notificationsManifest: FeatureModuleManifest = {
  id: 'notifications',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    preferencesSections: [
      {
        id: 'notifications',
        title: { key: 'preferencesDialog.sectionNotifications', fallback: 'Notifications' },
        icon: { kind: 'builtin', name: 'notifications' },
        order: 30,
      },
    ],
    i18nNamespace: 'notifications',
  },
};
