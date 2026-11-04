/**
 * The Accounts module's entry-chunk half (task 0150): lazy loaders only. The Preferences section is reached
 * through `views['preferences:account']` and must never be imported statically elsewhere.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { registerAccountsCommands } from './commands';
import { accountGlyph } from './glyph';
import { ACCOUNTS_MODULE_ID, accountsManifest } from './manifest';

export const accountsModule: DesktopFeatureModule = {
  manifest: accountsManifest,
  binding: {
    id: ACCOUNTS_MODULE_ID,
    load: () => import('./module'),
    views: {
      'preferences:account': () => import('./AccountSection').then((m) => ({ default: m.AccountSection })),
    },
  },
  preferencesGlyphs: { account: accountGlyph },
  commands: registerAccountsCommands,
};
