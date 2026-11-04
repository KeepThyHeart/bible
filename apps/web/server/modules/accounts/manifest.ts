/** The accounts (end-to-end encrypted sync) server feature-module manifest. Data only. */

import type { FeatureModuleManifest } from '../../core.js';

export const accountsManifest: FeatureModuleManifest = {
  id: 'accounts',
  flag: 'accounts',
  platforms: ['web'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    // The sync API (`/api/sync/v1/*`). Disabled, the whole prefix answers "not available".
    serverRoutes: [{ id: 'sync-api', path: '/api/sync' }],
  },
};
