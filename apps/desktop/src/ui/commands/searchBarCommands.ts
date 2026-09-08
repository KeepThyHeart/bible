/**
 * Search bar focus and command-mode commands.
 *
 * These dispatch CustomEvents that TopSearchBar listens for, similar to how
 * other commands work (e.g., search:openFindBar dispatches to App.tsx).
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';

export function registerSearchBarCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'app.focusSearchBar',
      title: { key: 'app.focusSearchBar' },
      // Ctrl+L first, because it is this app's own shortcut and the one the
      // search box advertises on itself. Ctrl+K stays bound as well - it is
      // the browser-address-bar habit the web app had to honour - but it is
      // the alias here, not the headline; `formatShortcutForDisplay` shows the
      // first entry.
      shortcut: [
        { key: 'Ctrl+L', mac: 'Cmd+L' },
        { key: 'Ctrl+K', mac: 'Cmd+K' },
      ],
      handler: () => {
        window.dispatchEvent(new CustomEvent('command:app:focusSearchBar'));
      },
    }),
    registry.register({
      id: 'app.openCommandMode',
      title: { key: 'app.openCommandMode' },
      shortcut: [
        { key: 'Ctrl+Shift+P', mac: 'Cmd+Shift+P' },
        { key: 'F1' },
      ],
      handler: () => {
        window.dispatchEvent(new CustomEvent('command:app:openCommandMode'));
      },
    }),
  ];
}
