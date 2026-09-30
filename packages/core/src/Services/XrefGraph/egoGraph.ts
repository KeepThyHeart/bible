/**
 * Budgeted breadth-first ego graph over any neighbour function (task 0068).
 *
 * A popular verse has 50-150 links, so depth 3 without a budget reaches thousands of verses.
 * The walk therefore goes hop by hop, takes the strongest candidates first, and gives each hop
 * a share of what is left so hop 1 cannot eat the whole budget when depth is 2 or 3.
 */
import type { VerseId } from '../../Data/Core/Types';
import type { EgoOptions, XrefEdge, XrefGraph, XrefNode } from './types';
import { DEFAULT_EGO_NODES, MAX_EGO_NODES } from './types';

export interface NeighbourFilter {
  sources?: string[];
  includeUser?: boolean;
}

/** Ranked neighbours of one verse, strongest first, `from` always the verse asked about. */
export type NeighbourFn = (verseId: VerseId, filter: NeighbourFilter) => XrefEdge[];

/** Share of the remaining budget that a hop before the last one may take. */
const INNER_HOP_SHARE = 0.6;

export function clampNodes(maxNodes: number | undefined): number {
  const n = Math.floor(maxNodes ?? DEFAULT_EGO_NODES);
  return Math.min(MAX_EGO_NODES, Math.max(2, Number.isFinite(n) ? n : DEFAULT_EGO_NODES));
}

function pairKey(a: VerseId, b: VerseId): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function buildEgoGraph(anchor: VerseId, opts: EgoOptions, neighbours: NeighbourFn): XrefGraph {
  const budget = clampNodes(opts.maxNodes);
  const depth = Math.min(3, Math.max(1, opts.depth));
  const minWeight = opts.minWeight ?? 0;
  const filter: NeighbourFilter = { sources: opts.sources, includeUser: opts.includeUser ?? true };

  const cache = new Map<VerseId, XrefEdge[]>();
  const nbrs = (v: VerseId): XrefEdge[] => {
    let hit = cache.get(v);
    if (!hit) {
      hit = neighbours(v, filter).filter(e => e.to !== v);
      cache.set(v, hit);
    }
    return hit;
  };

  const nodes = new Map<VerseId, XrefNode>();
  nodes.set(anchor, { verseId: anchor, hop: 0, degree: 0 });
  let truncated = false;
  let frontier: VerseId[] = [anchor];

  for (let hop = 1; hop <= depth && frontier.length > 0; hop++) {
    // Best edge into each unseen verse from anywhere in the frontier.
    const candidates = new Map<VerseId, XrefEdge>();
    for (const v of frontier) {
      for (const e of nbrs(v)) {
        if (nodes.has(e.to)) continue;
        if (e.weight < minWeight) { truncated = true; continue; }
        const prev = candidates.get(e.to);
        if (!prev || e.weight > prev.weight) candidates.set(e.to, e);
      }
    }
    const room = budget - nodes.size;
    if (room <= 0) { if (candidates.size > 0) truncated = true; break; }
    const quota = hop === depth ? room : Math.max(1, Math.ceil(room * INNER_HOP_SHARE));
    const ranked = [...candidates.values()].sort((a, b) => b.weight - a.weight || a.to - b.to);
    if (ranked.length > quota) truncated = true;
    const next: VerseId[] = [];
    for (const e of ranked.slice(0, quota)) {
      nodes.set(e.to, { verseId: e.to, ...(e.toEnd && e.toEnd !== e.to ? { endVerseId: e.toEnd } : {}), hop, degree: 0 });
      next.push(e.to);
    }
    frontier = next;
  }

  // Edges among the chosen nodes; degrees from each node's full neighbour list.
  const edges: XrefEdge[] = [];
  const seen = new Set<string>();
  for (const node of nodes.values()) {
    const list = nbrs(node.verseId);
    node.degree = list.length;
    for (const e of list) {
      if (!nodes.has(e.to) || e.weight < minWeight) continue;
      const key = pairKey(e.from, e.to);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(e);
    }
  }
  return { anchor, nodes: [...nodes.values()], edges, truncated };
}
