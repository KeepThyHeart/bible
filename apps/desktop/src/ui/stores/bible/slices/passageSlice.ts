import type { StateCreator } from 'zustand';
import { VerseIdHelper } from '@bible/core';
import { bibleAPI } from '../../../services/electronAPI';
import { useLayoutStore } from '../../useLayoutStore';
import { encodeBibleContentKey } from '../contentKey';
import { BibleState, DEFAULT_DISPLAY_MODE } from '../types';

export interface PassageSlice {
  /**
   * Open a passage as a **new top-level Bible panel**.
   *
   * Since the tab restructure a panel shows exactly one passage, so "open in a
   * new tab" means "add a dockview panel", not "push onto `openTabs`". The new
   * panel is docked into the source panel's group so passages stay together
   * instead of scattering across the workbench.
   *
   * @param book         Book number (1-66).
   * @param chapter      Chapter number.
   * @param verse        Verse to select on arrival; defaults to 1.
   * @param sourcePanelId Panel whose translation, display mode and group the new
   *                      panel should inherit. Defaults to the first Bible panel.
   * @returns The new panel's id, or `null` if the layout could not create it.
   */
  openPassageInNewPanel: (
    book: number,
    chapter: number,
    verse?: number,
    sourcePanelId?: string
  ) => Promise<string | null>;
}

export const createPassageSlice: StateCreator<BibleState, [], [], PassageSlice> = (_set, get) => ({
  openPassageInNewPanel: async (book, chapter, verse, sourcePanelId) => {
    const state = get();

    // Resolve the panel we are inheriting from: the caller's, else the first
    // Bible panel that exists.
    const resolvedSourceId = sourcePanelId && state.panels.has(sourcePanelId)
      ? sourcePanelId
      : state.panels.keys().next().value;
    const ps = resolvedSourceId ? state.panels.get(resolvedSourceId) : undefined;
    const sourceTab = ps?.openTabs[ps.activeTabIndex] ?? ps?.openTabs[0];

    const abbreviation = sourceTab?.abbreviation
      ?? state.availableBibles[0]?.abbreviation
      ?? 'KJV';
    const displayMode = sourceTab?.displayMode ?? DEFAULT_DISPLAY_MODE;
    const selectedVerseId = VerseIdHelper.calculate(book, chapter, verse ?? 1);

    let bookName = '';
    try {
      bookName = await bibleAPI.getBookName(book);
    } catch (error) {
      console.error('[useBibleStore] Error resolving book name for new passage panel:', error);
    }

    const contentKey = encodeBibleContentKey({
      abbreviation, book, chapter, selectedVerseId, displayMode,
    });
    const title = bookName ? `${bookName} ${chapter}` : `${abbreviation} ${chapter}`;

    const layout = useLayoutStore.getState();
    const referencePanel = resolvedSourceId
      ? layout.dockviewApi?.getPanel(resolvedSourceId)
      : undefined;
    const position = referencePanel?.group
      ? { referenceGroup: referencePanel.group, direction: 'within' }
      : undefined;

    return layout.addPanel('bible', contentKey, title, position, abbreviation);
  },
});
