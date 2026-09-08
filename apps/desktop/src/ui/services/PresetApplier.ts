import type { DockviewApi, SerializedDockview } from 'dockview-react';
import type { LayoutPreset, PresetGroup } from '../types/LayoutPreset';
import type { PanelContentType } from '../stores/useLayoutStore';

export interface TabInfo {
  panelId: string;
  contentType: string;
  title: string;
  contentKey?: string;
}

/**
 * A panel entry inside `SerializedDockview.panels`.
 *
 * dockview types this as `GroupviewPanelState` but does not re-export the
 * interface, so the fields this module reads are restated here. Note the field
 * name: dockview's *deserializer* reads `contentComponent`, NOT `component`
 * (`component` is only an `addPanel()` option). Writing `component` produces a
 * panel whose content component resolves to the string `'unknown'`, which the
 * React binding then looks up in its component map, finds nothing, and renders
 * as `undefined` - the pane comes back blank and the corruption is written
 * into the saved session. Preset application therefore never synthesises panel
 * entries: it copies the live ones out of `api.toJSON()` untouched.
 */
export interface SerializedPanelState {
  id: string;
  contentComponent?: string;
  title?: string;
  params?: Record<string, unknown>;
}

interface SerializedLeafData {
  id: string;
  views: string[];
  activeView?: string;
}

interface SerializedLeaf {
  type: 'leaf';
  data: SerializedLeafData;
  size: number;
}

interface SerializedBranch {
  type: 'branch';
  data: SerializedNode[];
  size: number;
}

type SerializedNode = SerializedLeaf | SerializedBranch;

/** A group the layout wants shown as collapsed (zero-sized) rather than tiny. */
export interface CollapsedGroup {
  groupId: string;
  /** Which axis the group collapses along, derived from the preset direction. */
  axis: 'width' | 'height';
  /**
   * The group's extent along `axis` immediately before it was collapsed, so
   * expanding can put it back exactly where the user had dragged it.
   *
   * Absent when the size could not be observed - restoring a session, where
   * the group was serialized at zero and its former width is simply not in the
   * saved layout. `expandGroups` falls back to `EXPANDED_GROUP_FRACTION` then.
   */
  size?: number;
}

export interface PresetLayoutResult {
  layout: SerializedDockview;
  collapsedGroups: CollapsedGroup[];
}

/**
 * Minimum size dockview gives a group unless its constraints say otherwise.
 * A "collapsed" group has to have this constraint lifted, or the splitview
 * clamps it back up to a useless 100px sliver.
 */
export const DEFAULT_GROUP_MIN_SIZE = 100;

/** Share of the workbench a collapsed group is given when the user expands it. */
export const EXPANDED_GROUP_FRACTION = 0.35;

function matchesGroup(group: PresetGroup, contentType: string): boolean {
  return group.accepts.some(a => {
    if (a === '*') return true;
    return a === contentType;
  });
}

function isSpecificGroup(group: PresetGroup): boolean {
  return !group.accepts.every(a => a === 'unknown' || a === '*');
}

export function bucketTabs(preset: LayoutPreset, tabs: TabInfo[]): Map<number, TabInfo[]> {
  const buckets = new Map<number, TabInfo[]>();
  for (let i = 0; i < preset.groups.length; i++) {
    buckets.set(i, []);
  }

  const unmatched: TabInfo[] = [];

  for (const tab of tabs) {
    let placed = false;
    for (let i = 0; i < preset.groups.length; i++) {
      const group = preset.groups[i];
      if (isSpecificGroup(group) && matchesGroup(group, tab.contentType)) {
        buckets.get(i)!.push(tab);
        placed = true;
        break;
      }
    }
    if (!placed) {
      unmatched.push(tab);
    }
  }

  const unknownGroupIndices = preset.groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.accepts.includes('unknown') || g.accepts.includes('*'))
    .map(({ i }) => i);

  if (unknownGroupIndices.length > 0) {
    for (let j = 0; j < unmatched.length; j++) {
      const idx = unknownGroupIndices[j % unknownGroupIndices.length];
      buckets.get(idx)!.push(unmatched[j]);
    }
  } else if (unmatched.length > 0) {
    const lastIdx = preset.groups.length - 1;
    for (const tab of unmatched) {
      buckets.get(lastIdx)!.push(tab);
    }
  }

  for (let i = 0; i < preset.groups.length; i++) {
    const order = preset.groups[i].order;
    if (order && order.length > 0) {
      buckets.set(i, sortByDeclaredOrder(buckets.get(i)!, order));
    }
  }

  return buckets;
}

/**
 * Stable sort putting the declared content types first, in the declared order,
 * with everything else keeping its relative order behind them. See
 * `PresetGroup.order`.
 */
function sortByDeclaredOrder(tabs: TabInfo[], order: PanelContentType[]): TabInfo[] {
  const rank = new Map<string, number>();
  order.forEach((contentType, i) => rank.set(contentType, i));
  return tabs
    .map((tab, i) => ({ tab, i, rank: rank.get(tab.contentType) ?? order.length }))
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map(entry => entry.tab);
}

/** Which preset group a single tab belongs in, or the last group as a fallback. */
function bucketIndexFor(preset: LayoutPreset, tab: TabInfo): number {
  const buckets = bucketTabs(preset, [tab]);
  for (const [index, tabs] of buckets) {
    if (tabs.length > 0) return index;
  }
  return preset.groups.length - 1;
}

function isBranch(node: SerializedNode): node is SerializedBranch {
  return node.type === 'branch';
}

function forEachLeaf(node: SerializedNode, visit: (leaf: SerializedLeaf) => void): void {
  if (isBranch(node)) {
    for (const child of node.data) forEachLeaf(child, visit);
  } else {
    visit(node);
  }
}

function leavesOf(node: SerializedNode): SerializedLeaf[] {
  const leaves: SerializedLeaf[] = [];
  forEachLeaf(node, leaf => leaves.push(leaf));
  return leaves;
}

function rootOf(layout: SerializedDockview): SerializedNode {
  return layout.grid.root as unknown as SerializedNode;
}

/**
 * Panels in the order they appear in the grid, hydrated from the serialized
 * panel entries. Deterministic, and independent of any live dockview instance,
 * so the bucketing/rebuilding logic can be unit-tested on plain objects.
 */
export function collectTabsFromLayout(layout: SerializedDockview): TabInfo[] {
  const panels = layout.panels as unknown as Record<string, SerializedPanelState>;
  const tabs: TabInfo[] = [];
  const seen = new Set<string>();

  forEachLeaf(rootOf(layout), leaf => {
    for (const panelId of leaf.data.views) {
      const state = panels[panelId];
      if (!state || seen.has(panelId)) continue;
      seen.add(panelId);
      const params = (state.params ?? {}) as { contentType?: string; contentKey?: string };
      tabs.push({
        panelId,
        contentType: params.contentType ?? 'unknown',
        title: state.title ?? panelId,
        contentKey: params.contentKey,
      });
    }
  });

  // Panels the grid doesn't reference (floating groups, or a corrupt layout)
  // still have to survive a preset, otherwise applying one silently drops them.
  for (const [panelId, state] of Object.entries(panels)) {
    if (seen.has(panelId)) continue;
    const params = (state.params ?? {}) as { contentType?: string; contentKey?: string };
    tabs.push({
      panelId,
      contentType: params.contentType ?? 'unknown',
      title: state.title ?? panelId,
      contentKey: params.contentKey,
    });
  }

  return tabs;
}

/** Panel ids that were the visible tab of their group before the rearrange. */
function activeViewIds(layout: SerializedDockview): Set<string> {
  const active = new Set<string>();
  forEachLeaf(rootOf(layout), leaf => {
    if (leaf.data.activeView) active.add(leaf.data.activeView);
  });
  return active;
}

/**
 * Copy the serialized entries for `panelIds` out of `layout` verbatim.
 *
 * Verbatim matters: the live entry carries `contentComponent`, the full params
 * object (including `subtitle` and anything a pane has stashed there), the
 * title and the size constraints. Rebuilding it from a `TabInfo` loses all of
 * that.
 */
function carryOverPanels(
  layout: SerializedDockview,
  panelIds: Iterable<string>,
): Record<string, SerializedPanelState> {
  const source = layout.panels as unknown as Record<string, SerializedPanelState>;
  const result: Record<string, SerializedPanelState> = {};
  for (const id of panelIds) {
    const state = source[id];
    if (state) result[id] = state;
  }
  return result;
}

function collapseAxis(group: PresetGroup): 'width' | 'height' {
  return group.collapsed === 'top' || group.collapsed === 'bottom' ? 'height' : 'width';
}

function makeGroupIdFactory(presetId: string): () => string {
  let counter = 0;
  return () => {
    counter++;
    return `preset-${presetId}-group-${counter}`;
  };
}

function buildLeaf(groupId: string, tabs: TabInfo[], size: number, previouslyActive: Set<string>): SerializedLeaf {
  const views = tabs.map(t => t.panelId);
  const active = views.find(v => previouslyActive.has(v)) ?? views[0];
  return {
    type: 'leaf',
    data: {
      id: groupId,
      activeView: active,
      views,
    },
    size,
  };
}

function isGridPreset(preset: LayoutPreset): boolean {
  return preset.groups.some(g => g.row !== undefined && g.col !== undefined);
}

interface PlannedGroup {
  group: PresetGroup;
  index: number;
  tabs: TabInfo[];
}

/**
 * Preset groups that actually have something in them.
 *
 * Materialising empty groups anyway would cause the "adding a tab makes a
 * whole pane vanish" bug: an empty group offers a "+" button, the New Tab
 * placeholder it creates is then the group's ONLY panel, and replacing that
 * placeholder removes the group out from under the replacement. A preset
 * should not manufacture panes the user does not have content for.
 */
function plannedGroups(preset: LayoutPreset, buckets: Map<number, TabInfo[]>): PlannedGroup[] {
  const planned: PlannedGroup[] = [];
  for (let i = 0; i < preset.groups.length; i++) {
    const tabs = buckets.get(i) ?? [];
    if (tabs.length === 0) continue;
    planned.push({ group: preset.groups[i], index: i, tabs });
  }
  return planned;
}

function buildSingleRowGrid(
  planned: PlannedGroup[],
  nextGroupId: () => string,
  previouslyActive: Set<string>,
  collapsed: CollapsedGroup[],
): SerializedBranch {
  const totalWeight = planned.reduce((sum, p) => sum + p.group.sizeWeight, 0) || 1;
  const children: SerializedNode[] = [];

  for (const entry of planned) {
    const groupId = nextGroupId();
    const size = entry.group.collapsed
      ? 0
      : Math.max(1, Math.round((entry.group.sizeWeight / totalWeight) * 1000));
    if (entry.group.collapsed) {
      collapsed.push({ groupId, axis: collapseAxis(entry.group) });
    }
    children.push(buildLeaf(groupId, entry.tabs, size, previouslyActive));
  }

  return { type: 'branch', data: children, size: 1000 };
}

function buildGridLayout(
  planned: PlannedGroup[],
  nextGroupId: () => string,
  previouslyActive: Set<string>,
  collapsed: CollapsedGroup[],
): SerializedBranch {
  const rowMap = new Map<number, PlannedGroup[]>();

  for (const entry of planned) {
    const row = entry.group.row ?? 1;
    if (!rowMap.has(row)) rowMap.set(row, []);
    rowMap.get(row)!.push(entry);
  }

  const sortedRows = [...rowMap.entries()].sort(([a], [b]) => a - b);
  const rowBranches: SerializedNode[] = [];

  for (const [, cols] of sortedRows) {
    cols.sort((a, b) => (a.group.col ?? 1) - (b.group.col ?? 1));
    const rowTotalWeight = cols.reduce((sum, c) => sum + c.group.sizeWeight, 0) || 1;
    const colChildren: SerializedNode[] = [];

    for (const entry of cols) {
      const groupId = nextGroupId();
      const size = entry.group.collapsed
        ? 0
        : Math.max(1, Math.round((entry.group.sizeWeight / rowTotalWeight) * 1000));
      if (entry.group.collapsed) {
        collapsed.push({ groupId, axis: collapseAxis(entry.group) });
      }
      colChildren.push(buildLeaf(groupId, entry.tabs, size, previouslyActive));
    }

    rowBranches.push({
      type: 'branch',
      data: colChildren,
      size: Math.round(1000 / sortedRows.length),
    });
  }

  return { type: 'branch', data: rowBranches, size: 1000 };
}

/**
 * Build the arrangement a preset describes, reusing the panels that are open
 * right now. Nothing is created and nothing is thrown away - the panels move.
 */
export function buildPresetLayout(preset: LayoutPreset, current: SerializedDockview): PresetLayoutResult {
  const tabs = collectTabsFromLayout(current);
  const buckets = bucketTabs(preset, tabs);
  const planned = plannedGroups(preset, buckets);
  const previouslyActive = activeViewIds(current);
  const nextGroupId = makeGroupIdFactory(preset.id);
  const collapsedGroups: CollapsedGroup[] = [];

  const root = planned.length === 0
    ? ({ type: 'branch', data: [], size: 1000 } as SerializedBranch)
    : isGridPreset(preset)
      ? buildGridLayout(planned, nextGroupId, previouslyActive, collapsedGroups)
      : buildSingleRowGrid(planned, nextGroupId, previouslyActive, collapsedGroups);

  const placedIds: string[] = [];
  for (const entry of planned) {
    for (const tab of entry.tabs) placedIds.push(tab.panelId);
  }

  const collapsedIds = new Set(collapsedGroups.map(c => c.groupId));
  const activeGroup = leavesOf(root).find(l => !collapsedIds.has(l.data.id))?.data.id;

  return {
    layout: {
      grid: {
        root: root as never,
        width: current.grid?.width || 1000,
        height: current.grid?.height || 1000,
        orientation: isGridPreset(preset) ? 'VERTICAL' : 'HORIZONTAL',
      },
      panels: carryOverPanels(current, placedIds) as never,
      ...(activeGroup ? { activeGroup } : {}),
    } as unknown as SerializedDockview,
    collapsedGroups,
  };
}

function cloneNode(node: SerializedNode): SerializedNode {
  if (isBranch(node)) {
    return { type: 'branch', data: node.data.map(cloneNode), size: node.size };
  }
  return {
    type: 'leaf',
    data: { id: node.data.id, views: [...node.data.views], activeView: node.data.activeView },
    size: node.size,
  };
}

/** Drop panels that no longer exist; drop groups and branches left empty. */
function pruneNode(node: SerializedNode, liveIds: Set<string>): SerializedNode | null {
  if (isBranch(node)) {
    const children = node.data
      .map(child => pruneNode(child, liveIds))
      .filter((child): child is SerializedNode => child !== null);
    if (children.length === 0) return null;
    return { type: 'branch', data: children, size: node.size };
  }

  const views = node.data.views.filter(v => liveIds.has(v));
  if (views.length === 0) return null;
  const activeView = node.data.activeView && views.includes(node.data.activeView)
    ? node.data.activeView
    : views[0];
  return { type: 'leaf', data: { id: node.data.id, views, activeView }, size: node.size };
}

/**
 * Restore the arrangement the user last had under this preset, reconciled with
 * the panes that exist now.
 *
 * This is what makes presets round-trippable: leaving Study Mode records its
 * arrangement, and coming back re-applies it rather than re-deriving a generic
 * one. Panes closed in the meantime are dropped, panes opened in the meantime
 * are filed into the group the preset would have chosen for them.
 */
export function reconcileRememberedLayout(
  preset: LayoutPreset,
  remembered: SerializedDockview,
  current: SerializedDockview,
): PresetLayoutResult {
  const currentTabs = collectTabsFromLayout(current);
  const liveIds = new Set(currentTabs.map(t => t.panelId));

  const pruned = pruneNode(cloneNode(rootOf(remembered)), liveIds);
  if (!pruned) {
    // Nothing recognisable survived - fall back to a fresh arrangement.
    return buildPresetLayout(preset, current);
  }

  const leaves = leavesOf(pruned);
  const rememberedIds = new Set<string>();
  for (const leaf of leaves) {
    for (const view of leaf.data.views) rememberedIds.add(view);
  }

  // File panes opened since we were last in this preset.
  const newTabs = currentTabs.filter(t => !rememberedIds.has(t.panelId));
  if (newTabs.length > 0) {
    const leafBucketIndex = new Map<SerializedLeaf, number[]>();
    for (const leaf of leaves) {
      leafBucketIndex.set(
        leaf,
        leaf.data.views.map(view => {
          const tab = currentTabs.find(t => t.panelId === view);
          return tab ? bucketIndexFor(preset, tab) : -1;
        }),
      );
    }

    for (const tab of newTabs) {
      const target = bucketIndexFor(preset, tab);
      let best: SerializedLeaf | undefined;
      let bestScore = 0;
      for (const leaf of leaves) {
        const score = (leafBucketIndex.get(leaf) ?? []).filter(i => i === target).length;
        if (score > bestScore) {
          bestScore = score;
          best = leaf;
        }
      }
      const leaf = best ?? leaves[Math.min(target, leaves.length - 1)];
      leaf.data.views.push(tab.panelId);
      leafBucketIndex.get(leaf)?.push(target);
    }
  }

  const placedIds: string[] = [];
  for (const leaf of leavesOf(pruned)) {
    placedIds.push(...leaf.data.views);
  }

  // A remembered group whose stored size is zero was collapsed when the user
  // left; the constraint that allowed that is not serialized, so it has to be
  // re-applied after deserialization or the splitview clamps it back to 100px.
  const collapsedGroups: CollapsedGroup[] = leavesOf(pruned)
    .filter(leaf => leaf.size === 0)
    .map(leaf => ({ groupId: leaf.data.id, axis: rememberedCollapseAxis(preset) }));

  const collapsedIds = new Set(collapsedGroups.map(c => c.groupId));
  const activeGroup = leavesOf(pruned).find(l => !collapsedIds.has(l.data.id))?.data.id;

  return {
    layout: {
      grid: {
        root: pruned as never,
        width: current.grid?.width || remembered.grid.width,
        height: current.grid?.height || remembered.grid.height,
        orientation: remembered.grid.orientation,
      },
      panels: carryOverPanels(current, placedIds) as never,
      ...(activeGroup ? { activeGroup } : {}),
    } as unknown as SerializedDockview,
    collapsedGroups,
  };
}

function rememberedCollapseAxis(preset: LayoutPreset): 'width' | 'height' {
  const collapsedGroup = preset.groups.find(g => g.collapsed);
  return collapsedGroup ? collapseAxis(collapsedGroup) : 'width';
}

/** Groups serialized at zero size - used to re-collapse a restored session. */
export function zeroSizedGroupIds(layout: SerializedDockview): string[] {
  const root = layout.grid?.root as unknown as SerializedNode | undefined;
  if (!root) return [];
  return leavesOf(root).filter(leaf => leaf.size === 0).map(leaf => leaf.data.id);
}

/**
 * Squeeze a group down to nothing.
 *
 * dockview will not let a group go below `DEFAULT_GROUP_MIN_SIZE` unless its
 * constraints are lifted first - without that, Reading Mode would leave a
 * 100px sliver of study pane instead of collapsing it.
 */
export function collapseGroups(api: DockviewApi, groups: CollapsedGroup[]): void {
  for (const { groupId, axis } of groups) {
    const group = api.getGroup(groupId);
    if (!group) continue;
    group.api.setConstraints({ minimumWidth: 0, minimumHeight: 0 });
    group.api.setSize(axis === 'height' ? { height: 0 } : { width: 0 });
  }
}

/**
 * The extent a group currently occupies along `axis`, for recording as
 * `CollapsedGroup.size` before it is collapsed.
 *
 * Only worth calling on a group that is actually laid out at its user-chosen
 * size. Reading it during `applyPresetLayout` is meaningless - the preset has
 * just serialized the group at (or near) zero on its way to collapsing it, so
 * what comes back is dockview's minimum clamp, not anything the user picked.
 */
export function measureGroup(api: DockviewApi, groupId: string, axis: 'width' | 'height'): number | undefined {
  const group = api.getGroup(groupId);
  if (!group) return undefined;
  const extent = axis === 'height' ? group.api.height : group.api.width;
  // A group already collapsed has nothing useful to record.
  return extent > DEFAULT_GROUP_MIN_SIZE ? extent : undefined;
}

/** Give collapsed groups their size back and restore the normal minimum. */
export function expandGroups(api: DockviewApi, groups: CollapsedGroup[]): void {
  for (const { groupId, axis, size: remembered } of groups) {
    const group = api.getGroup(groupId);
    if (!group) continue;
    group.api.setConstraints({
      minimumWidth: DEFAULT_GROUP_MIN_SIZE,
      minimumHeight: DEFAULT_GROUP_MIN_SIZE,
    });
    const extent = axis === 'height' ? api.height : api.width;
    // Prefer the size the group had when it was collapsed. The fraction is the
    // fallback for a group whose former size was never observed (a restored
    // session, where the saved layout only records the zero). Clamp to the
    // workbench so a size captured at a larger window doesn't overflow a
    // smaller one.
    const target = remembered ?? Math.round(extent * EXPANDED_GROUP_FRACTION);
    const size = Math.min(extent, Math.max(DEFAULT_GROUP_MIN_SIZE, target));
    group.api.setSize(axis === 'height' ? { height: size } : { width: size });
  }
}

/**
 * Hand a rearrangement to dockview.
 *
 * `reuseExistingPanels` is the whole point: dockview then MOVES the existing
 * panel objects into the new grid instead of disposing and re-creating them.
 * Without it every pane component unmounts, and each content store's unmount
 * cleanup wipes that pane's state (open passages, scroll position, the note
 * being edited) - which is what "switching layout destroys my panes" describes.
 *
 * The Books/Dictionary stores do not depend on this: their unmount cleanup
 * only *detaches*, and state is deleted solely from dockview's
 * `onDidRemovePanel` (see `stores/helpers/panelDisposal.ts`). Every other
 * content store still clears on unmount, so this flag remains load-bearing for
 * them - and it avoids a full remount of every pane either way.
 */
export function applyPresetLayout(api: DockviewApi, result: PresetLayoutResult): void {
  api.fromJSON(result.layout, { reuseExistingPanels: true });
  collapseGroups(api, result.collapsedGroups);
}
