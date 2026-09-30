/**
 * Cross-reference graph command. Opens the graph dialog on the verse the
 * reader has selected in the Bible pane (published to the when-context as
 * `selectedVerseId`); it is hidden from the palette until a verse is selected.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { whenContextService } from '../services/WhenContextService';
import { useXrefGraphStore } from '../stores/useXrefGraphStore';

export function registerXrefGraphCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'xrefGraph.open',
      title: { key: 'xrefGraph.open' },
      category: { key: 'xrefGraph.open.category' },
      when: 'verseSelected',
      handler: () => {
        const verseId = whenContextService.get('selectedVerseId');
        if (typeof verseId === 'number') useXrefGraphStore.getState().openGraph(verseId);
      },
    }),
  ];
}
