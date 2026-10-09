import type { FeatureModuleManifest } from '@bible/core/browser';

/** Main-process manifest of the Reading plans module (data only; the code loads from `./index`). */
export const readingPlansMainManifest: FeatureModuleManifest = {
  id: 'reading-plans',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
