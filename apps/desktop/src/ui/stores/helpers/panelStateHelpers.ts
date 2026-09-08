/**
 * Helper utilities for managing per-panel-instance state in Zustand stores.
 *
 * Each content store (commentary, bible, book, dictionary, notes) holds a
 * `panels: Map<string, TPanelState>` keyed by dockview panel ID. These helpers
 * reduce boilerplate when reading and updating per-panel state.
 */

/** Default panel ID used when no dockview panelId is available (e.g., detached windows) */
export const DEFAULT_PANEL_ID = '_default';

/**
 * Get panel state from the map, falling back to a default if not found.
 */
export function getPanelState<T>(panels: Map<string, T>, panelId: string, createDefault: () => T): T {
  return panels.get(panelId) ?? createDefault();
}

/**
 * Update a specific panel's state within the panels Map.
 * Returns a new Map (immutable update for Zustand).
 *
 * @param panels - Current panels map
 * @param panelId - Panel to update
 * @param updater - Partial state or function returning partial state
 * @param createDefault - Factory for default panel state (used if panel doesn't exist yet)
 */
export function updatePanelState<T>(
  panels: Map<string, T>,
  panelId: string,
  updater: Partial<T> | ((prev: T) => Partial<T>),
  createDefault: () => T
): Map<string, T> {
  const newPanels = new Map(panels);
  const current = newPanels.get(panelId) ?? createDefault();
  const updates = typeof updater === 'function' ? updater(current) : updater;
  newPanels.set(panelId, { ...current, ...updates });
  return newPanels;
}

/**
 * Remove a panel's state from the map.
 */
export function removePanelState<T>(panels: Map<string, T>, panelId: string): Map<string, T> {
  const newPanels = new Map(panels);
  newPanels.delete(panelId);
  return newPanels;
}

/**
 * Find the first panel id in a serialized dockview layout whose contentType
 * matches one of `contentTypes`, in layout order. Returns undefined if none.
 *
 * Single-instance panes (Books/Dictionary, unlike Bible) are restored by a
 * single panel id, but that id is generated fresh at panel-creation time
 * (see `generatePanelId` in useLayoutStore) rather than reusing a fixed
 * default - so restoring session data into a hardcoded id lands it in a
 * panel nothing renders. This recovers the id the restored layout actually
 * created for that content type, mirroring `biblePanelIdsFromLayout`.
 */
export function panelIdFromLayout(dockviewState: unknown, contentTypes: readonly string[]): string | undefined {
  return panelIdsFromLayout(dockviewState, contentTypes)[0];
}

/**
 * Every panel id in a serialized dockview layout whose contentType matches one
 * of `contentTypes`, in layout order. Empty when the layout is absent or has
 * none.
 *
 * Multi-instance panes (Notes, like Bible) need the whole list rather than the
 * first match: session state is stored per panel id, so restoring it - and
 * pruning entries for panels the layout no longer contains - has to know all
 * of the ids the restored layout actually created.
 */
export function panelIdsFromLayout(dockviewState: unknown, contentTypes: readonly string[]): string[] {
  const ids: string[] = [];
  if (typeof dockviewState !== 'object' || dockviewState === null) return ids;
  const panels = (dockviewState as Record<string, unknown>).panels;
  if (typeof panels !== 'object' || panels === null) return ids;
  for (const [id, panel] of Object.entries(panels as Record<string, unknown>)) {
    if (typeof panel !== 'object' || panel === null) continue;
    const params = (panel as Record<string, unknown>).params;
    if (typeof params !== 'object' || params === null) continue;
    const contentType = (params as Record<string, unknown>).contentType;
    if (typeof contentType === 'string' && contentTypes.includes(contentType)) ids.push(id);
  }
  return ids;
}
