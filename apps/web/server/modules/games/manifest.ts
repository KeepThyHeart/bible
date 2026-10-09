/** The Games server feature-module manifest (task 0115). Data only. */

import type { FeatureModuleManifest } from '../../core.js';

export const gamesManifest: FeatureModuleManifest = {
  id: 'games',
  platforms: ['web'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    serverRoutes: [
      { id: 'games-api', path: '/api/games' },
      { id: 'games-pages', path: '/games' },
    ],
  },
};
