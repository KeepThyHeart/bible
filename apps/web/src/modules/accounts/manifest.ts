/**
 * The Accounts feature-module manifest (web): data only, loaded at boot.
 * Flag `accounts` (which requires `localUserDb`); the server half is `server/modules/accounts`, mounting
 * `/api/sync`. This round adds no UI: the account screens, header badge and sync host are the next milestone.
 * Ids are persisted or shown before the module's code loads: never rename them.
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const ACCOUNTS_MODULE_ID = 'accounts';

export const accountsManifest: FeatureModuleManifest = {
  id: ACCOUNTS_MODULE_ID,
  flag: 'accounts',
  platforms: ['web'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    // Informational: the server half mounts this.
    serverRoutes: [{ id: 'sync-api', path: '/api/sync' }],
  },
};
