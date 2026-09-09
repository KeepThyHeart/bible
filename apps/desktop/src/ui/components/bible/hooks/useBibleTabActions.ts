import { useCallback } from 'react';
import { BibleTabInfo } from '../../BiblePaneContext';

/**
 * Panel-level pane actions for the Bible pane.
 *
 * A passage *is* a dockview panel, not an internal sub-tab of this pane, so
 * splitting and moving a passage is dockview's job and is handled by
 * `DockviewTabRenderer`'s tab context menu. What is left here is detaching
 * the panel into its own window, which dockview cannot do for us.
 */
export function useBibleTabActions(args: {
  panelId: string;
  activeTab: BibleTabInfo | undefined;
  currentBook: number;
  currentChapter: number;
  currentBookName: string;
  selectedVerseId: number | null;
  versesByTab: Map<string, any[]>;
}) {
  const {
    activeTab,
    currentBook, currentChapter, currentBookName, selectedVerseId,
    versesByTab,
  } = args;

  const handleDetachPane = useCallback(async () => {
    try {
      // The detached window still speaks the panel-state shape, so the single
      // passage is handed over as a one-entry `openTabs` array.
      const initialState = {
        openTabs: activeTab ? [activeTab] : [],
        activeTabIndex: 0,
        activeTab,
        currentBook,
        currentChapter,
        currentBookName,
        selectedVerseId,
        versesByTab: Array.from(versesByTab.entries()),
      };

      const result = await window.electron.window.detachPane('bible', initialState);
      if (!result.success) {
        console.error('[BiblePane] Failed to detach pane:', result.error);
      }
    } catch (error) {
      console.error('[BiblePane] Error detaching pane:', error);
    }
  }, [activeTab, currentBook, currentChapter, currentBookName, selectedVerseId, versesByTab]);

  return { handleDetachPane };
}
