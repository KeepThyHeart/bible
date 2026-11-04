import type { FeatureModuleManifest } from '@bible/core/browser';

/**
 * Main-process manifest of the Speech module (data only; the code loads from `./index`).
 * Off unless the `recite` flag is on. The engine itself runs in the renderer; main only bridges.
 */
export const speechMainManifest: FeatureModuleManifest = {
  id: 'speech',
  platforms: ['desktop'],
  flag: 'recite',
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
