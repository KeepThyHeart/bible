/**
 * Shared helpers for the genealogy layouts (pure, deterministic, browser-safe).
 *
 * Coordinate convention for every layout: a node's `x`/`y` is its CENTRE; `w`/`h`
 * its full size. Edge `points` are absolute. `bounds` encloses every node and edge
 * point plus a margin.
 */
import type { GenealogyGraph } from './GenealogyGraph';
import type {
  GenealogyEdgeDto, GraphLayout, LayoutBounds, LayoutEdge, LayoutEdgeStyle, LayoutNode, LayoutPoint,
} from './types';

export const NODE_H = 36;
export const MARGIN = 24;

export function nodeWidth(label: string): number {
  return Math.max(72, label.length * 8 + 24);
}

/** Ids of the key figures (Adam, Abraham, Jacob, David, Jesus) present in `g`. */
export function keyPersonIds(g: GenealogyGraph): Set<string> {
  const out = new Set<string>();
  for (const k of ['adam', 'abraham', 'jacob', 'david', 'jesus']) {
    const id = resolvePerson(g, k);
    if (id) out.add(id);
  }
  return out;
}

/** A person by id, else the first (dataset order) whose name or alias matches (case-insensitive). */
export function resolvePerson(g: GenealogyGraph, idOrName: string): string | undefined {
  if (g.has(idOrName)) return idOrName;
  return g.findByName(idOrName)[0]?.id;
}

/**
 * Persons on the line from Adam to Christ: every person in the lineages `matthew_1`
 * and `luke_3` plus their father-chain ancestors (up to Adam). Falls back to Jesus'
 * father chain when neither lineage exists.
 */
export function lineToChristSet(g: GenealogyGraph): Set<string> {
  const out = new Set<string>();
  const seeds: string[] = [];
  for (const lid of ['matthew_1', 'luke_3']) {
    const l = g.lineage(lid);
    if (l) for (const s of l.steps) if (g.has(s.personId)) seeds.push(s.personId);
  }
  if (!seeds.length) {
    const j = resolvePerson(g, 'jesus');
    if (j) seeds.push(j);
  }
  const adam = resolvePerson(g, 'adam');
  for (const s of seeds) {
    let cur: string | undefined = s;
    while (cur && !out.has(cur)) {
      out.add(cur);
      if (cur === adam) break;
      cur = g.fatherId(cur);
    }
    if (cur) out.add(cur);
  }
  return out;
}

/** The stored parent edge from `parent` to `child`, if any. */
export function parentEdge(g: GenealogyGraph, parent: string, child: string): GenealogyEdgeDto | undefined {
  return g.children(parent).find(e => e.to === child);
}

/** Style for a parent link: 'legal' -> double, disputed -> dotted, else solid. */
export function edgeStyle(e: GenealogyEdgeDto | undefined): LayoutEdgeStyle {
  if (!e) return 'solid';
  if (e.confidence === 'disputed') return 'dotted';
  if (e.qualifier === 'legal') return 'double';
  return 'solid';
}

export function firstVerse(e: GenealogyEdgeDto | undefined): number | undefined {
  return e?.verses[0]?.start;
}

/** Text of a gap marker for skipped ids: "3 not named: Ahaziah, Joash, Amaziah" (or just the count). */
export function gapNote(g: GenealogyGraph, skipped: string[]): string {
  const names = skipped.map(id => g.person(id)?.name).filter((n): n is string => !!n);
  const base = `${skipped.length} not named`;
  return names.length === skipped.length ? `${base}: ${names.join(', ')}` : base;
}

/** Orthogonal connector from the bottom of `a` to the top of `b` (vertical trees). */
export function verticalPoints(a: LayoutNode, b: LayoutNode): LayoutPoint[] {
  const top = a.y < b.y ? a : b;
  const bot = top === a ? b : a;
  const y1 = top.y + top.h / 2;
  const y2 = bot.y - bot.h / 2;
  const my = (y1 + y2) / 2;
  const pts = [{ x: top.x, y: y1 }, { x: top.x, y: my }, { x: bot.x, y: my }, { x: bot.x, y: y2 }];
  return top === a ? pts : pts.reverse();
}

/** Connector between two nodes: horizontal if they share a row, else a straight line between facing edges. */
export function sidePoints(a: LayoutNode, b: LayoutNode): LayoutPoint[] {
  if (a.y === b.y) {
    const left = a.x <= b.x;
    return [{ x: a.x + (left ? a.w / 2 : -a.w / 2), y: a.y }, { x: b.x + (left ? -b.w / 2 : b.w / 2), y: b.y }];
  }
  return [{ x: a.x, y: a.y + (a.y < b.y ? a.h / 2 : -a.h / 2) }, { x: b.x, y: b.y + (b.y < a.y ? b.h / 2 : -b.h / 2) }];
}

export function computeBounds(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutBounds {
  if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x - n.w / 2); x1 = Math.max(x1, n.x + n.w / 2);
    y0 = Math.min(y0, n.y - n.h / 2); y1 = Math.max(y1, n.y + n.h / 2);
  }
  for (const e of edges) for (const p of e.points) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { x: x0 - MARGIN, y: y0 - MARGIN, w: x1 - x0 + 2 * MARGIN, h: y1 - y0 + 2 * MARGIN };
}

export function finish(nodes: LayoutNode[], edges: LayoutEdge[]): GraphLayout {
  for (const n of nodes) { n.x = round(n.x); n.y = round(n.y); }
  for (const e of edges) for (const p of e.points) { p.x = round(p.x); p.y = round(p.y); }
  return { nodes, edges, bounds: computeBounds(nodes, edges) };
}

function round(v: number): number { return Math.round(v * 100) / 100; }

/**
 * `possibly_same_as` edges between placed persons as dotted 'same_as' edges; both ends
 * get flags.disputed. `nodesByPerson` maps a person id to its node(s).
 */
export function sameAsEdges(
  g: GenealogyGraph, nodesByPerson: Map<string, LayoutNode[]>, seen: Set<string>,
): LayoutEdge[] {
  const out: LayoutEdge[] = [];
  for (const [pid, list] of nodesByPerson) {
    for (const e of g.others(pid)) {
      if (e.type !== 'possibly_same_as' || e.from !== pid) continue;
      const targets = nodesByPerson.get(e.to);
      if (!targets) continue;
      for (const a of list) for (const b of targets) {
        const id = `same:${a.id}~${b.id}`;
        if (a.id === b.id || seen.has(id)) continue;
        seen.add(id);
        a.flags.disputed = true; b.flags.disputed = true;
        out.push({ id, from: a.id, to: b.id, points: sidePoints(a, b), style: 'dotted', kind: 'same_as', verseId: firstVerse(e) });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vertical trees (Family, Tribes)
// ---------------------------------------------------------------------------

export const ROW_H = 96;
export const H_GAP = 24;

/** A tree node for recursive width allocation. */
export interface TreeNode {
  node: LayoutNode;
  kids: TreeNode[];
  width?: number;
}

export function measureTree(t: TreeNode, gap = H_GAP): number {
  const kids = t.kids.reduce((s, k) => s + measureTree(k, gap), 0) + gap * Math.max(0, t.kids.length - 1);
  t.width = Math.max(t.node.w, kids);
  return t.width;
}

/** Places `t` in [left, left + width], centred over its kids; each row step moves `dy`. */
export function placeTree(t: TreeNode, left: number, y: number, dy: number, gap = H_GAP): void {
  const w = t.width ?? measureTree(t, gap);
  t.node.x = left + w / 2;
  t.node.y = y;
  placeForest(t.kids, t.node.x, y + dy, dy, gap);
}

/** Places a list of measured trees side by side, the block centred on `cx`. */
export function placeForest(ts: TreeNode[], cx: number, y: number, dy: number, gap = H_GAP): number {
  const block = ts.reduce((s, k) => s + (k.width ?? measureTree(k, gap)), 0) + gap * Math.max(0, ts.length - 1);
  let x = cx - block / 2;
  for (const k of ts) { placeTree(k, x, y, dy, gap); x += k.width! + gap; }
  return block;
}

/** Lineage ids per person (dataset order). */
export function lineagesByPerson(g: GenealogyGraph): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of g.lineages()) for (const s of l.steps) {
    const list = out.get(s.personId);
    if (!list) out.set(s.personId, [l.id]); else if (!list.includes(l.id)) list.push(l.id);
  }
  return out;
}

/** Builds a LayoutNode for a person (position filled in later). */
export function personNode(
  g: GenealogyGraph, pid: string, ctx: { keys: Set<string>; onLine: Set<string>; lineages: Map<string, string[]> },
  opts: { important?: boolean; colorKey?: string; id?: string } = {},
): LayoutNode {
  const p = g.person(pid)!;
  const lineages = ctx.lineages.get(pid);
  return {
    id: opts.id ?? pid, personId: pid, label: p.name, x: 0, y: 0, w: nodeWidth(p.name), h: NODE_H,
    importance: opts.important || ctx.keys.has(pid) ? 0 : lineages ? 1 : 2,
    sex: p.sex,
    colorKey: opts.colorKey ?? p.tribe,
    flags: {
      ...(lineages ? { lineages: [...lineages] } : {}),
      ...(ctx.onLine.has(pid) ? { onLineToChrist: true } : {}),
      ...(p.kind === 'group' ? { group: true } : {}),
    },
  };
}

/** Unordered key for a pair of ids. */
export function pairKey(a: string, b: string): string { return a < b ? `${a}|${b}` : `${b}|${a}`; }

/**
 * Edges between placed persons that the tree did not draw: parent links become dashed 'cross'
 * edges; marriages become 'spouse' edges when both are on the same row, else 'cross'.
 * `drawn` holds pairKey()s already drawn; `skip(parent, child)` suppresses known redundant links.
 */
export function extraEdges(
  g: GenealogyGraph, placed: Map<string, LayoutNode>, drawn: Set<string>,
  skip: (from: string, to: string) => boolean = () => false,
): LayoutEdge[] {
  const out: LayoutEdge[] = [];
  for (const [pid, a] of placed) {
    for (const e of g.children(pid)) {
      const b = placed.get(e.to);
      const k = pairKey(pid, e.to);
      if (!b || drawn.has(k) || skip(pid, e.to)) continue;
      drawn.add(k);
      out.push({ id: `cross:${a.id}->${b.id}`, from: a.id, to: b.id, points: sidePoints(a, b), style: 'dashed', kind: 'cross', verseId: firstVerse(e) });
    }
    for (const e of g.spouses(pid)) {
      if (e.from !== pid) continue;
      const b = placed.get(e.to);
      const k = pairKey(pid, e.to);
      if (!b || drawn.has(k)) continue;
      drawn.add(k);
      const same = a.y === b.y;
      out.push({
        id: `${same ? 'spouse' : 'cross'}:${a.id}-${b.id}`, from: a.id, to: b.id, points: sidePoints(a, b),
        style: same ? 'solid' : 'dashed', kind: same ? 'spouse' : 'cross', verseId: firstVerse(e),
      });
    }
  }
  return out;
}

/** A tree edge parent -> child. */
export function treeEdge(g: GenealogyGraph, parent: LayoutNode, child: LayoutNode): LayoutEdge {
  const stored = parentEdge(g, parent.personId, child.personId);
  return {
    id: `${parent.id}->${child.id}`, from: parent.id, to: child.id, points: verticalPoints(parent, child),
    style: edgeStyle(stored), kind: 'parent',
    ...(parent.flags.onLineToChrist && child.flags.onLineToChrist ? { onLineToChrist: true } : {}),
    verseId: firstVerse(stored),
  };
}

/** Counts persons reachable by `next` from `id` (excluding `id`). */
export function countReachable(id: string, next: (x: string) => string[]): number {
  const seen = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    for (const y of next(stack.pop()!)) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  }
  return seen.size - 1;
}
