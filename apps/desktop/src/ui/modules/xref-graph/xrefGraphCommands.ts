/**
 * Cross-reference graph command (entry-chunk code, so it imports nothing of the module's UI).
 * Opens the graph dialog on the verse the reader has selected in the Bible pane (published to the
 * when-context as `selectedVerseId`); it is hidden from the palette until a verse is selected.
 * It runs the module's verse action, which activates the module and opens the dialog.
 */

import type { ICommandRegistry } from '../../services/ICommandRegistry';
import type { IDisposable } from '../../types/Command';
import { whenContextService } from '../../services/WhenContextService';
import { verseActions } from '../../apps/appHost';

export function registerXrefGraphCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'xrefGraph.open',
      title: { key: 'xrefGraph.open' },
      category: { key: 'xrefGraph.open.category' },
      when: 'verseSelected',
      handler: async () => {
        const verseId = whenContextService.get('selectedVerseId');
        if (typeof verseId !== 'number') return;
        await verseActions.run('xrefGraph.connections', { verseId, verseIds: [verseId], module: '', surface: 'command' });
      },
    }),
  ];
}
