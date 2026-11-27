import { useLayoutStore, type PanelContentType } from '../stores/useLayoutStore';

/**
 * The pane types of the workbench's right-hand group (Study, Commentary, Dictionary and the like), first match wins.
 */
export const RIGHT_HAND_TYPES: readonly PanelContentType[] = ['study', 'commentary', 'dictionary', 'book', 'topics', 'wordStudy'];

/**
 * Where a side pane opens as a tab of the right-hand group: inside the group of the first open pane of `types`, or
 * `undefined` when none is open (the caller then places it itself).
 */
export function rightHandPosition(types: readonly PanelContentType[] = RIGHT_HAND_TYPES): Record<string, unknown> | undefined {
  const layout = useLayoutStore.getState(); // allow-getstate: event handler - imperative panel lookup outside render
  const api = layout.dockviewApi;
  if (!api) return undefined;
  for (const contentType of types) {
    for (const panel of layout.getPanelsByType(contentType)) {
      const group = api.getPanel(panel.panelId)?.group;
      if (group) return { referenceGroup: group, direction: 'within' };
    }
  }
  return undefined;
}
