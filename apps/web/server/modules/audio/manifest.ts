/** The Audio Bible server feature-module manifest. Data only. */

import type { FeatureModuleManifest } from '../../core.js';

export const audioManifest: FeatureModuleManifest = {
  id: 'audio',
  flag: 'audio',
  platforms: ['web'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    // Recordings and on-device speech files, served from `audio.dir` (a plain static tree, not under /api).
    serverRoutes: [{ id: 'audio-files', path: '/audio' }],
  },
};
