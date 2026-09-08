import { useEffect } from 'react';
import { useLayoutStore } from '../../../stores/useLayoutStore';

/**
 * Keeps the dockview tab in sync with the passage the panel is showing.
 *
 * A Bible panel is one passage, so its tab is the passage: title
 * "Book Chapter", subtitle the translation abbreviation (the tab renderer
 * stacks the two). Both follow navigation, so the tab strip always reads as a
 * list of open passages rather than a row of identical "Bible" tabs.
 */
export function useDockviewTitleSync(args: {
  dockviewPanelApi: { setTitle: (title: string) => void } | undefined;
  panelId: string;
  hasPassage: boolean;
  abbreviation: string | undefined;
  currentBookName: string;
  currentChapter: number;
}) {
  const { dockviewPanelApi, panelId, hasPassage, abbreviation, currentBookName, currentChapter } = args;

  useEffect(() => {
    if (!dockviewPanelApi) return;
    if (!hasPassage || !currentBookName || !currentChapter) return;
    dockviewPanelApi.setTitle(`${currentBookName} ${currentChapter}`);
  }, [dockviewPanelApi, hasPassage, currentBookName, currentChapter]);

  useEffect(() => {
    if (!dockviewPanelApi || !abbreviation) return;
    const setDynamicSubtitle = useLayoutStore.getState().setDynamicSubtitle; // allow-getstate: effect - imperative store write outside render
    setDynamicSubtitle(panelId, abbreviation);
    return () => {
      useLayoutStore.getState().setDynamicSubtitle(panelId, null); // allow-getstate: cleanup effect - imperative store write outside render
    };
  }, [dockviewPanelApi, panelId, abbreviation]);
}
