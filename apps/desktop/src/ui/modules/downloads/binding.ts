/**
 * The Downloads desktop binding (entry-chunk code): lazy loaders only. The section view is
 * reached through `views['preferences:downloads']` and must never be imported statically elsewhere.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { downloadsManifest } from './manifest';

export const downloadsModule: DesktopFeatureModule = {
  manifest: downloadsManifest,
  binding: {
    id: 'downloads',
    load: () => import('./module'),
    views: {
      'preferences:downloads': () => import('./DownloadsSection').then((m) => ({ default: m.DownloadsSection })),
    },
  },
};
