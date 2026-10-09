import { useLayoutStore } from '../../stores/useLayoutStore';
import { genericEnglishTitle } from '../../utils/paneNames';

/**
 * Open (or reveal) the Similar passages panel, placed like the search results panel: below the
 * Bible pane the reader was last in. Returns its panel id, or null when the layout is not ready.
 */
export function openSimilarPanel(): string | null {
  const layout = useLayoutStore.getState(); // allow-getstate: imperative panel creation
  const api = layout.dockviewApi;
  if (!api) return null;

  for (const existing of layout.getPanelsByType('similar')) {
    const dockPanel = api.getPanel(existing.panelId);
    if (dockPanel) {
      dockPanel.api.setActive();
      return existing.panelId;
    }
  }

  const { lastActiveBiblePanelId } = layout;
  const targetBibleId =
    (lastActiveBiblePanelId && api.getPanel(lastActiveBiblePanelId) ? lastActiveBiblePanelId : null)
    ?? layout.getPanelsByType('bible').find(p => api.getPanel(p.panelId))?.panelId
    ?? null;
  const position = targetBibleId
    ? { direction: 'below', referencePanel: targetBibleId }
    : undefined;

  return layout.addPanel('similar', undefined, genericEnglishTitle('similar'), position);
}
