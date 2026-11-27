/**
 * The Audio web binding: entry-chunk code, so only lazy loaders. The module code
 * (player wiring, the reader UI registered into host slots) loads on Study's reader
 * boot. There is no Settings tab: every audio setting is in the player's gear. Never
 * import the module statically from anywhere else.
 */
import type { WebFeatureModule } from '../moduleHost';
import { audioManifest } from './manifest';

export const audioModule: WebFeatureModule = {
  manifest: audioManifest,
  binding: {
    id: 'audio',
    load: () => import('./module'),
  },
};
