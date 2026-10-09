/**
 * The Audio web binding: entry-chunk code, so only lazy loaders. The module code
 * (player wiring, the reader UI registered into host slots) loads on Study's reader
 * boot; the Settings tab loads when Settings > Audio opens. Never import either
 * statically from anywhere else.
 */
import type { WebFeatureModule } from '../moduleHost';
import { loadNamespace } from '../../i18n';
import { audioManifest } from './manifest';

export const audioModule: WebFeatureModule = {
  manifest: audioManifest,
  binding: {
    id: 'audio',
    load: () => import('./module'),
    views: {
      // Views are not behind `binding.load`, so wait for the strings here.
      'preferences:audio': async () => (await Promise.all([import('./components/AudioSettingsView'), loadNamespace('audio')]))[0],
    },
  },
};
