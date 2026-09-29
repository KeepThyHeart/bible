/**
 * Pure logic for the verse web view (task 0068): merging a new ego graph into the live simulation nodes,
 * sizing, labels, keyboard neighbour choice and the text-alternative ordering. No React, no d3 runtime.
 */
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { VerseId, XrefDirection, XrefGraph } from '@bible/core/browser';
import { weightStep } from '@bible/core/browser';

export interface SimNode extends SimulationNodeDatum {
  id: VerseId;
  endVerseId?: VerseId;
  hop: number;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  /** `from`/`to` are the edge's own endpoints; d3 rewrites `source`/`target` from ids to node objects. */
  from: VerseId;
  to: VerseId;
  weight: number;
  step: 1 | 2 | 3 | 4 | 5;
  direction: XrefDirection;
  key: string;
}

export interface RankedNeighbour {
  verseId: VerseId;
  endVerseId?: VerseId;
  weight: number;
  step: 1 | 2 | 3 | 4 | 5;
  direction: XrefDirection;
  degree: number;
}

export type ArrowDir = 'left' | 'right' | 'up' | 'down';

/** Node radius from degree; the anchor is larger, hop 2 and beyond slightly smaller. */
export function nodeRadius(degree: number, hop: number): number {
  const base = 6 + Math.min(10, Math.sqrt(Math.max(0, degree)) * 1.4);
  const factor = hop <= 0 ? 1.4 : hop === 1 ? 1 : 0.85;
  return Math.round(base * factor * 10) / 10;
}

/** Edge stroke width in px from the 1..5 weight step. */
export function edgeWidth(weight: number): number {
  return 0.75 + weightStep(weight) * 0.6;
}

export function truncateLabel(text: string, max = 14): string {
  if (max < 2 || text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Stable key for an edge (direction-agnostic ids, order preserved). */
export function linkKey(from: VerseId, to: VerseId): string {
  return `${from}>${to}`;
}

const GOLDEN = 2.399963229728653;

/**
 * Merge a fresh graph into the previous simulation nodes. Nodes that persist (by verse id) keep their object,
 * position, velocity and pins. New nodes spawn next to a neighbour that is already placed (lowest hop first),
 * else next to the anchor, else at the origin. Vanished nodes are dropped. Links only join nodes present.
 */
export function mergeGraph(prev: readonly SimNode[], graph: XrefGraph): { nodes: SimNode[]; links: SimLink[] } {
  const prevById = new Map<VerseId, SimNode>();
  for (const n of prev) prevById.set(n.id, n);
  const placed = new Map<VerseId, SimNode>();
  const nodes: SimNode[] = [];
  const ordered = [...graph.nodes].sort((a, b) => a.hop - b.hop);

  const neighboursOf = new Map<VerseId, VerseId[]>();
  for (const e of graph.edges) {
    (neighboursOf.get(e.from) ?? neighboursOf.set(e.from, []).get(e.from)!).push(e.to);
    (neighboursOf.get(e.to) ?? neighboursOf.set(e.to, []).get(e.to)!).push(e.from);
  }

  // Persisting nodes first so that spawned ones can find them.
  const created = new Map<VerseId, SimNode>();
  for (const gn of ordered) {
    const old = prevById.get(gn.verseId);
    if (old) {
      old.hop = gn.hop;
      old.degree = gn.degree;
      old.endVerseId = gn.endVerseId;
      created.set(gn.verseId, old);
      placed.set(gn.verseId, old);
    }
  }
  let spawn = 0;
  for (const gn of ordered) {
    let node = created.get(gn.verseId);
    if (!node) {
      const near = (neighboursOf.get(gn.verseId) ?? []).map((id) => placed.get(id)).filter((n): n is SimNode => !!n)
        .sort((a, b) => a.hop - b.hop)[0]
        ?? placed.get(graph.anchor);
      const angle = spawn * GOLDEN;
      const r = 18 + (spawn % 5) * 3;
      spawn += 1;
      node = {
        id: gn.verseId,
        endVerseId: gn.endVerseId,
        hop: gn.hop,
        degree: gn.degree,
        x: (near ? near.x : 0) + Math.cos(angle) * r,
        y: (near ? near.y : 0) + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      };
      placed.set(gn.verseId, node);
    }
    nodes.push(node);
  }

  const links: SimLink[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (!placed.has(e.from) || !placed.has(e.to) || e.from === e.to) continue;
    const key = linkKey(e.from, e.to);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      source: e.from,
      target: e.to,
      from: e.from,
      to: e.to,
      weight: e.weight,
      step: weightStep(e.weight),
      direction: e.direction,
      key,
    });
  }
  return { nodes, links };
}

/**
 * Arrow-key navigation: the nearest node in the pressed direction (within a broad cone, perpendicular
 * offset counting double), or undefined when there is none.
 */
export function neighbourInDirection(nodes: readonly SimNode[], fromId: VerseId, dir: ArrowDir): VerseId | undefined {
  const from = nodes.find((n) => n.id === fromId);
  if (!from) return undefined;
  let best: VerseId | undefined;
  let bestScore = Infinity;
  for (const n of nodes) {
    if (n.id === fromId) continue;
    const dx = n.x - from.x;
    const dy = n.y - from.y;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const perp = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0 || perp > along * 2) continue;
    const score = along + perp * 2;
    if (score < bestScore || (score === bestScore && best !== undefined && n.id < best)) {
      bestScore = score;
      best = n.id;
    }
  }
  return best;
}

/** The anchor's direct neighbours, strongest first (ties by verse id), one row per neighbour. */
export function rankedNeighbours(graph: XrefGraph): RankedNeighbour[] {
  const byId = new Map(graph.nodes.map((n) => [n.verseId, n]));
  const rows = new Map<VerseId, RankedNeighbour>();
  for (const e of graph.edges) {
    let other: VerseId;
    if (e.from === graph.anchor) other = e.to;
    else if (e.to === graph.anchor) other = e.from;
    else continue;
    if (other === graph.anchor) continue;
    const node = byId.get(other);
    const prev = rows.get(other);
    if (prev && prev.weight >= e.weight) continue;
    rows.set(other, {
      verseId: other,
      endVerseId: node?.endVerseId,
      weight: e.weight,
      step: weightStep(e.weight),
      // Direction as seen from the anchor: out = the anchor cites the neighbour.
      direction: e.direction === 'both' ? 'both' : (e.from === graph.anchor) === (e.direction === 'out') ? 'out' : 'in',
      degree: node?.degree ?? 0,
    });
  }
  return [...rows.values()].sort((a, b) => b.weight - a.weight || a.verseId - b.verseId);
}
