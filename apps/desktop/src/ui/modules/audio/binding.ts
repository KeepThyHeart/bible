/**
 * The Audio desktop binding (entry-chunk code): lazy loaders only. The section view is reached
 * through `views['preferences:audio']` and must never be imported statically elsewhere.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { audioGlyph } from './glyph';
import { audioManifest } from './manifest';

export const audioModule: DesktopFeatureModule = {
  manifest: audioManifest,
  binding: {
    id: 'audio',
    load: () => import('./module'),
    views: {
      'preferences:audio': () => import('./components/AudioSection').then(m => ({ default: m.AudioSection })),
    },
  },
  preferencesGlyphs: { audio: audioGlyph },
};
