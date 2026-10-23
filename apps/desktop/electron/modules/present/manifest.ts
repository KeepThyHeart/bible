import type { FeatureModuleManifest } from '@bible/core/browser';

/** Main-process manifest of the Presenter module (data only; the code loads from `./index`). */
export const presentMainManifest: FeatureModuleManifest = {
  id: 'present',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
