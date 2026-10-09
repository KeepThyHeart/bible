import type { FeatureModuleManifest } from '@bible/core/browser';

/**
 * Main-process manifest of the Timeline module (data only; the code is `module.ts`, loaded lazily).
 * No flag: the Timeline panel is available on desktop regardless of flags.
 */
export const timelineMainManifest: FeatureModuleManifest = {
  id: 'timeline',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
