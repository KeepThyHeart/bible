import type { FeatureModuleManifest } from '@bible/core/browser';

/** Main-process manifest of the Keyword marks module (data only; the code loads from `./index`). */
export const keywordMarksMainManifest: FeatureModuleManifest = {
  id: 'keyword-marks',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
