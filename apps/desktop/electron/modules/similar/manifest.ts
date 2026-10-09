import type { FeatureModuleManifest } from '@bible/core/browser';

/**
 * Main-process manifest of the Similar module (data only; the code is `index.ts`, loaded
 * lazily). No flag: similar passages are offered whenever the data is installed.
 */
export const similarMainManifest: FeatureModuleManifest = {
  id: 'similar',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
