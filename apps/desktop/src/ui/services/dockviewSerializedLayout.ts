/**
 * Minimal restatement of dockview's serialized grid shape, plus the walks that
 * operate on it.
 *
 * dockview types these as `GroupviewPanelState` / grid node types but does not
 * re-export the interfaces, so every module that has to reach inside a
 * `SerializedDockview` restates them (see the identical rationale in
 * `PresetApplier.ts`). This module exists so that `LayoutStateSanitizer` and
 * `stripTransientPanels` share one restatement rather than two - and so the
 * shared half survives when `LayoutStateSanitizer` is eventually deleted (it
 * is one-time historical-bug recovery; this is not).
 */

export interface SerializedPanelState {
  id: string;
  contentComponent?: string;
  title?: string;
  params?: Record<string, unknown>;
}

export interface SerializedLeafData {
  id: string;
  views: string[];
  activeView?: string;
}

export interface SerializedLeaf {
  type: 'leaf';
  data: SerializedLeafData;
  size: number;
}

export interface SerializedBranch {
  type: 'branch';
  data: SerializedNode[];
  size: number;
}

export type SerializedNode = SerializedLeaf | SerializedBranch;

export function isBranch(node: SerializedNode): node is SerializedBranch {
  return node.type === 'branch';
}

export function forEachLeaf(node: SerializedNode, visit: (leaf: SerializedLeaf) => void): void {
  if (isBranch(node)) {
    for (const child of node.data) forEachLeaf(child, visit);
  } else {
    visit(node);
  }
}

export function cloneNode(node: SerializedNode): SerializedNode {
  if (isBranch(node)) {
    return { type: 'branch', data: node.data.map(cloneNode), size: node.size };
  }
  return {
    type: 'leaf',
    data: { id: node.data.id, views: [...node.data.views], activeView: node.data.activeView },
    size: node.size,
  };
}

/**
 * Drop panel references that are not in `liveIds`; drop groups/branches left
 * empty as a result. Returns `null` when nothing survives.
 */
export function pruneToLiveIds(node: SerializedNode, liveIds: Set<string>): SerializedNode | null {
  if (isBranch(node)) {
    const children = node.data
      .map(child => pruneToLiveIds(child, liveIds))
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
