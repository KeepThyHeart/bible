import type { FeatureModuleManifest } from '@bible/core/browser';

/**
 * Main-process manifest of the Accounts module (task 0150; data only, the code loads from `./index`).
 * Behind the `accounts` flag: with the flag off nothing is registered and no sync code is loaded.
 */
export const accountsMainManifest: FeatureModuleManifest = {
  id: 'accounts',
  platforms: ['desktop'],
  flag: 'accounts',
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
