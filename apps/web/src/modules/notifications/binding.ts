/**
 * The Notifications web binding: entry-chunk code, so it holds only lazy loaders and a boot probe.
 * The probe asks for activation after first paint (`module.ts` starts the web reminders), and only
 * where the browser has the Notifications API, as the shell did before. The Settings tab view loads
 * when the tab is opened; it must never be imported statically anywhere else.
 */
import type { WebFeatureModule } from '../moduleHost';
import { loadNamespace } from '../../i18n';
import { notificationsManifest } from './manifest';

export const notificationsModule: WebFeatureModule = {
  manifest: notificationsManifest,
  binding: {
    id: 'notifications',
    load: () => import('./module'),
    views: {
      // The tab can open before the module's catalog has loaded (it loads when idle), so wait for it here.
      'preferences:notifications': async () => {
        await loadNamespace('notifications');
        return import('./NotificationsSettingsView');
      },
    },
  },
  probe: () => (typeof window !== 'undefined' && 'Notification' in window ? { activate: true } : null),
};
