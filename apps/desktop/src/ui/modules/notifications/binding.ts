/**
 * The Notifications module's entry-chunk half (task 0128): lazy loaders only. The Preferences
 * section is reached through `views['preferences:notifications']` and must never be imported
 * statically elsewhere.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { notificationsManifest } from './manifest';

export const notificationsModule: DesktopFeatureModule = {
  manifest: notificationsManifest,
  binding: {
    id: 'notifications',
    load: () => import('./module'),
    views: {
      'preferences:notifications': () => import('./NotificationsSection').then((m) => ({ default: m.NotificationsSection })),
    },
  },
};
