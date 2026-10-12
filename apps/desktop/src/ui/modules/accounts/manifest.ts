/**
 * The Accounts feature module's manifest (desktop; data only, task 0150). One Preferences section ("Account &
 * sync"), between Privacy-adjacent sections (order 27). The module is behind the `accounts` flag; its main-process
 * half (`electron/modules/accounts`) hosts the sync service. `onStartupFinished` activates the module once the
 * renderer is idle, so the sync status is subscribed to early.
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const ACCOUNTS_MODULE_ID = 'accounts';

export const accountsManifest: FeatureModuleManifest = {
  id: ACCOUNTS_MODULE_ID,
  platforms: ['desktop'],
  flag: 'accounts',
  activationEvents: ['onStartupFinished'],
  contributes: {
    preferencesSections: [
      {
        id: 'account',
        title: { key: 'preferencesDialog.sectionAccount', fallback: 'Account & sync' },
        icon: { kind: 'builtin', name: 'account' },
        order: 27,
      },
    ],
    i18nNamespace: 'accounts',
  },
};
