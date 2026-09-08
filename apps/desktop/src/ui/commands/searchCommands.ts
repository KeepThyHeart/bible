/**
 * Search commands: find-in-pane (Ctrl+F), advanced search (Ctrl+Shift+F).
 *
 * The find bar is owned by App.tsx local state; the advanced search dialog is
 * owned by useSearchStore. Both shortcuts flow through the registry rather than
 * App.tsx's global keydown handler, so the keybinding service handles dispatch
 * and the palette can fire them.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { useSearchStore } from '../stores/useSearchStore';

function dispatchAppEvent(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}

export function registerSearchCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'search.openFindBar',
      title: { key: 'search.openFindBar' },
      category: { key: 'search.openFindBar.category' },
      shortcut: { key: 'Ctrl+F', mac: 'Cmd+F' },
      handler: () => dispatchAppEvent('command:search:openFindBar'),
    }),
    registry.register({
      id: 'search.openAdvanced',
      title: { key: 'search.openAdvanced' },
      category: { key: 'search.openAdvanced.category' },
      shortcut: { key: 'Ctrl+Shift+F', mac: 'Cmd+Shift+F' },
      handler: () => {
        const store = useSearchStore.getState() as { openAdvancedDialog?: () => void };
        store.openAdvancedDialog?.();
      },
    }),
  ];
}
