import type { FeatureModuleManifest } from '@bible/core/browser';

/** Main-process manifest of the Word study module (data only; the code loads from `./index`). */
export const wordStudyMainManifest: FeatureModuleManifest = {
  id: 'word-study',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
