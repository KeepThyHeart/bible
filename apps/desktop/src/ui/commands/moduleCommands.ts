/**
 * Module-management commands: open the Module Manager, import a module file.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';

function dispatchAppEvent(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}

export function registerModuleCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'module.openManager',
      title: { key: 'module.openManager' },
      category: { key: 'module.openManager.category' },
      handler: () => dispatchAppEvent('command:module:openManager'),
    }),
  ];
}
