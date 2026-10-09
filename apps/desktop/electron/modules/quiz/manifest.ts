import type { FeatureModuleManifest } from '@bible/core/browser';

/** Main-process manifest of the Quiz module (data only; the code loads from `./index`). */
export const quizMainManifest: FeatureModuleManifest = {
  id: 'quiz',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
