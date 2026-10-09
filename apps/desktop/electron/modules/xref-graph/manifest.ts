import type { FeatureModuleManifest } from '@bible/core/browser';

/** Main-process manifest of the Cross-ref graph module (data only; the code loads from `./index`). */
export const xrefGraphMainManifest: FeatureModuleManifest = {
  id: 'xref-graph',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {},
};
