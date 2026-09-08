/**
 * Bookmark commands.
 *
 * Only the manager is here. Adding and removing a bookmark is bound to the
 * verse in front of the reader, and lives in the Bible pane's bookmark menu,
 * the verse context menu and Ctrl+D - a command-palette entry for it would
 * have to guess which pane and which verse it meant.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';

function dispatchAppEvent(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}

export function registerBookmarkCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'bookmarks.manage',
      title: { key: 'bookmarks.manage' },
      category: { key: 'bookmarks.manage.category' },
      handler: () => dispatchAppEvent('command:bookmarks:manage'),
    }),
  ];
}
