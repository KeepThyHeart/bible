/** The Timeline server feature-module manifest (task 0124). Data only; the `timeline` flag is the off switch. */

import type { FeatureModuleManifest } from '../../core.js';

export const timelineManifest: FeatureModuleManifest = {
  id: 'timeline',
  flag: 'timeline',
  platforms: ['web'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    serverRoutes: [{ id: 'timeline-api', path: '/api/timeline' }],
  },
};
