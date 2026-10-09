/** The Word study server feature-module manifest. Data only. */

import type { FeatureModuleManifest } from '../../core.js';

export const wordStudyManifest: FeatureModuleManifest = {
  id: 'word-study',
  platforms: ['web'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    serverRoutes: [{ id: 'word-study-api', path: '/api/word-study' }],
  },
};
