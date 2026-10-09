/**
 * The Measures web binding (entry-chunk code): lazy loaders and a boot probe.
 * The probe asks for activation after first paint, because `module.tsx` registers the
 * reader paint controller and the Study sections; the occurrence data itself is fetched
 * per chapter, and only when the setting wants it.
 */
import type { WebFeatureModule } from '../moduleHost';
import { measuresManifest } from './manifest';

export const measuresModule: WebFeatureModule = {
  manifest: measuresManifest,
  binding: {
    id: 'measures',
    load: () => import('./module'),
    views: { 'preferences:measures': () => import('./MeasuresSettingsView') },
  },
  probe: () => ({ activate: true }),
};
