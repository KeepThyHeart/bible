import { useLayoutStore, type PanelContentType } from '../../stores/useLayoutStore';
import { genericEnglishTitle } from '../../utils/paneNames';

/**
 * Panes that make up the workbench's right-hand group in the first-run layout
 * (see `createDefaultLayout` in DockviewLayout). A Dictionary pane opened from
 * the Bible pane joins whichever of these is already on screen, so the passage
 * the reader is looking at keeps its width instead of being split again.
 */
const RIGHT_HAND_TYPES: PanelContentType[] = ['dictionary', 'study', 'commentary', 'book'];

/**
 * Where a dictionary lookup should land.
 *
 * Only a `'dictionary'` panel - accepting a `'book'` panel as a fallback
 * would send a lexicon into a pane that lists books only, opening as a tab
 * nothing displays. With no Dictionary pane on screen one is created instead.
 */
const LOOKUP_HOST_TYPES: PanelContentType[] = ['dictionary'];

/**
 * Make the Dictionary pane visible, creating one if the layout has none, and
 * return its panel id (or `null` if dockview could not add it).
 *
 * Clicking a Strong's number must route the lookup into `useDictionaryStore`
 * under the pane's actual dockview-assigned id, not `DEFAULT_PANEL_ID` - a
 * pane on screen always has its own id (never `DEFAULT_PANEL_ID`), see
 * BookPane.tsx, so writing to `DEFAULT_PANEL_ID` would land the lookup on a
 * panel-state entry nothing renders and the click would appear to do
 * nothing. Revealing the real pane and routing the lookup to its actual
 * panel id is the missing half of that gesture (mirrors `revealNotesPanel`).
 *
 * The pane it creates is a `'dictionary'` one, titled Dictionary, not a
 * `'book'` pane titled "Books" - the same component either way, but the
 * reader asked for a word, and a strip named after the study-books feature
 * would not even show the lexicon until they found and clicked its tab.
 *
 * Kept out of `useLayoutStore` deliberately: this is Bible-pane policy about
 * *where* the dictionary should appear, not layout mechanics, and the store's
 * existing `getPanelsByType` / `addPanel` / `dockviewApi` are enough to express it.
 */
export interface RevealDictionaryPanelOptions {
  /**
   * Skip bringing the pane to the front, leaving that to the caller.
   *
   * Activating a tab mounts its content immediately, so revealing the pane
   * before the entry has been loaded showed the reader the *previous* word for
   * as long as the lookup took. A caller that has a lookup to run passes this
   * and then activates through `activateWhenContentReady` instead.
   */
  deferActivation?: boolean;
}

/** Bring an already-revealed pane to the front of its group. */
export function activateDictionaryPanel(panelId: string): void {
  const api = useLayoutStore.getState().dockviewApi; // allow-getstate: imperative panel activation outside render
  api?.getPanel(panelId)?.api.setActive();
}

export function revealDictionaryPanel(options?: RevealDictionaryPanelOptions): string | null {
  const layout = useLayoutStore.getState(); // allow-getstate: event handler - imperative panel lookup outside render
  const api = layout.dockviewApi;

  for (const contentType of LOOKUP_HOST_TYPES) {
    const existing = layout.getPanelsByType(contentType);
    if (existing.length === 0) continue;
    const panelId = existing[0].panelId;
    // Bring it to the front of its group; a Dictionary pane hidden behind the
    // Commentary tab is as good as absent to the person who just clicked.
    if (!options?.deferActivation) api?.getPanel(panelId)?.api.setActive();
    return panelId;
  }

  return layout.addPanel(
    'dictionary',
    undefined,
    genericEnglishTitle('dictionary'),
    rightHandPosition(),
  );
}

/**
 * Where a new Dictionary pane should go: as a tab inside the existing
 * right-hand group when there is one, otherwise let dockview place it (which
 * drops it beside the active panel).
 */
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
