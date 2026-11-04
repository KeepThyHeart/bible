/** Accounts commands: open the Account & sync section of Preferences. */
import type { ICommandRegistry } from '../../services/ICommandRegistry';
import type { IDisposable } from '../../types/Command';

export const OPEN_PREFERENCES_SECTION_EVENT = 'open-preferences-section';

export function registerAccountsCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'accounts.openSettings',
      title: { key: 'accounts.openSettings' },
      category: { key: 'accounts.openSettings.category' },
      handler: () => {
        window.dispatchEvent(new CustomEvent(OPEN_PREFERENCES_SECTION_EVENT, { detail: 'account' }));
      },
    }),
  ];
}
