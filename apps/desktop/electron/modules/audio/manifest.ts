import type { FeatureModuleManifest } from '@bible/core/browser';

/**
 * Main-process manifest of the Audio Bible module (data only; the code loads from `./index`).
 * Off unless the `audio` flag is on. Main serves the `kth-audio://` protocol and describes the Piper assets.
 */
export const audioMainManifest: FeatureModuleManifest = {
  id: 'audio',
  platforms: ['desktop'],
  flag: 'audio',
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
