/**
 * Bible-pane commands. Initial scaffold; menu/shortcut additions are pulled
 * in as the BiblePane component is migrated to dispatch through the registry.
 *
 * Examples this module will eventually own: open verse in commentary,
 * toggle parallel view, switch display mode, copy verse with formatting,
 * navigate prev/next chapter, jump to verse, etc.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';

export function registerBibleCommands(_registry: ICommandRegistry): IDisposable[] {
  void _registry;
  return [];
}
