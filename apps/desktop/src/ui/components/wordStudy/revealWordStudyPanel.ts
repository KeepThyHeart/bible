import type { WordStudySubject } from '@bible/core/browser';
import { useLayoutStore, type PanelContentType } from '../../stores/useLayoutStore';
import { useWordStudyStore } from '../../stores/useWordStudyStore';
import { genericEnglishTitle } from '../../utils/paneNames';

/**
 * Panes of the workbench's right-hand group. A Word Study pane opens as a tab
 * beside Dictionary (see `revealDictionaryPanel`, which this mirrors).
 */
const RIGHT_HAND_TYPES: PanelContentType[] = ['dictionary', 'study', 'commentary', 'book', 'topics'];

function rightHandPosition(): Record<string, unknown> | undefined {
  const layout = useLayoutStore.getState(); // allow-getstate: event handler - imperative panel lookup outside render
  const api = layout.dockviewApi;
  if (!api) return undefined;
  for (const contentType of RIGHT_HAND_TYPES) {
    for (const panel of layout.getPanelsByType(contentType)) {
      const group = api.getPanel(panel.panelId)?.group;
      if (group) return { referenceGroup: group, direction: 'within' };
    }
  }
  return undefined;
}

/**
 * Show the Word Study pane, creating one if the layout has none, and return its
 * dockview panel id (or `null` if dockview could not add it).
 */
export function revealWordStudyPanel(subject?: WordStudySubject): string | null {
  const layout = useLayoutStore.getState(); // allow-getstate: event handler - imperative panel lookup outside render
  const existing = layout.getPanelsByType('wordStudy');
  const panelId = existing.length > 0
    ? existing[0].panelId
    : layout.addPanel('wordStudy', undefined, genericEnglishTitle('wordStudy'), rightHandPosition());
  if (!panelId) return null;
  layout.dockviewApi?.getPanel(panelId)?.api.setActive();
  if (subject) {
    // allow-getstate: event handler - imperative navigation outside render
    void useWordStudyStore.getState().study(panelId, subject);
  }
  return panelId;
}

/** Study a Strong's number in the Word Study pane. */
export function studyStrongs(strongs: string): string | null {
  return revealWordStudyPanel({ kind: 'strongs', strongs });
}
