/**
 * The Downloads web binding: entry-chunk code, so only a lazy loader. The Offline settings tab
 * view loads when the tab is opened. Never import it statically from anywhere else.
 */
import type { WebFeatureModule } from '../moduleHost';
import { downloadsManifest } from './manifest';

export const downloadsModule: WebFeatureModule = {
  manifest: downloadsManifest,
  binding: {
    id: 'downloads',
    views: { 'preferences:offline': () => import('./OfflineSettingsView') },
  },
};
