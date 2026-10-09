/**
 * The Keyword marks web binding (entry-chunk code): lazy loaders and a boot probe.
 * The probe asks for activation after first paint, because `module.tsx` registers the
 * toolbar button and the reader paint controller.
 */
import type { WebFeatureModule } from '../moduleHost';
import { keywordMarksManifest } from './manifest';

export const keywordMarksModule: WebFeatureModule = {
  manifest: keywordMarksManifest,
  binding: {
    id: 'keyword-marks',
    load: () => import('./module'),
    views: { 'preferences:keyword-marks': () => import('./KeywordSettingsView') },
  },
  probe: () => ({ activate: true }),
};
