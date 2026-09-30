/**
 * Similar passages command (task 0070): reveal the panel and show passages similar to the
 * verse the reader has selected (published to the when-context as `selectedVerseId`).
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { whenContextService } from '../services/WhenContextService';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useSimilarStore } from '../stores/useSimilarStore';

export function registerSimilarCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'similar.open',
      title: { key: 'similar.open' },
      category: { key: 'similar.open.category' },
      shortcut: { key: 'Ctrl+Shift+M', mac: 'Cmd+Shift+M' },
      handler: () => {
        const verseId = whenContextService.get('selectedVerseId');
        if (typeof verseId === 'number') {
          useSimilarStore.getState().openFor({ startVerseId: verseId, endVerseId: verseId });
        } else {
          useLayoutStore.getState().openSimilarPanel(); // allow-getstate: command handler - imperative panel creation
        }
      },
    }),
  ];
}
