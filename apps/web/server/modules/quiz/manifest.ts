/** The Quiz server feature-module manifest. Data only. */

import type { FeatureModuleManifest } from '../../core.js';

export const quizManifest: FeatureModuleManifest = {
  id: 'quiz',
  flag: 'quiz',
  platforms: ['web'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    serverRoutes: [{ id: 'quiz-api', path: '/api/quiz' }],
  },
};
