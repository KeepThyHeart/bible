import type { SerializedDockview } from 'dockview-react';
import type { PanelContentType } from '../stores/useLayoutStore';
import {
  cloneNode,
  forEachLeaf,
  pruneToLiveIds,
  type SerializedNode,
  type SerializedPanelState,
} from './dockviewSerializedLayout';

/**
 * ============================================================================
 * DEFENSIVE REPAIR - fixes a `dockviewState` shape that restores as a blank pane.
 *
 * Safe to delete this module (and its call site in `DockviewLayout.tsx`) once
 * no saved session can still carry the shape described below; this module makes
 * that self-correcting - see "self-healing" at the end.
 * ============================================================================
 *
 * A preset layout built with `component: 'panelContent'` on each synthesized
 * panel entry does not survive the round trip. dockview's *deserializer* reads
 * `contentComponent`, not `component` (`component` is only an `addPanel()`
 * option - it's meaningless in a `SerializedDockview`), so such an entry has no
 * `contentComponent` field at all. dockview's `fromJSON` defaults a missing one
 * to the literal string `'unknown'` (`dockview-core`'s deserialize path
 * resolves `panelData.contentComponent ?? 'unknown'`), and the very next
 * `toJSON()` - including the one that feeds session autosave / save-on-close -
 * serializes that `'unknown'` back out as a real, persisted value.
 *
 * `dockview-react`'s `components` map (`DockviewLayout.tsx`) has exactly one
 * entry, `panelContent` -> `PanelContentRenderer`. A panel whose
 * `contentComponent` is anything else resolves to `props.components['unknown']`,
 * which is `undefined` - dockview-react renders nothing, and the pane comes
 * back blank.
 *
 * A session carrying that shape has it in
 * `dockviewState.panels[id].contentComponent`. This module repairs it (and,
 * defensively, any other unregistered `contentComponent`) once, on session
 * load, before the layout is handed to `dockviewApi.fromJSON()`.
 *
 * Self-healing: the repaired state is what feeds the *next* `toJSON()` too
 * (autosave / save-on-close both read the live dockview instance), so a
 * corrupted session is written back out healthy the first time it's saved
 * after this runs. This sanitizer is therefore a no-op for every session
 * after that one - it is not a permanent tax on every restore.
 */

/** The only content component `DockviewLayout` registers with dockview-react. */
const REGISTERED_CONTENT_COMPONENT = 'panelContent';

/**
 * Built-in content types `PanelContentRenderer` knows how to route, restated
 * here as a compile-time-checked mirror of `PanelContentType` (minus the
 * `ext:*` template member) rather than imported, because
 * `PanelContentRenderer.tsx`'s content map is an internal implementation
 * detail, not an export. If a content type is ever added to or removed from
 * that union, this object literal fails to typecheck until it's updated too
 * - TypeScript enforces `Record<Exclude<PanelContentType, ...>, true>` has
 * exactly the union's members, no more, no less.
 */
const BUILTIN_CONTENT_TYPES: Record<Exclude<PanelContentType, `ext:${string}`>, true> = {
  bible: true,
  commentary: true,
  book: true,
  dictionary: true,
  notes: true,
  prayer: true,
  study: true,
  topics: true,
  search: true,
  newtab: true,
};

function isKnownContentType(value: unknown): value is PanelContentType {
  if (typeof value !== 'string' || value.length === 0) return false;
  // PanelContentRenderer routes any `ext:*` string to ExtensionPanelHost (or a
  // "malformed extension panel" message if the id doesn't parse) - it never
  // renders undefined for these, so any non-empty `ext:` string is "known".
  if (value.startsWith('ext:')) return true;
  return Object.prototype.hasOwnProperty.call(BUILTIN_CONTENT_TYPES, value);
}

/**
 * Infer a content type from panel-id naming convention, for panels whose
 * `params.contentType` is itself missing.
 *
 * Every panel id in this app - the default layout's `bible_default` /
 * `study_default` / `commentary_default`, and every id `generatePanelId()`
 * (`useLayoutStore.ts`) produces - is `${contentType}_...`, and no content
 * type contains an underscore, so the prefix before the first `_` is the
 * content type when there is one.
 *
 * This path is not known to be reachable by the historical bug described
 * above, which left `params` untouched - only `contentComponent` was wrong.
 * It exists as defense-in-depth for a corruption shape broader than the one
 * that's been confirmed. A repair logged with `viaPanelIdInference: true` is
 * worth investigating as a *different* bug from the one this module documents.
 */
function inferContentTypeFromPanelId(panelId: string): PanelContentType | undefined {
  const idx = panelId.indexOf('_');
  const prefix = idx === -1 ? panelId : panelId.slice(0, idx);
  return isKnownContentType(prefix) ? prefix : undefined;
}

/** One repair or drop the sanitizer made, for logging. */
export interface LayoutRepairLogEntry {
  panelId: string;
  action: 'repaired' | 'dropped';
  /** The bad `contentComponent` value that triggered the repair/drop. */
  previousContentComponent: string | undefined;
  /** The content type the panel was restored to render as, if repaired. */
  contentType: string | undefined;
  /** Whether the content type came from the panel id rather than `params.contentType`. */
  viaPanelIdInference: boolean;
  reason: string;
}

export interface SanitizeDockviewStateResult {
  /**
   * The sanitized layout. `null` means nothing recoverable survived - the
   * caller should fall back to the default layout rather than hand this to
   * `fromJSON()`.
   */
  layout: SerializedDockview | null;
  /** Empty when the input needed no repair - the common case. */
  repairs: LayoutRepairLogEntry[];
}

/**
 * Repair a saved dockview layout before it is passed to `dockviewApi.fromJSON()`.
 *
 * A true no-op for a healthy layout: when no panel needs a repair, the exact
 * input object is returned (same reference), not a rebuilt copy.
 */
export function sanitizeDockviewState(
  layout: SerializedDockview | null | undefined,
): SanitizeDockviewStateResult {
  if (!layout || typeof layout !== 'object') {
    return { layout: (layout ?? null) as SerializedDockview | null, repairs: [] };
  }

  const rawPanels = (layout as unknown as { panels?: unknown }).panels;
  if (!rawPanels || typeof rawPanels !== 'object' || Array.isArray(rawPanels)) {
    // Nothing shaped like a panel map to sanitize. Leave it to the existing
    // fromJSON()/try-catch fallback in DockviewLayout to handle - this
    // sanitizer only concerns itself with the one known corruption shape.
    return { layout, repairs: [] };
  }
  const panels = rawPanels as Record<string, SerializedPanelState>;
  if (Object.keys(panels).length === 0) {
    return { layout, repairs: [] };
  }

  const root = layout.grid?.root as unknown as SerializedNode | undefined;
  if (!root) {
    return { layout, repairs: [] };
  }

  const repairs: LayoutRepairLogEntry[] = [];
  const repairedPanels: Record<string, SerializedPanelState> = {};
  let panelsChanged = false;
  let anyDropped = false;

  for (const [panelId, state] of Object.entries(panels)) {
    if (state.contentComponent === REGISTERED_CONTENT_COMPONENT) {
      repairedPanels[panelId] = state;
      continue;
    }

    const params = state.params as { contentType?: unknown; contentKey?: unknown } | undefined;
    const declaredType = params?.contentType;
    const declaredIsKnown = isKnownContentType(declaredType);
    const contentType = declaredIsKnown ? (declaredType as PanelContentType) : inferContentTypeFromPanelId(panelId);

    panelsChanged = true;

    if (!contentType) {
      anyDropped = true;
      repairs.push({
        panelId,
        action: 'dropped',
        previousContentComponent: state.contentComponent,
        contentType: undefined,
        viaPanelIdInference: false,
        reason: 'contentComponent was not the registered panelContent component, and no content type '
          + 'could be recovered from params.contentType or the panel id — the panel was dropped rather '
          + 'than rendered blank.',
      });
      continue;
    }

    repairedPanels[panelId] = {
      ...state,
      contentComponent: REGISTERED_CONTENT_COMPONENT,
      params: { ...(state.params ?? {}), contentType },
    };
    repairs.push({
      panelId,
      action: 'repaired',
      previousContentComponent: state.contentComponent,
      contentType,
      viaPanelIdInference: !declaredIsKnown,
      reason: declaredIsKnown
        ? `contentComponent was '${String(state.contentComponent)}'; restored to '${REGISTERED_CONTENT_COMPONENT}' `
          + 'using the existing params.contentType (the known historical layout-preset bug).'
        : `contentComponent was '${String(state.contentComponent)}' and params.contentType was missing; both `
          + 'were recovered from the panel id.',
    });
  }

  if (!panelsChanged) {
    return { layout, repairs: [] };
  }

  const finalRoot = anyDropped
    ? pruneToLiveIds(cloneNode(root), new Set(Object.keys(repairedPanels)))
    : root;

  if (!finalRoot) {
    // Nothing recognisable survived the repair - the caller falls back to
    // the default layout rather than hand dockview an empty grid.
    return { layout: null, repairs };
  }

  const survivingGroupIds = new Set<string>();
  forEachLeaf(finalRoot, leaf => survivingGroupIds.add(leaf.data.id));
  const activeGroup = typeof layout.activeGroup === 'string' && survivingGroupIds.has(layout.activeGroup)
    ? layout.activeGroup
    : [...survivingGroupIds][0];

  return {
    layout: {
      ...layout,
      grid: { ...layout.grid, root: finalRoot as never },
      panels: repairedPanels as never,
      ...(activeGroup ? { activeGroup } : {}),
    } as unknown as SerializedDockview,
    repairs,
  };
}
