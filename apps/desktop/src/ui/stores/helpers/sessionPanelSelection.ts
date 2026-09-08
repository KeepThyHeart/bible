import { useLayoutStore, type PanelContentType } from '../useLayoutStore';

/**
 * Pick the panel whose state the session should save for a single-instance
 * pane, matching the panel that restore will target.
 *
 * ## Why not just take the first entry in the store's map
 *
 * Reading `panels.values().next().value` directly - "whatever was inserted
 * first into the *content* store" - is not the same thing as "the pane the
 * layout has", and the two can come apart in the worst possible way: a pane
 * whose state has been cleared and re-initialised (the tab-loss path this
 * function guards against, and StrictMode's double-invoke in development)
 * reinserts itself as a *fresh empty default*, and the next autosave would
 * happily write that empty state over the user's real tabs.
 *
 * Resolving through the layout instead makes the choice deterministic and, more
 * importantly, symmetric with the restore side, which already recovers the id
 * from the serialized layout via `panelIdFromLayout` (see `AppInitService`).
 * Both ends now name the same panel.
 *
 * ## What this does NOT fix
 *
 * With two Books panes open, only one is saved - `SessionData` has a single
 * blob per content type, so there is nowhere to put the second. This function
 * only makes *which* one deterministic (the first of these content types in
 * layout order) instead of incidental. Saving both needs a session schema
 * change, the same one Bible and Notes already have via `panelIdsFromLayout`.
 *
 * Falls back to first-entry selection when the layout knows of no such
 * panel - detached windows and unit tests have panel state but no dockview
 * registry, and returning nothing there would regress them to empty sessions.
 */
export function sessionPanelState<T>(
  panels: Map<string, T>,
  contentTypes: readonly PanelContentType[]
): T | undefined {
  // allow-getstate: called from a session serializer, outside React render
  for (const layoutPanel of useLayoutStore.getState().panels.values()) {
    if (!contentTypes.includes(layoutPanel.contentType)) continue;
    const state = panels.get(layoutPanel.panelId);
    if (state) return state;
  }

  return panels.values().next().value;
}
