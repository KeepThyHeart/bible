import { create } from 'zustand';
import type { DockviewApi, SerializedDockview } from 'dockview-react';
import { whenContextService } from '../services/WhenContextService';
import { registerSessionSerializer } from './helpers/sessionRegistry';
import { collapseGroups, expandGroups, measureGroup, type CollapsedGroup } from '../services/PresetApplier';
import { genericEnglishTitle } from '../utils/paneNames';
import { stripTransientPanels } from '../services/stripTransientPanels';

/**
 * Content types that can be rendered in dockview panels.
 *
 * The `ext:${string}` template member is reserved for extension-contributed
 * panel types. The format is
 * `ext:<extensionId>.<panelTypeId>`; `PanelContentRenderer` matches the
 * prefix and routes to `ExtensionPanelHost`, which mounts an iframe loading
 * from `ext-ui://<extensionId>/<uiEntry>`.
 */
export type PanelContentType =
  | 'bible'
  | 'commentary'
  | 'book'
  | 'dictionary'
  | 'notes'
  | 'prayer'
  | 'study'
  | 'topics'
  | 'search'
  | 'newtab'
  | `ext:${string}`;

/**
 * Registered panel in the layout system
 */
export interface LayoutPanel {
  panelId: string;
  contentType: PanelContentType;
  /** Key for content stores (e.g., Bible abbreviation, commentary abbreviation) */
  contentKey?: string;
  displayName: string;
}

interface LayoutState {
  /** Reference to dockview API (set once on mount) */
  dockviewApi: DockviewApi | null;

  /** Registry of all panels currently in the layout */
  panels: Map<string, LayoutPanel>;

  /** Whether dockview is ready and initialized */
  isReady: boolean;

  /**
   * The dockview panel id that currently has focus, per `onDidActivePanelChange`.
   * `null` before dockview reports an active panel, or once the layout is torn down.
   */
  activePanelId: string | null;

  /**
   * The most recent Bible panel to have been the active panel. Unlike
   * `activePanelId`, this is "sticky" to Bible panes: focusing a non-Bible pane
   * (or the search bar, which lives outside dockview and never becomes the
   * active panel at all) leaves it pointing at whichever Bible pane the user
   * was last actually looking at. That is the panel search/navigation actions
   * should target - see `navigateToVerseInPrimary`.
   */
  lastActiveBiblePanelId: string | null;

  /** Dynamic subtitles set by panel components at runtime (e.g., Notes showing current doc name) */
  dynamicSubtitles: Map<string, string>;

  /**
   * Groups squeezed to zero size - by a layout preset (Reading Mode collapses
   * the study area) or by the user collapsing one from its group header. They
   * are still in the layout with all their tabs intact - they just have no
   * width - so the UI needs to know they exist in order to offer a way back.
   * Empty whenever nothing is collapsed.
   */
  collapsedGroups: CollapsedGroup[];

  // Actions
  setDockviewApi: (api: DockviewApi) => void;

  /**
   * Record the currently active dockview panel. Also updates
   * `lastActiveBiblePanelId` when the newly active panel is a Bible panel.
   * Called from DockviewLayout's `onDidActivePanelChange` subscription.
   */
  setActivePanelId: (panelId: string | null) => void;

  registerPanel: (panel: LayoutPanel) => void;
  unregisterPanel: (panelId: string) => void;
  getPanel: (panelId: string) => LayoutPanel | undefined;
  getPanelsByType: (contentType: PanelContentType) => LayoutPanel[];

  /** Set or clear a dynamic subtitle for a panel */
  setDynamicSubtitle: (panelId: string, subtitle: string | null) => void;

  /** Serialize current layout for session persistence */
  serializeLayout: () => SerializedDockview | null;

  /**
   * Add a new panel to the layout. Pass position to control where it appears.
   *
   * `panelIdOverride` is for restore paths that must recreate a panel under the
   * id the session already refers to (see the Bible session migration); normal
   * callers should let the id be generated.
   */
  addPanel: (contentType: PanelContentType, contentKey?: string, displayName?: string, position?: Record<string, unknown>, subtitle?: string, panelIdOverride?: string) => string | null;

  /** Remove a panel from the layout */
  removePanel: (panelId: string) => void;

  /**
   * Open the search-results panel, or focus it if one is already open.
   *
   * Returns the panel id, or `null` if dockview is not ready. See the
   * implementation for the placement rule.
   */
  openSearchResultsPanel: () => string | null;

  /** Apply a built-in layout preset by id */
  applyPreset: (presetId: string) => Promise<void>;

  /** Record which groups are collapsed (called by the preset service). */
  setCollapsedGroups: (groups: CollapsedGroup[]) => void;

  /** Re-collapse groups a restored layout describes as zero-sized. */
  restoreCollapsedGroups: (groups: CollapsedGroup[]) => void;

  /** Give every collapsed group its size back. */
  expandCollapsedGroups: () => void;

  /**
   * Collapse one group to zero size on the user's command, independently of any
   * preset. Refuses (returning `false`) when it would leave nothing visible.
   */
  collapseGroup: (groupId: string) => boolean;

  /** Whether `collapseGroup` would currently succeed for this group. */
  canCollapseGroup: (groupId: string) => boolean;
}

/**
 * The rule behind `collapseGroup`: a group can be collapsed as long as another
 * visible one remains.
 *
 * Collapsing is a *hide*, not a close - the panes and their tabs survive - so
 * the only genuinely destructive case is collapsing the last thing on screen,
 * which would leave a blank workbench with no pane header left to host a
 * restore control. (The reveal bar would still be there, but "everything is
 * gone and one sliver of chrome is the way back" is not a state to let a user
 * reach by accident.)
 *
 * Pure and exported so the boundary case is testable without a live workbench.
 */
export function canCollapseGroup(
  allGroupIds: readonly string[],
  collapsedGroupIds: readonly string[],
  groupId: string,
): boolean {
  if (!allGroupIds.includes(groupId)) return false;
  if (collapsedGroupIds.includes(groupId)) return false;
  const visible = allGroupIds.filter(id => !collapsedGroupIds.includes(id));
  return visible.length > 1;
}

function generatePanelId(contentType: PanelContentType, contentKey?: string): string {
  const base = contentKey ? `${contentType}_${contentKey}` : contentType;
  return `${base}_${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Drop a `position` that points at a group or panel dockview has already
 * removed.
 *
 * dockview does not validate a reference passed as an *object*: given a
 * disposed group it happily opens the new panel inside it, and since that group
 * is no longer in the grid the panel is created into nothing. No error, no
 * panel - the pane simply vanishes. Falling back to unpositioned placement puts
 * the panel in the active group instead, which is visible and recoverable.
 */
export function resolveStalePosition(
  api: DockviewApi,
  position: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const referenceGroup = position.referenceGroup;
  if (referenceGroup !== undefined && referenceGroup !== null) {
    const id = typeof referenceGroup === 'string'
      ? referenceGroup
      : (referenceGroup as { id?: string }).id;
    if (!id || !api.getGroup(id)) {
      console.warn('[LayoutStore] Ignoring position: reference group no longer exists');
      return undefined;
    }
  }

  const referencePanel = position.referencePanel;
  if (referencePanel !== undefined && referencePanel !== null) {
    const id = typeof referencePanel === 'string'
      ? referencePanel
      : (referencePanel as { id?: string }).id;
    if (!id || !api.getPanel(id)) {
      console.warn('[LayoutStore] Ignoring position: reference panel no longer exists');
      return undefined;
    }
  }

  return position;
}

/**
 * Minimal structural view of `DockviewApi.toJSON().grid`. Deliberately not
 * dockview's own `SerializedGridview<T>`: this predicate only cares about the
 * shape of the tree, and a loose type keeps it callable from a test with a
 * hand-written literal.
 */
export interface SerializedGridShape {
  orientation?: string;
  root?: { type?: string; data?: unknown };
}

/**
 * Is the workbench in the plain two-pane, side-by-side arrangement?
 *
 * DEFINITION - this is the condition the collapse control is gated on, so it
 * is worth being explicit. "Left/right two-pane" means the *serialized* grid
 * has a `HORIZONTAL` root branch (dockview lays a horizontal branch's children
 * out along X - it is what `PresetApplier.buildSingleRowGrid` emits for Study
 * Mode, Reading Mode and Bible + Notes) whose children are exactly two leaves.
 * Anything else is not a left/right split: one pane (nothing to collapse
 * towards), a vertical stack (collapsing on the width axis would be
 * meaningless - and width is the only axis the collapse/restore path supports),
 * or a nested arrangement such as Study Mode (Quad)'s 2x2, where "collapse the
 * right pane" has no single answer.
 *
 * Read off the serialization rather than measured from the DOM on purpose: it
 * stays a pure function, needs no layout pass, and gives the same answer in a
 * test as it does in the app.
 */
export function isLeftRightTwoPaneLayout(grid: SerializedGridShape | undefined): boolean {
  if (!grid || grid.orientation !== 'HORIZONTAL') return false;
  const root = grid.root;
  if (!root || root.type !== 'branch' || !Array.isArray(root.data)) return false;
  const children = root.data as Array<{ type?: string } | undefined>;
  return children.length === 2 && children.every(child => child?.type === 'leaf');
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  dockviewApi: null,
  panels: new Map(),
  isReady: false,
  activePanelId: null,
  lastActiveBiblePanelId: null,
  dynamicSubtitles: new Map(),
  collapsedGroups: [],

  setDockviewApi: (api: DockviewApi) => {
    set({ dockviewApi: api, isReady: true });
  },

  setActivePanelId: (panelId: string | null) => {
    set((state) => {
      const isBiblePanel = panelId !== null && state.panels.get(panelId)?.contentType === 'bible';
      return {
        activePanelId: panelId,
        lastActiveBiblePanelId: isBiblePanel ? panelId : state.lastActiveBiblePanelId,
      };
    });
  },

  registerPanel: (panel: LayoutPanel) => {
    set((state) => {
      const panels = new Map(state.panels);
      panels.set(panel.panelId, panel);
      return { panels };
    });
  },

  unregisterPanel: (panelId: string) => {
    set((state) => {
      const panels = new Map(state.panels);
      panels.delete(panelId);
      return {
        panels,
        activePanelId: state.activePanelId === panelId ? null : state.activePanelId,
        lastActiveBiblePanelId: state.lastActiveBiblePanelId === panelId ? null : state.lastActiveBiblePanelId,
      };
    });
  },

  getPanel: (panelId: string) => {
    return get().panels.get(panelId);
  },

  getPanelsByType: (contentType: PanelContentType) => {
    const result: LayoutPanel[] = [];
    get().panels.forEach((panel) => {
      if (panel.contentType === contentType) {
        result.push(panel);
      }
    });
    return result;
  },

  setDynamicSubtitle: (panelId: string, subtitle: string | null) => {
    set((state) => {
      const dynamicSubtitles = new Map(state.dynamicSubtitles);
      if (subtitle) {
        dynamicSubtitles.set(panelId, subtitle);
      } else {
        dynamicSubtitles.delete(panelId);
      }
      return { dynamicSubtitles };
    });
  },

  serializeLayout: () => {
    const api = get().dockviewApi;
    if (!api) return null;

    // Transient "New Tab" panels are filtered out of the *snapshot*, never
    // closed on the live API. Session autosave calls this every 30s, so
    // closing here would delete a New Tab the user had just opened with `+`
    // - sporadically, depending on where the click fell in the interval.
    return stripTransientPanels(api.toJSON());
  },

  addPanel: (contentType: PanelContentType, contentKey?: string, displayName?: string, position?: Record<string, unknown>, subtitle?: string, panelIdOverride?: string) => {
    const api = get().dockviewApi;
    if (!api) {
      console.error('[LayoutStore] addPanel failed: dockviewApi is null. contentType:', contentType);
      return null;
    }

    // Singleton panels: prayer can only be open once.
    // If one already exists, activate it instead of creating a duplicate.
    // Notes panes can be opened multiple times (but the same document should
    // only be edited in one pane at a time - enforced at the component level).
    if (contentType === 'prayer') {
      const existing = get().getPanelsByType(contentType);
      if (existing.length > 0) {
        const dockPanel = api.getPanel(existing[0].panelId);
        if (dockPanel) {
          dockPanel.api.setActive();
          return existing[0].panelId;
        }
      }
    }

    const panelId = panelIdOverride ?? generatePanelId(contentType, contentKey);
    const title = displayName || contentKey || contentType;

    const panel: LayoutPanel = {
      panelId,
      contentType,
      contentKey,
      displayName: title,
    };

    get().registerPanel(panel);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addOptions: any = {
      id: panelId,
      component: 'panelContent',
      title,
      params: {
        contentType,
        contentKey,
        subtitle,
      },
    };

    if (position) {
      const resolved = resolveStalePosition(api, position);
      if (resolved) {
        addOptions.position = resolved;
      }
    }

    try {
      api.addPanel(addOptions);
    } catch (err) {
      console.error('[LayoutStore] api.addPanel threw:', err);
      get().unregisterPanel(panelId);
      return null;
    }

    return panelId;
  },

  removePanel: (panelId: string) => {
    const api = get().dockviewApi;
    if (!api) return;

    const dockviewPanel = api.getPanel(panelId);
    if (dockviewPanel) {
      dockviewPanel.api.close();
    }
    get().unregisterPanel(panelId);
  },

  /**
   * Show search results in their own dockview panel.
   *
   * Three rules, in order:
   *
   * 1. **If a search panel already exists, focus it - never move it.** This is
   *    the whole of "remember where I put it": once the user has dragged the
   *    results into the study group (or anywhere else), dockview's own layout
   *    state is the memory, and the next search must not yank it back. It also
   *    covers the panel simply being open but behind another tab.
   * 2. **Otherwise split the Bible pane top/bottom**, results below, targeting
   *    `lastActiveBiblePanelId` (the Bible pane the user was actually reading -
   *    the search bar lives outside dockview and never becomes the active
   *    panel, so `activePanelId` alone would be the wrong target) and falling
   *    back to any registered Bible panel.
   * 3. **Otherwise let dockview place it**, which lands it in the active group.
   *    Nothing to split against is a legitimate state (no Bible pane open).
   *
   * The title is the generic *English* label on purpose - `addPanel` writes it
   * into the serialized layout, so a localized string here would bake the
   * creating locale into the saved session. `localizePaneLabel` translates it
   * at render time instead.
   */
  openSearchResultsPanel: () => {
    const api = get().dockviewApi;
    if (!api) return null;

    // Rule 1: reuse wherever it now lives.
    for (const existing of get().getPanelsByType('search')) {
      const dockPanel = api.getPanel(existing.panelId);
      if (dockPanel) {
        dockPanel.api.setActive();
        return existing.panelId;
      }
    }

    // Rule 2: below the Bible pane the user was last reading.
    const { lastActiveBiblePanelId } = get();
    const targetBibleId =
      (lastActiveBiblePanelId && api.getPanel(lastActiveBiblePanelId) ? lastActiveBiblePanelId : null)
      ?? get().getPanelsByType('bible').find(p => api.getPanel(p.panelId))?.panelId
      ?? null;

    // Rule 3 is simply passing `undefined` here; `addPanel` then omits the
    // position and dockview uses the active group.
    const position = targetBibleId
      ? { direction: 'below', referencePanel: targetBibleId }
      : undefined;

    return get().addPanel('search', undefined, genericEnglishTitle('search'), position);
  },

  applyPreset: async (presetId: string) => {
    // Lazy-import to avoid circular dependency between store and service
    const { layoutPresetService } = await import('../commands/layoutCommands');
    await layoutPresetService.apply(presetId);
  },

  setCollapsedGroups: (groups: CollapsedGroup[]) => {
    set({ collapsedGroups: groups });
  },

  restoreCollapsedGroups: (groups: CollapsedGroup[]) => {
    const api = get().dockviewApi;
    if (!api) return;
    collapseGroups(api, groups);
    set({ collapsedGroups: groups });
  },

  expandCollapsedGroups: () => {
    const api = get().dockviewApi;
    const groups = get().collapsedGroups;
    if (!api || groups.length === 0) return;
    expandGroups(api, groups);
    set({ collapsedGroups: [] });
  },

  canCollapseGroup: (groupId: string) => {
    const api = get().dockviewApi;
    if (!api) return false;
    return canCollapseGroup(
      api.groups.map(g => g.id),
      get().collapsedGroups.map(c => c.groupId),
      groupId,
    );
  },

  /**
   * Always the `width` axis, deliberately. Nothing in the serialized layout
   * records *which* way a group was collapsed - the restore path
   * (`zeroSizedGroupIds` -> `restoreCollapsedGroups` in DockviewLayout) assumes
   * width, as does Reading Mode. A height collapse would come back as a width
   * one after a restart and re-collapse the wrong axis.
   */
  collapseGroup: (groupId: string) => {
    const api = get().dockviewApi;
    if (!api || !get().canCollapseGroup(groupId)) return false;

    // Measure BEFORE collapsing: this is the width the user dragged the pane
    // to, and zeroing it is the moment that information is lost. Without it
    // `expandGroups` could only fall back to a fixed fraction of the
    // workbench, so a carefully sized study pane came back the wrong width.
    const size = measureGroup(api, groupId, 'width');
    const group: CollapsedGroup = { groupId, axis: 'width', ...(size ? { size } : {}) };
    collapseGroups(api, [group]);
    set(state => ({ collapsedGroups: [...state.collapsedGroups, group] }));
    return true;
  },
}));

// Publish layout-related state into WhenContextService.
function publishLayoutWhenContext(state: LayoutState): void {
  const panels = state.panels;
  whenContextService.set('panelCount', panels.size);

  let hasCommentary = false;
  let hasDictionary = false;
  let hasNotes = false;
  let hasPrayer = false;
  for (const p of panels.values()) {
    switch (p.contentType) {
      case 'commentary': hasCommentary = true; break;
      case 'dictionary': hasDictionary = true; break;
      case 'notes': hasNotes = true; break;
      case 'prayer': hasPrayer = true; break;
    }
  }
  whenContextService.set('commentaryOpen', hasCommentary);
  whenContextService.set('dictionaryOpen', hasDictionary);
  whenContextService.set('notesOpen', hasNotes);
  whenContextService.set('prayerOpen', hasPrayer);
}

publishLayoutWhenContext(useLayoutStore.getState());
useLayoutStore.subscribe(publishLayoutWhenContext);

// Register session serializer so useSessionStore doesn't import us directly
registerSessionSerializer('dockviewState', () => {
  return useLayoutStore.getState().serializeLayout();
});
