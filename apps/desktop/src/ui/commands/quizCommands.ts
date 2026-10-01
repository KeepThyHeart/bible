/**
 * Quiz commands: open the Quiz pane, or start a quiz on the chapter being read.
 */

import { chapterPassage, getBookName } from '@bible/core/browser';
import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useBibleStore, DEFAULT_PANEL_ID } from '../stores/useBibleStore';
import { useQuizLaunchStore } from '../stores/useQuizLaunchStore';
import { genericEnglishTitle } from '../utils/paneNames';
import { getBookNameFromCache } from '../utils/verseReference';

/** Focus the existing Quiz panel, or add one. */
function openQuizPanel(): void {
  const layout = useLayoutStore.getState(); // allow-getstate: command handler - imperative panel creation
  for (const [panelId, panel] of layout.panels) {
    if (panel.contentType === 'quiz') {
      layout.dockviewApi?.getPanel(panelId)?.api.setActive();
      return;
    }
  }
  // Beside the text, not over it: a tab next to the Study pane when there is one,
  // else to the right of the Bible pane, else wherever dockview puts it.
  const api = layout.dockviewApi;
  const study = layout.getPanelsByType('study').find((p) => api?.getPanel(p.panelId));
  const bible = layout.getPanelsByType('bible').find((p) => api?.getPanel(p.panelId));
  const position = study
    ? { direction: 'within', referencePanel: study.panelId }
    : bible
      ? { direction: 'right', referencePanel: bible.panelId }
      : undefined;
  layout.addPanel('quiz', undefined, genericEnglishTitle('quiz'), position);
}

export function registerQuizCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'quiz.open',
      title: { key: 'quiz.open' },
      category: { key: 'quiz.open.category' },
      handler: () => openQuizPanel(),
    }),
    registry.register({
      id: 'quiz.thisChapter',
      title: { key: 'quiz.thisChapter' },
      category: { key: 'quiz.thisChapter.category' },
      handler: () => {
        const { panels } = useBibleStore.getState(); // allow-getstate: command handler reads the reading position once
        const panel = panels.get(DEFAULT_PANEL_ID) ?? panels.values().next().value;
        if (!panel || panel.currentBook <= 0 || panel.currentChapter <= 0) {
          openQuizPanel();
          return;
        }
        const book = panel.currentBook;
        const chapter = panel.currentChapter;
        const cached = getBookNameFromCache(book);
        const name = cached && cached !== 'Unknown' ? cached : getBookName(book);
        useQuizLaunchStore.getState().request({ // allow-getstate: command handler
          passages: [chapterPassage(book, chapter)],
          label: `${name} ${chapter}`,
        });
        openQuizPanel();
      },
    }),
  ];
}
