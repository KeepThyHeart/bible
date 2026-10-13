/**
 * The Accounts feature-module manifest (web): data only, loaded at boot.
 * Flag `accounts` (which requires `localUserDb`); the server half is `server/modules/accounts`, mounting
 * `/api/sync`. The module adds the header sync badge, the account dialog and Settings > Account.
 * Ids are persisted or shown before the module's code loads: never rename them. The Settings tab label stays in
 * `ui.json` (`settings.tabs.account`), because the tab shows before the module's code loads.
 */
import type { FeatureModuleManifest, PreferencesSectionContribution } from '@bible/core/browser';

export const ACCOUNTS_MODULE_ID = 'accounts';

export const accountsSettingsSection: PreferencesSectionContribution = {
  id: 'account',
  title: { key: 'settings.tabs.account', fallback: 'Account' },
  icon: { kind: 'builtin', name: 'fa-user' },
  order: 70,
};

export const accountsManifest: FeatureModuleManifest = {
  id: ACCOUNTS_MODULE_ID,
  flag: 'accounts',
  platforms: ['web'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    // Informational: the server half mounts this.
    serverRoutes: [{ id: 'sync-api', path: '/api/sync' }],
    preferencesSections: [accountsSettingsSection],
    i18nNamespace: 'accounts',
  },
};
