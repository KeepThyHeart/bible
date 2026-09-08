/**
 * Notes commands. Initial population covers the "Export My Notes" menu item.
 * Verse-note-creation, note-editing, and note-deletion commands are TBD -
 * they live in the UserNotesPane component today and will be moved here as
 * those components are migrated to the registry.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';

function dispatchAppEvent(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}

export function registerNotesCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'notes.export',
      title: { key: 'notes.export' },
      category: { key: 'notes.export.category' },
      handler: () => dispatchAppEvent('command:notes:export'),
    }),
  ];
}
