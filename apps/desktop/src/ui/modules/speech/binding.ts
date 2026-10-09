/**
 * The Speech desktop binding (entry-chunk code): lazy loaders only. The section view is reached
 * through `views['preferences:speech']` and must never be imported statically elsewhere.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { speechManifest } from './manifest';

export const speechModule: DesktopFeatureModule = {
  manifest: speechManifest,
  binding: {
    id: 'speech',
    load: () => import('./module'),
    views: {
      'preferences:speech': () => import('./SpeechSection').then((m) => ({ default: m.SpeechSection })),
    },
  },
};
