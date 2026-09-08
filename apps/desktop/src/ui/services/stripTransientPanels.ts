import type { SerializedDockview } from 'dockview-react';
import {
  cloneNode,
  forEachLeaf,
  pruneToLiveIds,
  type SerializedNode,
  type SerializedPanelState,
} from './dockviewSerializedLayout';

/**
 * Content types that exist only for the current sitting and must not come back
 * on the next launch. A "New Tab" panel is a chooser: restoring one would greet
 * the user with a pane asking what they want to open, which is noise.
 */
const TRANSIENT_CONTENT_TYPES = new Set<string>(['newtab']);

function isTransient(state: SerializedPanelState): boolean {
  const contentType = (state.params as { contentType?: unknown } | undefined)?.contentType;
  return typeof contentType === 'string' && TRANSIENT_CONTENT_TYPES.has(contentType);
}

/**
 * Remove transient panels from a *serialized* layout.
 *
 * Calling `panel.api.close()` on the live dockview API inside
 * `serializeLayout()` instead would make serialization destructive: the
 * session autosave runs on a 30-second interval, so a New Tab the user had
 * just opened with `+` would be silently closed out from under them
 * mid-interaction - and if it was the only panel in its group, the whole
 * group would go with it. Serialization must not mutate the workbench; the
 * filtering belongs here, on the snapshot.
 *
 * Returns `null` when nothing survives (the caller should then persist no
 * layout, so restore falls back to the default one) and the exact input
 * reference when there was nothing transient to remove - the common case.
 */
export function stripTransientPanels(
  layout: SerializedDockview | null | undefined,
): SerializedDockview | null {
  if (!layout || typeof layout !== 'object') return layout ?? null;

  const rawPanels = (layout as unknown as { panels?: unknown }).panels;
  if (!rawPanels || typeof rawPanels !== 'object' || Array.isArray(rawPanels)) return layout;

  const panels = rawPanels as Record<string, SerializedPanelState>;
  const kept: Record<string, SerializedPanelState> = {};
  let removedAny = false;
  for (const [panelId, state] of Object.entries(panels)) {
    if (isTransient(state)) {
      removedAny = true;
      continue;
    }
    kept[panelId] = state;
  }
  if (!removedAny) return layout;

  const root = layout.grid?.root as unknown as SerializedNode | undefined;
  if (!root) return layout;

  const prunedRoot = pruneToLiveIds(cloneNode(root), new Set(Object.keys(kept)));
  if (!prunedRoot) return null;

  const survivingGroupIds = new Set<string>();
  forEachLeaf(prunedRoot, leaf => survivingGroupIds.add(leaf.data.id));
  const activeGroup = typeof layout.activeGroup === 'string' && survivingGroupIds.has(layout.activeGroup)
    ? layout.activeGroup
    : [...survivingGroupIds][0];

  return {
    ...layout,
    grid: { ...layout.grid, root: prunedRoot as never },
    panels: kept as never,
    ...(activeGroup ? { activeGroup } : {}),
  } as unknown as SerializedDockview;
}
