/** The Presenter's server feature-module manifest (task 0123). Data only. */

import type { FeatureModuleManifest } from '../../core.js';

export const presentManifest: FeatureModuleManifest = {
  id: 'present',
  platforms: ['web'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    serverRoutes: [
      { id: 'present-api', path: '/api/present' },
      { id: 'hymns-api', path: '/api/hymns' },
      { id: 'present-pages', path: '/present' },
      { id: 'watch-page', path: '/watch' },
    ],
  },
};
