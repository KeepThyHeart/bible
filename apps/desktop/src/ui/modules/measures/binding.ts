/**
 * Weights, measures and money binding (entry-chunk code): lazy loaders only. The preferences section
 * is imported by nobody else.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { measuresGlyph } from './glyph';
import { measuresManifest, MEASURES_MODULE_ID, MEASURES_SESSION_KEY } from './manifest';

export const measuresModule: DesktopFeatureModule = {
  manifest: measuresManifest,
  binding: {
    id: MEASURES_MODULE_ID,
    load: () => import('./module'),
    views: { 'preferences:measures': () => import('./MeasuresSection') },
  },
  preferencesGlyphs: { measures: measuresGlyph },
  sessionKeys: [MEASURES_SESSION_KEY],
};
