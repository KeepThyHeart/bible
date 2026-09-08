/**
 * Session commands: save/load/rename/duplicate study sessions. Scaffold for
 * now; populated as session UI is migrated to the registry.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';

export function registerSessionCommands(_registry: ICommandRegistry): IDisposable[] {
  void _registry;
  return [];
}
